import { useEffect, useState } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { dashboardStore } from "../core/store/dashboardStore";
import { vimdyCore } from "../core/VimdyCore";
import { Sale, Customer, Product, KitchenOrder } from "../core/entities/Entities";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { getBusinessDateKey, isBusinessToday, getYesterdayKey, getDayKeyForOffset } from "../core/utils/businessTime";

/* ===========================================================================
   useDashboardSync
   ---------------------------------------------------------------------------
   Recalcula TODO — hoy, ayer y los últimos 14 días — leyendo la fuente real
   (SalesEngine / CustomerEngine / InventoryEngine / KitchenService) y lo
   escribe en dashboardStore con applyReconciled().

   Se monta UNA sola vez en VimdyAppLayout.

   CRÍTICO (race-condition): múltiples eventos (sale, customer, inventory,
   kitchen, payment) pueden disparar reconcile() casi simultáneamente. Se
   usa un contador monónico (reconcileVersion) para garantizar que una
   reconciliación ANCENA nunca sobrescriba los resultados de una más NUEVA.
   =========================================================================== */

/** Cuántos días reales de historial se calculan para las sparklines. */
const HISTORY_DAYS = 14;

/**
 * Fuente de verdad para "¿es este Date el mismo día de negocio que `now`?"
 * Usa siempre companyConfigStore.get().timezone — nunca el reloj del dispositivo.
 */
function isValidSale(sale: Sale): boolean {
  return sale.status === "PAID" || sale.status === "CLOSED" || !sale.status;
}

export function useDashboardSync() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    /** Contador monónico: cada reconcile() toma un número; si al terminar el número cambió, es obsoletita. */
    let reconcileVersion = 0;

    async function reconcile() {
      const version = ++reconcileVersion;
      const isStale = () => cancelled || version !== reconcileVersion;

      try {
        await productsReady;
        if (isStale()) return;

        const tz = companyConfigStore.get().timezone || "America/Bogota";
        const now = new Date();

        const [allSales, allCustomers, allProducts, kitchenOrders, todayCashBalance] = await Promise.all([
          container.salesEngine.get().getAllSales(),
          container.customerEngine.get().getAllCustomers(),
          container.inventoryEngine.get().listAll(),
          container.kitchenService.get().getOrders(),
          container.cashEngine.get().getTodayBalance()
        ]);

        if (isStale()) return;

        const validSales = (allSales as Sale[]).filter(isValidSale);
        const todaySalesList = validSales.filter(
          (s) => s.createdAt && isBusinessToday(new Date(s.createdAt), now, tz)
        );

        const totalSales = todaySalesList.reduce(
          (sum, s) => sum + s.total,
          0
        );

        const customersToday = (allCustomers as Customer[]).filter(
          (c) => c.createdAt && isBusinessToday(new Date(c.createdAt), now, tz)
        ).length;

        const orders = todaySalesList.length;
        const averageTicket = orders > 0 ? totalSales / orders : 0;

        const inventoryTotal = (allProducts as Product[]).reduce(
          (sum, p) => sum + (p.price ?? 0) * p.stock,
          0
        );

        const pendingKitchen = (kitchenOrders as KitchenOrder[]).filter(
          (o: KitchenOrder) => o.status === "PENDIENTE" || o.status === "EN_PREPARACION"
        ).length;

        // "Ayer": misma lógica timezone-aware que el DashboardEngine.
        const todayKey = getBusinessDateKey(now, tz);
        const yesterdayKey = getYesterdayKey(now, tz);

        const yesterdaySalesList = validSales.filter(
          (s) => s.createdAt && getBusinessDateKey(new Date(s.createdAt), tz) === yesterdayKey
        );

        const yesterday = {
          sales: yesterdaySalesList.reduce((sum, s) => sum + s.total, 0),
          orders: yesterdaySalesList.length,
          customers: (allCustomers as Customer[]).filter(
            (c) => c.createdAt && getBusinessDateKey(new Date(c.createdAt), tz) === yesterdayKey
          ).length,
          inventory: inventoryTotal
        };

        // Historial real de los últimos 14 días, para las sparklines.
        const history = {
          sales: [] as number[],
          customers: [] as number[],
          orders: [] as number[],
          inventory: [] as number[]
        };

        for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
          const dayKey = getDayKeyForOffset(now, tz, i);

          const daySales = validSales.filter(
            (s) => s.createdAt && getBusinessDateKey(new Date(s.createdAt), tz) === dayKey
          );

          history.sales.push(daySales.reduce((sum, s) => sum + s.total, 0));
          history.orders.push(daySales.length);
          history.customers.push(
            (allCustomers as Customer[]).filter(
              (c) => c.createdAt && getBusinessDateKey(new Date(c.createdAt), tz) === dayKey
            ).length
          );
          history.inventory.push(inventoryTotal);
        }

        if (isStale()) return;

        dashboardStore.applyReconciled(
          {
            sales: totalSales,
            todaySales: totalSales,
            orders,
            productsSold: todaySalesList.reduce(
              (sum, s) => sum + s.items.reduce((n, item) => n + item.quantity, 0),
              0
            ),
            averageTicket,
            cashAmount: todayCashBalance,
            customers: customersToday,
            inventory: inventoryTotal,
            pendingKitchen
          },
          yesterday,
          history
        );

        if (isStale()) return;
        setLoading(false);
        setError(null);
      } catch (err) {
        if (isStale()) return;
        setError(
          err instanceof Error ? err.message : "Error al sincronizar el dashboard"
        );
      }
    }

    void reconcile();

    const offSale = vimdyCore.on("sale", () => void reconcile());
    const offCustomer = vimdyCore.on("customer", () => void reconcile());
    const offInventory = vimdyCore.on("inventory", () => void reconcile());
    const offKitchen = vimdyCore.on("kitchen", () => void reconcile());
    const offPayment = vimdyCore.on("payment", () => void reconcile());

    return () => {
      cancelled = true;
      reconcileVersion++;
      offSale();
      offCustomer();
      offInventory();
      offKitchen();
      offPayment();
    };
  }, []);

  return { loading, error };
}
