import type {
  DashboardData,
  DashboardMetrics,
  DashboardSnapshot,
  DashboardCashStatus,
  DashboardInventoryValuationStatus,
  DashboardInventoryValueBasis,
} from "../../store/dashboardStore";
import type { DashboardSalesReconciliation } from "./DashboardSalesReconciliationTypes";
import type { DashboardCashReconciliation } from "./DashboardCashReconciliationTypes";
import type { DashboardInventoryReconciliation } from "./DashboardInventoryReconciliationTypes";

/**
 * Convierte snapshots reconciliados al contrato exacto de dashboardStore.
 * No calcula ventas/caja/inventario aquí; solo compone valores ya resueltos.
 */
export function mapSalesReconciliationToDashboard(
  reconciliation: DashboardSalesReconciliation,
  cashReconciliation: DashboardCashReconciliation,
  customersToday: number,
  customersYesterday: number,
  historyCustomers: readonly number[],
  _legacyInventoryRetailValue: number,
  inventoryReconciliation: DashboardInventoryReconciliation,
  pendingKitchen: number,
): {
  data: DashboardData;
  yesterday: DashboardMetrics;
  history: DashboardSnapshot["history"];
} {
  const current = reconciliation.today;
  const previousDay = reconciliation.yesterday;
  const comparablePrevious = reconciliation.comparable.previous;

  const cashStatus: DashboardCashStatus = cashReconciliation.status;
  const inventoryValuationStatus: DashboardInventoryValuationStatus = inventoryReconciliation.valuationStatus;
  const inventoryValueBasis: DashboardInventoryValueBasis =
    inventoryReconciliation.valuationStatus === "COMPLETE" && inventoryReconciliation.stockCostValue !== null
      ? "PURCHASE_COST"
      : "UNAVAILABLE";

  return {
    data: {
      sales: current.netSales,
      todaySales: current.netSales,
      orders: current.transactionCount,
      productsSold: current.unitsSold,
      averageTicket: current.averageTicket ?? 0,
      // Para no falsear efectivo en el store, cashAmount es el último conteo
      // físico disponible; si no hay cierre, el estado deja explícito que no existe.
      cashAmount: cashReconciliation.closingCountedAmount ?? 0,
      customers: customersToday,
      inventory: inventoryReconciliation.stockCostValue ?? 0,
      pendingKitchen: Number.isFinite(pendingKitchen) ? pendingKitchen : 0,
      cashStatus,
      cashExpectedAmount: cashReconciliation.closingExpectedAmount,
      cashCountedAmount: cashReconciliation.closingCountedAmount,
      cashDifference: cashReconciliation.closingDifference,
      cashClosedAt: cashReconciliation.latestClosedShift?.closedAt?.toISOString() ?? null,
      inventoryValuationStatus,
      inventoryValueBasis,
      inventoryLowStockCount: inventoryReconciliation.lowStockCount,
      inventoryHistoricalValueAvailable: inventoryReconciliation.historicalValueAvailable,
      salesComparablePrevious: comparablePrevious.netSales,
      transactionsComparablePrevious: comparablePrevious.transactionCount,
      averageSaleComparablePrevious: comparablePrevious.averageTicket,
      comparisonGeneratedAt: reconciliation.generatedAt.toISOString(),
    },
    yesterday: {
      sales: previousDay.netSales,
      orders: previousDay.transactionCount,
      customers: customersYesterday,
      // No existe una fuente histórica real en esta fase.
      inventory: null,
    },
    history: {
      sales: reconciliation.history.map((day) => day.netSales),
      orders: reconciliation.history.map((day) => day.transactionCount),
      customers: [...historyCustomers],
      // No falseamos 14 snapshots repitiendo el stock actual.
      inventory: reconciliation.history.map(() => null),
    },
  };
}
