import { useEffect, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { SaleRepository } from "../infrastructure/di/repositories/SaleRepository";
import { ShiftRepository } from "../infrastructure/di/repositories/ShiftRepository";
import { dashboardStore } from "../core/store/dashboardStore";
import { dashboardSyncStatusStore } from "../core/store/dashboardSyncStatusStore";
import { vimdyCore } from "../core/VimdyCore";
import { Customer, KitchenOrder } from "../core/entities/Entities";
import { companyConfigStore } from "../core/store/companyConfigStore";
import {
  getBusinessDateKey,
  isBusinessToday,
  getYesterdayKey,
  getDayKeyForOffset,
  startOfNextBusinessDay
} from "../core/utils/businessTime";
import {
  getCurrentBusinessId,
  getCurrentBranchId,
  subscribeCurrentBranch
} from "../infrastructure/supabase/supabaseClient";
import { DashboardSalesMetricsService } from "../core/dashboard/metrics/DashboardSalesMetricsService";
import { DashboardCashReconciliationService } from "../core/dashboard/metrics/DashboardCashReconciliationService";
import { DashboardInventoryReconciliationService } from "../core/dashboard/metrics/DashboardInventoryReconciliationService";
import { mapSalesReconciliationToDashboard } from "../core/dashboard/metrics/DashboardSalesStoreMapper";

const HISTORY_DAYS = 14;
/** Reintentos automáticos si falla la sincronización (red caída, etc.). */
const MAX_AUTO_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 4_000;
/** Red de seguridad: revisa si cambió el día empresarial aunque el navegador haya pausado el temporizador exacto. */
const DAY_ROLLOVER_POLL_MS = 30_000;
/** setTimeout no admite esperas mayores a ~24.8 días; igual nunca se espera más de 1 día. */
const MAX_TIMEOUT_MS = 2_147_000_000;
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

        // Si mientras calculaba se cerró sesión o cambió de negocio, estas
        // cifras son del negocio anterior: se descartan.
        if (getCurrentBusinessId() !== businessId) return;
        // Idem si cambió la sucursal mientras calculaba.
        if (getCurrentBranchId() !== branchId) return;

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

    // Cambio de sucursal: se descartan las cifras de la sucursal anterior y se
    // reconcilia de inmediato (sin esperar un evento de venta/caja/etc.).
    let lastBranchId = getCurrentBranchId() ?? null;
    const offBranch = subscribeCurrentBranch((nextBranchId) => {
      // null = paso intermedio de cierre de sesión / recarga de sesión: se ignora.
      if (!nextBranchId || nextBranchId === lastBranchId) return;
      const switchedFromAnother = lastBranchId !== null;
      lastBranchId = nextBranchId;
      if (cancelled) return;

      failedAttempts = 0;
      clearRetryTimer();
      if (switchedFromAnother) {
        dashboardStore.reset();
        dashboardSyncStatusStore.reset();
      } else {
        dashboardSyncStatusStore.set("loading");
      }
      setError(null);
      setLoading(true);
      void reconcile();
    });

    // Cambio de día empresarial (medianoche en la zona horaria del negocio):
    // si el local queda abierto, las cifras de "hoy" deben pasar a cero y "ayer"
    // a ser el día que terminó, SIN esperar una venta nueva. Tres mecanismos:
    //  1) un temporizador exacto a la próxima medianoche del negocio,
    //  2) un chequeo cada 30 s (los navegadores pausan temporizadores en
    //     pestañas ocultas o con el equipo dormido),
    //  3) un chequeo al volver a la pestaña o recuperar la conexión.
    const getTimezone = () => companyConfigStore.get().timezone || "America/Bogota";
    let lastDayKey = getBusinessDateKey(new Date(), getTimezone());
    let rolloverTimer: number | null = null;

    const checkDayRollover = () => {
      if (cancelled) return;
      const dayKey = getBusinessDateKey(new Date(), getTimezone());
      if (dayKey === lastDayKey) return;
      lastDayKey = dayKey;
      failedAttempts = 0;
      clearRetryTimer();
      void reconcile();
    };

    const scheduleRolloverTimer = () => {
      if (rolloverTimer !== null) window.clearTimeout(rolloverTimer);
      const now = new Date();
      const msToMidnight = startOfNextBusinessDay(now, getTimezone()).getTime() - now.getTime();
      // +1 s de margen para caer ya dentro del día nuevo.
      const delay = Math.min(Math.max(msToMidnight + 1_000, 1_000), MAX_TIMEOUT_MS);
      rolloverTimer = window.setTimeout(() => {
        rolloverTimer = null;
        checkDayRollover();
        scheduleRolloverTimer();
      }, delay);
    };

    const onVisibleOrOnline = () => {
      if (document.visibilityState === "hidden") return;
      checkDayRollover();
      scheduleRolloverTimer();
    };

    // Volvió la red: si la última sincronización falló (y ya se agotaron los
    // reintentos automáticos), se reintenta de inmediato en vez de dejar el
    // aviso de "datos desactualizados" hasta que ocurra otro evento.
    const onBackOnline = () => {
      if (cancelled) return;
      if (dashboardSyncStatusStore.getSnapshot().state !== "error") return;
      failedAttempts = 0;
      clearRetryTimer();
      void reconcile();
    };

    scheduleRolloverTimer();
    const rolloverPoll = window.setInterval(checkDayRollover, DAY_ROLLOVER_POLL_MS);
    document.addEventListener("visibilitychange", onVisibleOrOnline);
    window.addEventListener("focus", onVisibleOrOnline);
    window.addEventListener("online", onVisibleOrOnline);
    window.addEventListener("online", onBackOnline);

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
      offBranch();
      if (rolloverTimer !== null) window.clearTimeout(rolloverTimer);
      window.clearInterval(rolloverPoll);
      document.removeEventListener("visibilitychange", onVisibleOrOnline);
      window.removeEventListener("focus", onVisibleOrOnline);
      window.removeEventListener("online", onVisibleOrOnline);
      window.removeEventListener("online", onBackOnline);
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