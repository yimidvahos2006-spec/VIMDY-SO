import type { Product } from "../../entities/Entities";
import type {
  DashboardInventoryReconciliation,
  DashboardInventoryValuationStatus,
} from "./DashboardInventoryReconciliationTypes";

export interface DashboardInventorySource {
  listAll(): Promise<Product[]>;
}

function isTracked(product: Product): boolean {
  return product.trackStock !== false;
}

/**
 * Fuente única para el snapshot ACTUAL de inventario.
 *
 * Importante: VIMDY dispone del stock actual y del purchasePrice del producto,
 * pero no de snapshots históricos suficientes para afirmar "inventario de
 * ayer". Por eso esta capa nunca fabrica una serie histórica.
 */
export class DashboardInventoryReconciliationService {
  constructor(private readonly source: DashboardInventorySource) {}

  public async buildReconciliation(now: Date = new Date()): Promise<DashboardInventoryReconciliation> {
    if (Number.isNaN(now.getTime())) {
      throw new Error("INVALID_NOW: now no es una fecha válida.");
    }

    const products = await this.source.listAll();
    const tracked = products.filter(isTracked);

    // Un producto con stock 0 no afecta el valor monetario actual aunque aún
    // no tenga purchasePrice. Solo exigimos costo para existencias positivas.
    const needsValuation = tracked.filter(
      (product) => Number.isFinite(product.stock) && Math.max(0, product.stock) > 0,
    );
    const valued = needsValuation.filter(
      (product) => Number.isFinite(product.purchasePrice) && Number(product.purchasePrice) >= 0,
    );
    const unvalued = needsValuation.length - valued.length;

    const totalStockUnits = tracked.reduce(
      (sum, product) => sum + (Number.isFinite(product.stock) ? Math.max(0, product.stock) : 0),
      0,
    );

    const lowStockCount = tracked.filter(
      (product) => Number.isFinite(product.stock) && Number.isFinite(product.minStock) && product.stock <= product.minStock,
    ).length;

    const stockCostValue =
      tracked.length === 0
        ? 0
        : unvalued > 0
          ? null
          : valued.reduce(
              (sum, product) => sum + Math.max(0, product.stock) * Number(product.purchasePrice),
              0,
            );

    const valuationStatus: DashboardInventoryValuationStatus =
      tracked.length === 0
        ? "NO_STOCK_TRACKING"
        : unvalued > 0
          ? "INCOMPLETE"
          : "COMPLETE";

    return {
      generatedAt: new Date(now.getTime()),
      trackedProductCount: tracked.length,
      valuedProductCount: valued.length,
      unvaluedProductCount: unvalued,
      totalStockUnits,
      lowStockCount,
      stockCostValue,
      valuationStatus,
      historicalValueAvailable: false,
    };
  }
}
