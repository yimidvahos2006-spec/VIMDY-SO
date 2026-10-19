import type { Product } from "../../entities/Entities";
import { calculateInventoryCostValuation } from "../../utils/inventoryValuation";
import type { DashboardInventoryReconciliation } from "./DashboardInventoryReconciliationTypes";

export interface DashboardInventorySource {
  listAll(): Promise<Product[]>;
}

function isTracked(product: Product): boolean {
  return product.active !== false && product.trackStock !== false;
}

/**
 * Fuente única para el snapshot ACTUAL de inventario.
 *
 * Usa el mismo criterio de valoración que el módulo Inventario: productos
 * activos con control de stock, stock finito y costo de compra válido. No
 * fabrica una cifra total con costos faltantes ni una historia inventada.
 */
export class DashboardInventoryReconciliationService {
  constructor(private readonly source: DashboardInventorySource) {}

  public async buildReconciliation(now: Date = new Date()): Promise<DashboardInventoryReconciliation> {
    if (Number.isNaN(now.getTime())) {
      throw new Error("INVALID_NOW: now no es una fecha válida.");
    }

    const products = await this.source.listAll();
    const tracked = products.filter(isTracked);
    const valuation = calculateInventoryCostValuation(products);

    const totalStockUnits = tracked.reduce(
      (sum, product) => sum + (Number.isFinite(product.stock) ? Math.max(0, product.stock) : 0),
      0,
    );
    const lowStockCount = tracked.filter(
      (product) => Number.isFinite(product.stock)
        && Number.isFinite(product.minStock)
        && product.stock <= product.minStock,
    ).length;

    return {
      generatedAt: new Date(now.getTime()),
      trackedProductCount: valuation.trackedProductCount,
      valuedProductCount: valuation.valuedProductCount,
      unvaluedProductCount: valuation.unvaluedProductCount,
      totalStockUnits,
      lowStockCount,
      stockCostValue: valuation.stockCostValue,
      valuationStatus: valuation.valuationStatus,
      historicalValueAvailable: false,
    };
  }
}
