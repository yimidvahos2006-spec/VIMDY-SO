import type { InventoryMovement, Product, SaleItem } from "../entities/Entities";

export interface HistoricalTaxBreakdown {
  readonly baseRevenue: number;
  readonly ivaRate: number;
  readonly ivaAmount: number;
  readonly impoconsumoRate: number;
  readonly impoconsumoAmount: number;
  readonly totalIndirectTax: number;
  readonly priceIncludesTax: boolean;
  readonly estimatedTaxRate: boolean;
}

export interface HistoricalCostSource {
  readonly unitCost: number | null;
  readonly reliable: boolean;
  readonly source:
    | "SALE_SNAPSHOT"
    | "KARDEX_WEIGHTED_AVERAGE"
    | "CATALOG_CURRENT"
    | "MISSING";
}

export interface WeightedAverageCostSnapshot {
  readonly unitCost: number;
  readonly quantityBase: number;
  readonly reliable: boolean;
  readonly source: "KARDEX_WEIGHTED_AVERAGE" | "CATALOG_CURRENT";
}

export type WeightedAverageCostMap = ReadonlyMap<
  string,
  WeightedAverageCostSnapshot
>;

export interface HistoricalCostPoint {
  readonly at: Date;
  readonly snapshot: WeightedAverageCostSnapshot;
}

export type WeightedAverageCostTimeline = ReadonlyMap<
  string,
  readonly HistoricalCostPoint[]
>;

export interface HistoricalProfitOptions {
  readonly product?: Product;
  readonly weightedAverageCosts?: WeightedAverageCostMap;
  readonly weightedAverageCostTimeline?: WeightedAverageCostTimeline;
  readonly saleDate?: Date;
  /** Se usa solo cuando el porcentaje no quedó congelado en el item/producto. */
  readonly fallbackIvaRate?: number;
}

export interface HistoricalLineProfitResult {
  /** Costo total de la línea, solo si el costo unitario es confiable. */
  readonly cost: number;
  /** Utilidad de la línea sobre ingreso neto de impuestos indirectos. */
  readonly profit: number;
  /** true cuando el costo histórico no pudo probarse con Kardex/snapshot confiable. */
  readonly costUnreliable: boolean;
  /** Ingreso bruto de la línea según el precio registrado en la venta. */
  readonly revenue: number;
  /** Base de ingreso después de retirar impuestos cuando estaban incluidos en el precio. */
  readonly netRevenue: number;
  readonly ivaAmount: number;
  readonly impoconsumoAmount: number;
  readonly totalIndirectTax: number;
  readonly historicalCost: HistoricalCostSource;
  readonly taxBreakdown: HistoricalTaxBreakdown;
}

function fixed2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function finiteNonNegative(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) && n >= 0 ? n : fallback;
}

function getDynamicNumber(
  value: unknown,
  keys: readonly string[]
): number | undefined {
  if (!value || typeof value !== "object") return undefined;

  const source = value as Record<string, unknown>;
  for (const key of keys) {
    const n = Number(source[key]);
    if (Number.isFinite(n) && n >= 0) return n;
  }

  return undefined;
}

function getDynamicBoolean(
  value: unknown,
  keys: readonly string[]
): boolean | undefined {
  if (!value || typeof value !== "object") return undefined;

  const source = value as Record<string, unknown>;
  for (const key of keys) {
    if (typeof source[key] === "boolean") return source[key];
  }

  return undefined;
}

function getCatalogUnitCost(product: Product | undefined): number | undefined {
  if (!product) return undefined;

  // Product.purchasePrice existe hoy en la entidad y en el JSONB de Supabase,
  // pero el cálculo deliberadamente lee el campo por contrato de persistencia
  // para no acoplar esta utilidad a una propiedad pública concreta del modelo.
  return getDynamicNumber(product, [
    "purchasePrice",
    "unitCost",
    "costPrice",
    "cost"
  ]);
}

function getMovementUnitCost(
  movement: InventoryMovement
): number | undefined {
  return getDynamicNumber(movement, [
    "unitCost",
    "purchaseUnitCost",
    "unitCostAtMovement",
    "costPerUnit",
    "purchasePrice",
    "cost"
  ]);
}

function validDate(value: Date | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
}

/**
 * Construye el costo promedio ponderado vigente al final del Kardex recibido.
 *
 * Reglas contables del cálculo:
 * - INCREASE con costo: incorpora cantidad * costo al valor del inventario.
 * - DECREASE: descarga al costo promedio vigente.
 * - ADJUST: si existe stockAfter, reconstruye la cantidad; un aumento sin
 *   costo conocido reduce la confiabilidad del resultado.
 * - Una entrada sin costo no se inventa: el resultado queda no confiable.
 *
 * El fallback de catálogo se entrega explícitamente como CATALOG_CURRENT y
 * nunca se marca como histórico confiable.
 */
export function buildWeightedAverageCostMap(
  movements: readonly InventoryMovement[],
  products: readonly Product[]
): Map<string, WeightedAverageCostSnapshot> {
  const timeline = buildWeightedAverageCostTimeline(movements, products);
  const result = new Map<string, WeightedAverageCostSnapshot>();

  for (const product of products) {
    const points = timeline.get(product.id) ?? [];
    const last = points[points.length - 1];

    if (last) {
      result.set(product.id, last.snapshot);
      continue;
    }

    const catalogCost = getCatalogUnitCost(product);
    if (catalogCost !== undefined) {
      result.set(product.id, {
        unitCost: fixed2(catalogCost),
        quantityBase: Math.max(0, finiteNonNegative(product.stock)),
        reliable: false,
        source: "CATALOG_CURRENT"
      });
    }
  }

  return result;
}

/**
 * Construye snapshots temporales del costo promedio ponderado.
 * Esto permite valorar una venta con el WAC existente EN LA FECHA DE LA VENTA,
 * en vez de usar el costo promedio de todo el histórico futuro.
 */
export function buildWeightedAverageCostTimeline(
  movements: readonly InventoryMovement[],
  products: readonly Product[]
): Map<string, HistoricalCostPoint[]> {
  interface Accumulator {
    quantity: number;
    value: number;
    reliable: boolean;
  }

  const states = new Map<string, Accumulator>();
  const points = new Map<string, HistoricalCostPoint[]>();
  const sorted = [...movements].sort(
    (a, b) => a.date.getTime() - b.date.getTime()
  );

  const appendPoint = (
    productId: string,
    movementDate: Date,
    state: Accumulator
  ): void => {
    const unitCost = state.quantity > 0 ? state.value / state.quantity : 0;
    const list = points.get(productId) ?? [];
    list.push({
      at: new Date(movementDate.getTime()),
      snapshot: {
        unitCost: fixed2(Math.max(0, unitCost)),
        quantityBase: fixed2(Math.max(0, state.quantity)),
        reliable: state.reliable && state.quantity >= 0,
        source: "KARDEX_WEIGHTED_AVERAGE"
      }
    });
    points.set(productId, list);
  };

  for (const movement of sorted) {
    if (!Number.isFinite(movement.quantity) || movement.quantity < 0) {
      continue;
    }

    const current = states.get(movement.productId) ?? {
      quantity: 0,
      value: 0,
      reliable: true
    };

    const movementDate = validDate(movement.date) ?? new Date(0);
    const unitCost = getMovementUnitCost(movement);

    if (movement.type === "INCREASE") {
      if (movement.quantity === 0) {
        appendPoint(movement.productId, movementDate, current);
        states.set(movement.productId, current);
        continue;
      }

      if (unitCost === undefined) {
        // No se puede valorar de forma exacta una entrada cuyo costo no quedó
        // persistido. Conservamos el WAC matemático anterior solo como
        // referencia, pero la marca reliable pasa a false.
        current.quantity += movement.quantity;
        current.reliable = false;
        if (current.quantity > 0 && current.value === 0) {
          current.value = 0;
        }
      } else {
        current.value += movement.quantity * unitCost;
        current.quantity += movement.quantity;
      }
    } else if (movement.type === "DECREASE") {
      const quantityBefore = current.quantity;
      const averageBefore = quantityBefore > 0
        ? current.value / quantityBefore
        : 0;

      current.quantity = Math.max(0, quantityBefore - movement.quantity);
      current.value = Math.max(
        0,
        current.value - movement.quantity * averageBefore
      );

      if (movement.quantity > quantityBefore + 0.0000001) {
        current.reliable = false;
      }
    } else {
      const target =
        movement.stockAfter !== undefined && Number.isFinite(movement.stockAfter)
          ? Math.max(0, movement.stockAfter)
          : Math.max(0, current.quantity + movement.quantity);
      const delta = target - current.quantity;

      if (delta > 0) {
        if (unitCost === undefined) {
          current.reliable = false;
        } else {
          current.value += delta * unitCost;
        }
      } else if (delta < 0) {
        const averageBefore = current.quantity > 0
          ? current.value / current.quantity
          : 0;
        current.value = Math.max(
          0,
          current.value + delta * averageBefore
        );
      }

      current.quantity = target;
    }

    states.set(movement.productId, current);
    appendPoint(movement.productId, movementDate, current);
  }

  for (const product of products) {
    if (points.has(product.id)) continue;

    const catalogCost = getCatalogUnitCost(product);
    if (catalogCost === undefined) continue;

    points.set(product.id, [
      {
        at: new Date(0),
        snapshot: {
          unitCost: fixed2(catalogCost),
          quantityBase: Math.max(0, finiteNonNegative(product.stock)),
          reliable: false,
          source: "CATALOG_CURRENT"
        }
      }
    ]);
  }

  return points;
}

export function getWeightedAverageCostAt(
  productId: string,
  at: Date,
  timeline: WeightedAverageCostTimeline
): WeightedAverageCostSnapshot | undefined {
  const validAt = validDate(at);
  if (!validAt) return undefined;

  return resolveTimelineCost(productId, validAt, timeline);
}

function resolveTimelineCost(
  productId: string,
  saleDate: Date,
  timeline: WeightedAverageCostTimeline
): WeightedAverageCostSnapshot | undefined {
  const points = timeline.get(productId);
  if (!points || points.length === 0) return undefined;

  let selected: WeightedAverageCostSnapshot | undefined;
  for (const point of points) {
    if (point.at.getTime() <= saleDate.getTime()) {
      selected = point.snapshot;
      continue;
    }
    break;
  }

  return selected;
}

function resolveCost(
  item: Pick<SaleItem, "productId" | "unitCostAtSale" | "costUnreliableAtSale">,
  options?: HistoricalProfitOptions
): HistoricalCostSource {
  if (
    item.unitCostAtSale !== undefined &&
    Number.isFinite(item.unitCostAtSale) &&
    item.unitCostAtSale >= 0
  ) {
    return {
      unitCost: item.unitCostAtSale,
      reliable: true,
      source: "SALE_SNAPSHOT"
    };
  }

  const saleDate = validDate(options?.saleDate);
  if (saleDate && options?.weightedAverageCostTimeline) {
    const historical = resolveTimelineCost(
      item.productId,
      saleDate,
      options.weightedAverageCostTimeline
    );
    if (historical) {
      return {
        unitCost: historical.unitCost,
        reliable: historical.reliable,
        source: historical.reliable
          ? "KARDEX_WEIGHTED_AVERAGE"
          : historical.source === "CATALOG_CURRENT"
            ? "CATALOG_CURRENT"
            : "KARDEX_WEIGHTED_AVERAGE"
      };
    }
  }

  const weighted = options?.weightedAverageCosts?.get(item.productId);
  if (weighted) {
    return {
      unitCost: weighted.unitCost,
      reliable: weighted.reliable,
      source: weighted.reliable
        ? "KARDEX_WEIGHTED_AVERAGE"
        : "CATALOG_CURRENT"
    };
  }

  const catalogCost = getCatalogUnitCost(options?.product);
  if (catalogCost !== undefined) {
    return {
      unitCost: fixed2(catalogCost),
      reliable: false,
      source: "CATALOG_CURRENT"
    };
  }

  return {
    unitCost: null,
    reliable: false,
    source: "MISSING"
  };
}

function resolveTaxBreakdown(
  item: Pick<SaleItem, "taxRate" | "price" | "quantity">,
  product: Product | undefined,
  fallbackIvaRate = 0
): HistoricalTaxBreakdown {
  const dynamicItem = item as unknown as Record<string, unknown>;
  const dynamicProduct = product as unknown as Record<string, unknown> | undefined;

  const ivaRateRaw =
    item.taxRate ??
    getDynamicNumber(dynamicProduct, ["taxRate", "ivaRate"]);

  const normalizeTaxRatePercent = (value: unknown): number | undefined => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) return undefined;

    // SaleItem.taxRate llega del motor de ventas como decimal (0.19),
    // mientras Product.taxRate/companyConfigStore.tax usan porcentaje (19).
    return numeric <= 1 ? numeric * 100 : numeric;
  };

  const ivaRate =
    normalizeTaxRatePercent(ivaRateRaw) ??
    normalizeTaxRatePercent(fallbackIvaRate) ??
    0;

  const impoconsumoRateRaw =
    getDynamicNumber(dynamicItem, [
      "impoconsumoRate",
      "impoConsumoRate",
      "consumptionTaxRate"
    ]) ??
    getDynamicNumber(dynamicProduct, [
      "impoconsumoRate",
      "impoConsumoRate",
      "consumptionTaxRate"
    ]);

  const impoconsumoRate =
    normalizeTaxRatePercent(impoconsumoRateRaw) ?? 0;

  const itemPriceIncludesTax = getDynamicBoolean(dynamicItem, [
    "priceIncludesTax",
    "taxIncluded"
  ]);
  const productPriceIncludesTax = getDynamicBoolean(dynamicProduct, [
    "priceIncludesTax",
    "taxIncluded"
  ]);
  const priceIncludesTax =
    itemPriceIncludesTax === true || productPriceIncludesTax === true;

  const grossRevenue = fixed2(
    Math.max(0, item.price) * Math.max(0, item.quantity)
  );

  const combinedRate = (ivaRate + impoconsumoRate) / 100;
  const estimatedTaxRate =
    ivaRateRaw === undefined && fallbackIvaRate > 0;

  if (!priceIncludesTax) {
    // En el POS actual de VIMDY el precio del item es la base gravable y el
    // impuesto se suma al total de la venta. Por eso el ingreso propio del
    // negocio es grossRevenue; el impuesto se reporta como pasivo separado.
    const ivaAmount = fixed2(grossRevenue * ivaRate / 100);
    const impoconsumoAmount = fixed2(
      grossRevenue * impoconsumoRate / 100
    );

    return {
      baseRevenue: grossRevenue,
      ivaRate,
      ivaAmount,
      impoconsumoRate,
      impoconsumoAmount,
      totalIndirectTax: fixed2(ivaAmount + impoconsumoAmount),
      priceIncludesTax: false,
      estimatedTaxRate
    };
  }

  const divisor = 1 + combinedRate;
  const baseRevenue = divisor > 0
    ? fixed2(grossRevenue / divisor)
    : grossRevenue;

  const ivaAmount = fixed2(baseRevenue * ivaRate / 100);
  const impoconsumoAmount = fixed2(
    baseRevenue * impoconsumoRate / 100
  );

  return {
    baseRevenue,
    ivaRate,
    ivaAmount,
    impoconsumoRate,
    impoconsumoAmount,
    totalIndirectTax: fixed2(ivaAmount + impoconsumoAmount),
    priceIncludesTax: true,
    estimatedTaxRate
  };
}

export function getHistoricalLineProfit(
  item: Pick<
    SaleItem,
    "productId" | "quantity" | "price" | "unitCostAtSale" | "costUnreliableAtSale" | "taxRate"
  >,
  options?: HistoricalProfitOptions
): HistoricalLineProfitResult {
  const quantity = finiteNonNegative(item.quantity);
  const price = finiteNonNegative(item.price);
  const product = options?.product;

  const taxBreakdown = resolveTaxBreakdown(
    item,
    product,
    Math.max(0, options?.fallbackIvaRate ?? 0)
  );

  const revenue = fixed2(price * quantity);
  const netRevenue = fixed2(
    taxBreakdown.priceIncludesTax
      ? taxBreakdown.baseRevenue
      : revenue
  );

  const historicalCost = resolveCost(item, options);

  if (
    historicalCost.unitCost === null ||
    !historicalCost.reliable
  ) {
    return {
      cost: 0,
      profit: 0,
      costUnreliable: true,
      revenue,
      netRevenue,
      ivaAmount: taxBreakdown.ivaAmount,
      impoconsumoAmount: taxBreakdown.impoconsumoAmount,
      totalIndirectTax: taxBreakdown.totalIndirectTax,
      historicalCost,
      taxBreakdown
    };
  }

  const cost = fixed2(historicalCost.unitCost * quantity);
  const profit = fixed2(netRevenue - cost);

  return {
    cost,
    profit,
    costUnreliable: false,
    revenue,
    netRevenue,
    ivaAmount: taxBreakdown.ivaAmount,
    impoconsumoAmount: taxBreakdown.impoconsumoAmount,
    totalIndirectTax: taxBreakdown.totalIndirectTax,
    historicalCost,
    taxBreakdown
  };
}

export function calculateHistoricalProductProfit(
  product: Product,
  items: readonly Pick<
    SaleItem,
    "productId" | "quantity" | "price" | "unitCostAtSale" | "costUnreliableAtSale" | "taxRate"
  >[],
  options?: Omit<HistoricalProfitOptions, "product">
): HistoricalLineProfitResult {
  const relevant = items.filter((item) => item.productId === product.id);

  return relevant.reduce<HistoricalLineProfitResult>(
    (total, item) => {
      const line = getHistoricalLineProfit(item, {
        ...options,
        product
      });

      return {
        cost: fixed2(total.cost + line.cost),
        profit: fixed2(total.profit + line.profit),
        costUnreliable: total.costUnreliable || line.costUnreliable,
        revenue: fixed2(total.revenue + line.revenue),
        netRevenue: fixed2(total.netRevenue + line.netRevenue),
        ivaAmount: fixed2(total.ivaAmount + line.ivaAmount),
        impoconsumoAmount: fixed2(
          total.impoconsumoAmount + line.impoconsumoAmount
        ),
        totalIndirectTax: fixed2(
          total.totalIndirectTax + line.totalIndirectTax
        ),
        historicalCost: line.historicalCost,
        taxBreakdown: line.taxBreakdown
      };
    },
    {
      cost: 0,
      profit: 0,
      costUnreliable: false,
      revenue: 0,
      netRevenue: 0,
      ivaAmount: 0,
      impoconsumoAmount: 0,
      totalIndirectTax: 0,
      historicalCost: {
        unitCost: null,
        reliable: false,
        source: "MISSING"
      },
      taxBreakdown: {
        baseRevenue: 0,
        ivaRate: 0,
        ivaAmount: 0,
        impoconsumoRate: 0,
        impoconsumoAmount: 0,
        totalIndirectTax: 0,
        priceIncludesTax: false,
        estimatedTaxRate: false
      }
    }
  );
}
