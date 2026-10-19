import type { Product } from "../entities/Entities";

export type InventoryValuationStatus = "COMPLETE" | "INCOMPLETE" | "NO_STOCK_TRACKING";

export interface InventoryCostValuation {
  readonly trackedProductCount: number;
  /** Products with positive stock and a finite, non-negative purchase cost. */
  readonly valuedProductCount: number;
  /** Products with positive stock but missing/invalid cost or invalid stock. */
  readonly unvaluedProductCount: number;
  /** Null means that a total would be misleading because valuation is incomplete. */
  readonly stockCostValue: number | null;
  readonly valuationStatus: InventoryValuationStatus;
}

export type ProductInventoryCostStatus = "VALUED" | "MISSING_COST" | "INVALID_STOCK" | "NOT_TRACKED";

export interface ProductInventoryCost {
  readonly status: ProductInventoryCostStatus;
  readonly value: number | null;
}

function isTracked(product: Product): boolean {
  return product.active !== false && product.trackStock !== false;
}

function hasValidPurchaseCost(
  product: Product,
): product is Product & { readonly purchasePrice: number } {
  const purchasePrice = product.purchasePrice;
  return typeof purchasePrice === "number"
    && Number.isFinite(purchasePrice)
    && purchasePrice >= 0;
}

/**
 * One consistent purchase-cost valuation for the Inventory screen and executive dashboard.
 * Inactive/untracked products are excluded to match the active inventory KPIs.
 * A missing/invalid cost on positive stock makes the entire total unavailable; it never
 * presents a partial sum as the value of the whole inventory.
 */
export function calculateInventoryCostValuation(
  products: readonly Product[],
): InventoryCostValuation {
  const tracked = products.filter(isTracked);
  const needsValuation = tracked.filter(
    (product) => !Number.isFinite(product.stock) || product.stock > 0,
  );
  const valued = needsValuation.filter(
    (product) => Number.isFinite(product.stock) && product.stock > 0 && hasValidPurchaseCost(product),
  );
  const unvaluedProductCount = needsValuation.length - valued.length;
  const valuationStatus: InventoryValuationStatus = tracked.length === 0
    ? "NO_STOCK_TRACKING"
    : unvaluedProductCount > 0
      ? "INCOMPLETE"
      : "COMPLETE";

  const stockCostValue = tracked.length === 0
    ? 0
    : unvaluedProductCount > 0
      ? null
      : valued.reduce((sum, product) => sum + product.stock * (product.purchasePrice as number), 0);

  return {
    trackedProductCount: tracked.length,
    valuedProductCount: valued.length,
    unvaluedProductCount,
    stockCostValue: stockCostValue !== null && Number.isFinite(stockCostValue) ? stockCostValue : null,
    valuationStatus: stockCostValue !== null && !Number.isFinite(stockCostValue)
      ? "INCOMPLETE"
      : valuationStatus,
  };
}

/** Cost for a single product detail panel using the same rules as the aggregate. */
export function getProductInventoryCost(product: Product): ProductInventoryCost {
  if (!isTracked(product)) return { status: "NOT_TRACKED", value: null };
  if (!Number.isFinite(product.stock)) return { status: "INVALID_STOCK", value: null };

  const stock = Math.max(0, product.stock);
  if (stock === 0) return { status: "VALUED", value: 0 };
  if (!hasValidPurchaseCost(product)) return { status: "MISSING_COST", value: null };

  // `hasValidPurchaseCost` is a type guard, so purchasePrice is narrowed to number.
  const purchasePrice = product.purchasePrice;
  if (typeof purchasePrice !== "number" || !Number.isFinite(purchasePrice) || purchasePrice < 0) {
    return { status: "MISSING_COST", value: null };
  }
  const value = stock * purchasePrice;
  if (!Number.isFinite(value)) return { status: "INVALID_STOCK", value: null };
  return { status: "VALUED", value };
}
