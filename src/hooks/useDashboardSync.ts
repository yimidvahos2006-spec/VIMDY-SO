import { useEffect, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { SaleRepository } from "../infrastructure/di/repositories/SaleRepository";
import { ShiftRepository } from "../infrastructure/di/repositories/ShiftRepository";
import { dashboardStore } from "../core/store/dashboardStore";
import { dashboardSyncStatusStore } from "../core/store/dashboardSyncStatusStore";
import { vimdyCore } from "../core/VimdyCore";
import { Customer, KitchenOrder } from "../core/entities/Entities";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { getBusinessDateKey, isBusinessToday, getYesterdayKey, getDayKeyForOffset } from "../core/utils/businessTime";
import { getCurrentBusinessId, getCurrentBranchId } from "../infrastructure/supabase/supabaseClient";
import { DashboardSalesMetricsService } from "../core/dashboard/metrics/DashboardSalesMetricsService";
import { DashboardCashReconciliationService } from "../core/dashboard/metrics/DashboardCashReconciliationService";
import { DashboardInventoryReconciliationService } from "../core/dashboard/metrics/DashboardInventoryReconciliationService";
import { mapSalesReconciliationToDashboard } from "../core/dashboard/metrics/DashboardSalesStoreMapper";

const HISTORY_DAYS = 14;
/** Reintentos automáticos si falla la sincronización (red caída, etc.). */
const MAX_AUTO_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 4_000;
const dashboardSalesMetricsService = new DashboardSalesMetricsService(new SaleRepository());
const dashboardCashReconciliationService = new DashboardCashReconciliationService(new ShiftRepository());

export function useDashboardSync() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    let reconcileVersion = 0;
    let failedAttempts = 0;
    let retryTimer: number | null = null;

    const clearRetryTimer = () => {
      if (retryTimer !== null) {
        window.clearTimeout(retryTimer);
        retryTimer = null;
      }
    };

    async function reconcile() {
      const version = ++reconcileVersion;
      const isStale = () => cancelled || version !== reconcileVersion;

      try {
        await productsReady;
        if (isStale()) return;

        const tz = companyConfigStore.get().timezone || "America/Bogota";
        const now = new Date();
        const businessId = getCurrentBusinessId();
        const branchId = getCurrentBranchId();

        const inventorySource = container.inventoryEngine.get();
        const dashboardInventoryReconciliationService =
          new DashboardInventoryReconciliationService(inventorySource);

        const [
          salesReconciliation,
          cashReconciliation,
          inventoryReconciliation,
          allCustomers,
          kitchenOrders,
        ] = await Promise.all([
          dashboardSalesMetricsService.buildReconciliation(now, tz),
          dashboardCashReconciliationService.buildReconciliation({ now, timezone: tz, businessId, branchId }),
          dashboardInventoryReconciliationService.buildReconciliation(now),
          container.customerEngine.get().getAllCustomers(),
          container.kitchenService.get().getOrders(),
        ]);

        if (isStale()) return;

        const customers = allCustomers as Customer[];
        const kitchen = kitchenOrders as KitchenOrder[];

        const customersToday = customers.filter(
          (customer) =>
            customer.createdAt &&
            isBusinessToday(new Date(customer.createdAt), now, tz),
        ).length;

        const pendingKitchen = kitchen.filter(
          (order) => order.status === "PENDIENTE" || order.status === "EN_PREPARACION",
        ).length;

        const yesterdayKey = getYesterdayKey(now, tz);
        const customersYesterday = customers.filter(
          (customer) =>
            customer.createdAt &&
            getBusinessDateKey(new Date(customer.createdAt), tz) === yesterdayKey,
        ).length;

        const historyCustomers: number[] = [];
        for (let i = HISTORY_DAYS - 1; i >= 0; i -= 1) {
          const dayKey = getDayKeyForOffset(now, tz, i);
          historyCustomers.push(
            customers.filter(
              (customer) =>
                customer.createdAt &&
                getBusinessDateKey(new Date(customer.createdAt), tz) === dayKey,
            ).length,
          );
        }

        const mapped = mapSalesReconciliationToDashboard(
          salesReconciliation,
          cashReconciliation,
          customersToday,
          customersYesterday,
          historyCustomers,
          0,
          inventoryReconciliation,
          pendingKitchen,
        );

        if (isStale()) return;

        dashboardStore.applyReconciled(
          mapped.data,
          mapped.yesterday,
          mapped.history,
        );

        if (isStale()) return;
        failedAttempts = 0;
        clearRetryTimer();
        dashboardSyncStatusStore.set("ready");
        setLoading(false);
        setError(null);
      } catch (err) {
        if (isStale()) return;
        const message = err instanceof Error ? err.message : "Error al sincronizar el dashboard";
        console.error("[useDashboardSync] Falló la sincronización:", err);
        dashboardSyncStatusStore.set("error", message);
        setError(message);
        setLoading(false);

        failedAttempts += 1;
        if (failedAttempts <= MAX_AUTO_RETRIES) {
          clearRetryTimer();
          retryTimer = window.setTimeout(() => {
            retryTimer = null;
            void reconcile();
          }, RETRY_BASE_DELAY_MS * failedAttempts);
        }
      }
    }

    dashboardSyncStatusStore.set("loading");
    dashboardSyncStatusStore.setRetryHandler(() => {
      failedAttempts = 0;
      clearRetryTimer();
      dashboardSyncStatusStore.set("loading");
      void reconcile();
    });
    void reconcile();

    const offSale = vimdyCore.on("sale", () => void reconcile());
    const offCustomer = vimdyCore.on("customer", () => void reconcile());
    const offInventory = vimdyCore.on("inventory", () => void reconcile());
    const offKitchen = vimdyCore.on("kitchen", () => void reconcile());
    const offPayment = vimdyCore.on("payment", () => void reconcile());
    const offShift = vimdyCore.on("shift", () => void reconcile());

    return () => {
      cancelled = true;
      reconcileVersion += 1;
      clearRetryTimer();
      dashboardSyncStatusStore.setRetryHandler(null);
      dashboardSyncStatusStore.set("loading");
      offSale();
      offCustomer();
      offInventory();
      offKitchen();
      offPayment();
      offShift();
    };
  }, []);

  return { loading, error };
}