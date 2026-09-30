export type DashboardInventoryValuationStatus = "COMPLETE" | "INCOMPLETE" | "NO_STOCK_TRACKING";

export interface DashboardInventoryReconciliation {
  readonly generatedAt: Date;
  readonly trackedProductCount: number;
  readonly valuedProductCount: number;
  readonly unvaluedProductCount: number;
  readonly totalStockUnits: number;
  readonly lowStockCount: number;

  /**
   * Valor del stock a costo de compra. Es null cuando falta costo en uno o
   * más productos con stock controlado; no se muestra un parcial como total.
   */
  readonly stockCostValue: number | null;
  readonly valuationStatus: DashboardInventoryValuationStatus;

  /** El ZIP actual no contiene snapshots históricos de inventario confiables. */
  readonly historicalValueAvailable: false;
}
