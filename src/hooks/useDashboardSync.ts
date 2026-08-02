import { useEffect } from "react";

import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import { dashboardStore, DashboardMetrics, DashboardSnapshot } from "../core/store/dashboardStore";
import { vimdyCore } from "../core/VimdyCore";
import { Sale, Customer } from "../core/entities/Entities";

/* ===========================================================================
   useDashboardSync
   ---------------------------------------------------------------------------
   BUG REAL ENCONTRADO (no es de sincronización remota, es de diseño):
   dashboardStore acumulaba "ventas de hoy", "pedidos", "ticket promedio",
   "ayer" e "historial" SOLO sumando/persistiendo en el localStorage de
   ESTE MISMO navegador. Nunca leía el total real desde Supabase.
   Resultado: si Computador A vendía $50.000, Computador B jamás enteraba
   a su Dashboard de esos $50.000, así estuvieran los dos viendo la app al
   mismo tiempo — y el % de tendencia (TrendBadge) y las sparklines podían
   ser distintos en cada dispositivo, porque cada uno calculaba "ayer" y
   el historial contra lo que tenía guardado localmente.

   Esta es la pieza que lo soluciona de raíz: recalcula TODO — hoy, ayer
   y los últimos 14 días — leyendo la fuente real (container.salesEngine /
   customerEngine / inventoryEngine / kitchenService) y lo escribe en
   dashboardStore con .applyReconciled(), que es lo que ya leen todos los
   bloques del Dashboard (DashboardIndicators, GerenteInteligente).
   Se dispara:
     - una vez al montar (para partir con el número real, nunca con un
       residuo local de una sesión o un negocio anterior)
     - cada vez que llega "sale", "customer", "inventory", "kitchen",
       "shift" (apertura/cierre de caja), "payment" (ingreso/egreso de
       caja manual) o "table" (cambio de estado de una mesa) del bus
       interno — incluyendo los que dispara realtimeSync.ts cuando OTRO
       dispositivo vendió o cambió algo.
       Esto es lo que exige el Gerente Inteligente (FASE 5, PASO 1) para
       refrescarse solo ante CUALQUIER evento del negocio: venta, cambio
       de inventario, compra, caja, receta o producción — nunca hay que
       recargar la app.

   Nota sobre "inventario de ayer": VIMDY no guarda una foto diaria del
   valor del inventario (solo el stock actual, en vivo), así que no hay
   ningún dato real de "cuánto valía el inventario ayer" para comparar.
   En vez de inventarlo, se repite el valor de HOY tanto en `yesterday`
   como en cada punto del `history` de inventario: la tarjeta muestra el
   valor real y una tendencia neutra, nunca una cifra fabricada.

   Se monta UNA sola vez en VimdyAppLayout, igual que useAutoAlerts.
=========================================================================== */

/** Cuántos días reales de historial se calculan para las sparklines. */
const HISTORY_DAYS = 14;

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function isToday(date: Date): boolean {
  const d = new Date(date);
  const now = new Date();
  return (
    d.getFullYear() === now.getFullYear() &&
    d.getMonth() === now.getMonth() &&
    d.getDate() === now.getDate()
  );
}

/** Mismo criterio que useCustomers.ts para "venta válida" (no cancelada/reembolsada). */
function isValidSale(sale: Sale): boolean {
  return sale.status === "PAID" || sale.status === "CLOSED" || !sale.status;
}

export function useDashboardSync() {
  useEffect(() => {
    let cancelled = false;

    async function reconcile() {
      await productsReady;

      const [allSales, allCustomers, allProducts, kitchenOrders] = await Promise.all([
        container.salesEngine.getAllSales(),
        container.customerEngine.getAllCustomers(),
        container.inventoryEngine.listAll(),
        container.kitchenService.getOrders()
      ]);

      if (cancelled) return;

      const validSales = (allSales as Sale[]).filter(isValidSale);
      const todaySalesList = validSales.filter((s) => isToday(s.createdAt));

      const totalSales = todaySalesList.reduce((sum, s) => sum + s.total, 0);
      const productsSold = todaySalesList.reduce(
        (sum, s) => sum + s.items.reduce((n, item) => n + item.quantity, 0),
        0
      );
      const orders = todaySalesList.length;
      const averageTicket = orders > 0 ? totalSales / orders : 0;
      const inventoryTotal = allProducts.reduce((sum, p) => sum + p.price * p.stock, 0);
      const pendingKitchen = kitchenOrders.filter(
        (o) => o.status === "PENDIENTE" || o.status === "EN_PREPARACION"
      ).length;

      // "Ayer": mismo cálculo para cualquier dispositivo porque sale de las
      // mismas ventas/clientes reales de Supabase, no de un localStorage
      // por navegador.
      const todayStart = startOfDay(new Date());
      const yesterdayStart = new Date(todayStart);
      yesterdayStart.setDate(todayStart.getDate() - 1);

      const yesterdaySalesList = validSales.filter((s) => {
        const day = startOfDay(new Date(s.createdAt)).getTime();
        return day === yesterdayStart.getTime();
      });

      const yesterday: DashboardMetrics = {
        sales: yesterdaySalesList.reduce((sum, s) => sum + s.total, 0),
        orders: yesterdaySalesList.length,
        customers: (allCustomers as Customer[]).filter(
          (c) => c.createdAt && new Date(c.createdAt).getTime() < todayStart.getTime()
        ).length,
        // Sin historial diario real de inventario: se repite el valor de hoy.
        inventory: inventoryTotal
      };

      // Historial real de los últimos 14 días, para las sparklines.
      const history: DashboardSnapshot["history"] = {
        sales: [],
        customers: [],
        orders: [],
        inventory: []
      };

      for (let i = HISTORY_DAYS - 1; i >= 0; i--) {
        const dayStart = new Date(todayStart);
        dayStart.setDate(todayStart.getDate() - i);
        const dayEnd = new Date(dayStart);
        dayEnd.setDate(dayStart.getDate() + 1);

        const daySales = validSales.filter((s) => {
          const time = new Date(s.createdAt).getTime();
          return time >= dayStart.getTime() && time < dayEnd.getTime();
        });

        history.sales.push(daySales.reduce((sum, s) => sum + s.total, 0));
        history.orders.push(daySales.length);
        history.customers.push(
          (allCustomers as Customer[]).filter(
            (c) => c.createdAt && new Date(c.createdAt).getTime() < dayEnd.getTime()
          ).length
        );
        // Sin historial diario real de inventario: línea plana con el valor de hoy.
        history.inventory.push(inventoryTotal);
      }

      dashboardStore.applyReconciled(
        {
          sales: totalSales,
          todaySales: totalSales,
          orders,
          productsSold,
          averageTicket,
          cashAmount: totalSales,
          customers: allCustomers.length,
          inventory: inventoryTotal,
          pendingKitchen
        },
        yesterday,
        history
      );
    }

    reconcile();

    const offSale = vimdyCore.on("sale", () => reconcile());
    const offCustomer = vimdyCore.on("customer", () => reconcile());
    const offInventory = vimdyCore.on("inventory", () => reconcile());
    const offKitchen = vimdyCore.on("kitchen", () => reconcile());
    const offShift = vimdyCore.on("shift", () => reconcile());
    const offTable = vimdyCore.on("table", () => reconcile());
    // FASE 5, PASO 1 (cierre): un ingreso/egreso de caja manual (no ligado a
    // una venta) también debe refrescar el Gerente Inteligente sin recargar.
    const offPayment = vimdyCore.on("payment", () => reconcile());

    return () => {
      cancelled = true;
      offSale();
      offCustomer();
      offInventory();
      offKitchen();
      offShift();
      offTable();
      offPayment();
    };
  }, []);
}