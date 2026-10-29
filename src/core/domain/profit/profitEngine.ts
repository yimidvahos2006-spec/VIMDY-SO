/**
 * profitEngine — Centro de Ganancias (motor lógico).
 * ---------------------------------------------------------------------------
 * Módulo de dominio PURO y autocontenido: sin imports, sin efectos
 * secundarios, sin acceso a stores/repositorios/fechas/azar. Recibe datos
 * planos y devuelve estructuras nuevas; nunca muta sus argumentos. Por no
 * importar nada del proyecto no puede formar dependencias circulares.
 *
 * Qué calcula:
 *   1. Costo unitario de cada producto (COGS) a partir de su receta y del
 *      costo ACTUAL de cada insumo (soporta sub-recetas, con detección de
 *      ciclos y límite de profundidad).
 *   2. Ingresos, COGS, ganancia bruta, margen bruto %, gastos operativos,
 *      ganancia neta y margen neto %, en total y por producto.
 *   3. Matriz de Menú (Kasavana–Smith): Estrellas, Caballos de batalla,
 *      Rompecabezas y Pesos muertos, cruzando volumen de ventas y margen.
 *
 * Convenciones:
 *   - Los montos están en la unidad monetaria del negocio (COP, etc.); el
 *     motor no redondea salvo que se pida con `roundMoney`.
 *   - Los porcentajes se devuelven en escala 0–100 (25 = 25 %).
 *   - Un dato no finito o negativo en cantidades/precios se trata como 0
 *     (nunca produce NaN/Infinity en la salida).
 *   - Un margen sobre ingresos 0 es 0 (no se divide entre cero).
 */

/* ========================================================================== */
/* Tipos de entrada                                                           */
/* ========================================================================== */

/** Una línea de receta: cuánto de un insumo (o sub-receta) consume 1 unidad vendida. */
export interface ProfitRecipeLine {
  readonly ingredientId: string;
  /** Cantidad por unidad vendida, en la misma unidad en que se mide `unitCost` del insumo. */
  readonly quantity: number;
}

/**
 * Un ítem del catálogo: puede ser un insumo (con `unitCost`), un producto de
 * venta con receta (`recipe`), o ambos (un producto por tandas que también se
 * usa como ingrediente). Si tiene receta, el costo se deriva de ella; si no,
 * se usa `unitCost`.
 */
export interface ProfitCatalogItem {
  readonly id: string;
  readonly name: string;
  /** Costo actual por unidad (último/promedio ponderado). Ignorado si hay receta. */
  readonly unitCost?: number | null;
  readonly recipe?: readonly ProfitRecipeLine[];
}

/** Una línea de venta ya consolidada (una por producto vendido en la venta). */
export interface ProfitSaleLine {
  readonly productId: string;
  readonly quantity: number;
  /** Precio unitario cobrado (antes de descuentos de línea). */
  readonly unitPrice: number;
  /** Descuento total aplicado a la línea (monto, no porcentaje). */
  readonly discount?: number;
  /** Unidades devueltas/reembolsadas de esta línea. */
  readonly refundedQuantity?: number;
}

export interface ProfitOperatingExpense {
  readonly label: string;
  readonly amount: number;
}

export interface ProfitInput {
  readonly catalog: readonly ProfitCatalogItem[];
  readonly sales: readonly ProfitSaleLine[];
  /** Gastos operativos del periodo (nómina, arriendo, servicios…). */
  readonly operatingExpenses?: readonly ProfitOperatingExpense[];
}

/* ========================================================================== */
/* Tipos de salida                                                            */
/* ========================================================================== */

/** Resultado de costear un ítem. */
export interface UnitCostResult {
  readonly productId: string;
  /** Costo por unidad. Si faltan datos es un costo PARCIAL (solo lo conocido). */
  readonly unitCost: number;
  /** false si algún insumo no existe, no tiene costo, o la receta tiene un ciclo. */
  readonly complete: boolean;
  /** Ids de insumos sin costo o inexistentes que impidieron un costo completo. */
  readonly missingIngredientIds: readonly string[];
  /** true si se detectó un ciclo o se superó la profundidad máxima. */
  readonly hasCycle: boolean;
}

export interface ProductProfit {
  readonly productId: string;
  readonly productName: string;
  readonly unitsSold: number;
  readonly revenue: number;
  readonly cogs: number;
  readonly grossProfit: number;
  /** Margen bruto % sobre ingresos (0–100). */
  readonly grossMarginPercent: number;
  /** Precio promedio realmente cobrado por unidad (ingresos / unidades). */
  readonly averagePrice: number;
  /** Costo unitario actual de la receta. */
  readonly unitCost: number;
  /** Ganancia por unidad vendida (contribución). */
  readonly unitProfit: number;
  /** false si el costo es parcial: el margen real puede ser menor al mostrado. */
  readonly costKnown: boolean;
}

export interface ProfitSummary {
  readonly revenue: number;
  readonly cogs: number;
  readonly grossProfit: number;
  /** Margen bruto % sobre ingresos (0–100). */
  readonly grossMarginPercent: number;
  readonly operatingExpenses: number;
  readonly netProfit: number;
  /** Margen neto % sobre ingresos (0–100). */
  readonly netMarginPercent: number;
  readonly unitsSold: number;
  /** Por producto, de mayor a menor ganancia bruta. */
  readonly products: readonly ProductProfit[];
  /** Productos vendidos cuyo costo está incompleto (COGS subestimado). */
  readonly productsWithIncompleteCost: readonly string[];
  /** Ventas con un productId que no existe en el catálogo (se cuentan como ingreso sin costo). */
  readonly unknownProductIds: readonly string[];
}

/* -------------------------------- Matriz ---------------------------------- */

export type MenuMatrixCategory = "ESTRELLA" | "CABALLO_DE_BATALLA" | "ROMPECABEZAS" | "PESO_MUERTO";

export const MENU_MATRIX_LABELS: Readonly<Record<MenuMatrixCategory, string>> = {
  ESTRELLA: "Estrella",
  CABALLO_DE_BATALLA: "Caballo de batalla",
  ROMPECABEZAS: "Rompecabezas",
  PESO_MUERTO: "Peso muerto"
};

/** Qué acción sugiere cada categoría (texto corto para el dueño). */
export const MENU_MATRIX_ADVICE: Readonly<Record<MenuMatrixCategory, string>> = {
  ESTRELLA: "Véndelo más y protégelo: vende mucho y deja buen margen.",
  CABALLO_DE_BATALLA: "Sube el precio un poco o baja su costo: vende mucho pero deja poco.",
  ROMPECABEZAS: "Promociónalo y destácalo en el menú: deja buen margen pero se vende poco.",
  PESO_MUERTO: "Replantéalo o retíralo: vende poco y deja poco."
};

/** Con qué medida se decide si un margen es "alto". */
export type MarginBasis = "UNIT_PROFIT" | "MARGIN_PERCENT";

export interface MenuMatrixOptions {
  /**
   * Medida de margen. UNIT_PROFIT (por defecto, Kasavana–Smith): ganancia por
   * unidad en dinero. MARGIN_PERCENT: margen bruto %.
   */
  readonly marginBasis?: MarginBasis;
  /**
   * Factor del umbral de popularidad. Un producto es "popular" si su parte de
   * las unidades vendidas es >= (1 / n) * factor. Por defecto 0.7 (regla del 70 %).
   */
  readonly popularityFactor?: number;
  /** Fija el umbral de popularidad (parte de unidades, 0–1) y anula `popularityFactor`. */
  readonly popularityThreshold?: number;
  /** Fija el umbral de margen (en la unidad de `marginBasis`) y anula el promedio ponderado. */
  readonly marginThreshold?: number;
  /** Ventas mínimas (unidades) para clasificar; por debajo queda sin clasificar. Por defecto 1. */
  readonly minUnits?: number;
}

export interface MenuMatrixItem {
  readonly productId: string;
  readonly productName: string;
  readonly category: MenuMatrixCategory;
  readonly unitsSold: number;
  /** Parte de las unidades vendidas del menú (0–1). */
  readonly popularityShare: number;
  readonly unitProfit: number;
  readonly grossMarginPercent: number;
  readonly revenue: number;
  readonly grossProfit: number;
}

export interface MenuMatrixResult {
  readonly items: readonly MenuMatrixItem[];
  readonly byCategory: Readonly<Record<MenuMatrixCategory, readonly MenuMatrixItem[]>>;
  readonly thresholds: {
    readonly marginBasis: MarginBasis;
    /** Parte mínima de unidades (0–1) para ser "popular". */
    readonly popularity: number;
    /** Margen mínimo (en la unidad de `marginBasis`) para ser "alto". */
    readonly margin: number;
  };
  /** Productos sin clasificar y por qué (sin costo completo o sin ventas suficientes). */
  readonly unclassified: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly reason: "COSTO_INCOMPLETO" | "SIN_VENTAS_SUFICIENTES";
  }[];
}

/* ========================================================================== */
/* Utilidades numéricas                                                       */
/* ========================================================================== */

/** Máxima profundidad de sub-recetas (receta que usa otra receta). */
export const MAX_RECIPE_DEPTH = 8;

/** Número finito y no negativo, o 0. */
function safe(value: number | null | undefined): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0;
}

/** Porcentaje `part / whole * 100`; 0 si el total es 0. */
function percentOf(part: number, whole: number): number {
  return whole > 0 && Number.isFinite(part) ? (part / whole) * 100 : 0;
}

/** Redondea un monto a `digits` decimales (0 para COP). Pura; úsala solo al presentar. */
export function roundMoney(value: number, digits = 0): number {
  if (!Number.isFinite(value)) return 0;
  const factor = 10 ** Math.max(0, Math.floor(digits));
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

/* ========================================================================== */
/* 1. Costeo (COGS por receta)                                                */
/* ========================================================================== */

interface CostState {
  readonly byId: ReadonlyMap<string, ProfitCatalogItem>;
  readonly memo: Map<string, UnitCostResult>;
}

function costItem(id: string, state: CostState, path: readonly string[]): UnitCostResult {
  const cached = state.memo.get(id);
  if (cached) return cached;

  const item = state.byId.get(id);
  if (!item) {
    return { productId: id, unitCost: 0, complete: false, missingIngredientIds: [id], hasCycle: false };
  }

  const recipe = item.recipe ?? [];
  if (recipe.length === 0) {
    const cost = safe(item.unitCost);
    const known = typeof item.unitCost === "number" && Number.isFinite(item.unitCost) && item.unitCost >= 0;
    const result: UnitCostResult = {
      productId: id,
      unitCost: cost,
      complete: known,
      missingIngredientIds: known ? [] : [id],
      hasCycle: false
    };
    state.memo.set(id, result);
    return result;
  }

  if (path.includes(id) || path.length >= MAX_RECIPE_DEPTH) {
    // Ciclo o receta demasiado profunda: no se memoiza, depende del camino.
    return { productId: id, unitCost: 0, complete: false, missingIngredientIds: [], hasCycle: true };
  }

  const nextPath = [...path, id];
  let total = 0;
  let complete = true;
  let hasCycle = false;
  const missing = new Set<string>();

  for (const line of recipe) {
    const child = costItem(line.ingredientId, state, nextPath);
    total += child.unitCost * safe(line.quantity);
    if (!child.complete) complete = false;
    if (child.hasCycle) hasCycle = true;
    for (const m of child.missingIngredientIds) missing.add(m);
  }

  const result: UnitCostResult = {
    productId: id,
    unitCost: total,
    complete,
    missingIngredientIds: [...missing],
    hasCycle
  };
  // Solo se memoiza si el resultado no depende de la ruta (sin ciclo).
  if (!hasCycle) state.memo.set(id, result);
  return result;
}

/**
 * Costea un ítem a partir de su receta y del costo actual de sus insumos.
 * No lanza: un insumo sin costo o un ciclo producen un costo parcial con
 * `complete: false` para que la pantalla pueda avisarlo.
 */
export function computeUnitCost(productId: string, catalog: readonly ProfitCatalogItem[]): UnitCostResult {
  const state: CostState = { byId: new Map(catalog.map((item) => [item.id, item])), memo: new Map() };
  return costItem(productId, state, []);
}

/* ========================================================================== */
/* 2. Ingresos, COGS, ganancia bruta/neta y márgenes                          */
/* ========================================================================== */

interface ProductAccumulator {
  units: number;
  revenue: number;
}

/**
 * Calcula el resumen de ganancias del periodo.
 *
 *   ingresos      = Σ (unidades netas × precio − descuento proporcional)
 *   COGS          = Σ (unidades netas × costo unitario actual de la receta)
 *   ganancia bruta = ingresos − COGS
 *   margen bruto  = ganancia bruta / ingresos
 *   ganancia neta = ganancia bruta − gastos operativos
 *
 * Unidades netas = vendidas − reembolsadas. El descuento de la línea se
 * reparte proporcionalmente a las unidades que se quedan.
 */
export function computeProfitSummary(input: ProfitInput): ProfitSummary {
  const state: CostState = { byId: new Map(input.catalog.map((item) => [item.id, item])), memo: new Map() };
  const accumulators = new Map<string, ProductAccumulator>();
  const unknown = new Set<string>();

  for (const line of input.sales) {
    const sold = safe(line.quantity);
    const refunded = Math.min(safe(line.refundedQuantity), sold);
    const netUnits = sold - refunded;
    if (netUnits <= 0) continue;

    const gross = netUnits * safe(line.unitPrice);
    const discountShare = sold > 0 ? Math.min(safe(line.discount), sold * safe(line.unitPrice)) * (netUnits / sold) : 0;
    const lineRevenue = Math.max(gross - discountShare, 0);

    if (!state.byId.has(line.productId)) unknown.add(line.productId);

    const acc = accumulators.get(line.productId) ?? { units: 0, revenue: 0 };
    acc.units += netUnits;
    acc.revenue += lineRevenue;
    accumulators.set(line.productId, acc);
  }

  const products: ProductProfit[] = [];
  const incomplete: string[] = [];
  let revenue = 0;
  let cogs = 0;
  let unitsSold = 0;

  for (const [productId, acc] of accumulators) {
    const cost = costItem(productId, state, []);
    const productCogs = acc.units * cost.unitCost;
    const grossProfit = acc.revenue - productCogs;
    const averagePrice = acc.units > 0 ? acc.revenue / acc.units : 0;

    if (!cost.complete) incomplete.push(productId);
    revenue += acc.revenue;
    cogs += productCogs;
    unitsSold += acc.units;

    products.push({
      productId,
      productName: state.byId.get(productId)?.name ?? productId,
      unitsSold: acc.units,
      revenue: acc.revenue,
      cogs: productCogs,
      grossProfit,
      grossMarginPercent: percentOf(grossProfit, acc.revenue),
      averagePrice,
      unitCost: cost.unitCost,
      unitProfit: averagePrice - cost.unitCost,
      costKnown: cost.complete
    });
  }

  products.sort((a, b) => b.grossProfit - a.grossProfit || a.productName.localeCompare(b.productName));

  const operatingExpenses = (input.operatingExpenses ?? []).reduce((sum, e) => sum + safe(e.amount), 0);
  const grossProfitTotal = revenue - cogs;
  const netProfit = grossProfitTotal - operatingExpenses;

  return {
    revenue,
    cogs,
    grossProfit: grossProfitTotal,
    grossMarginPercent: percentOf(grossProfitTotal, revenue),
    operatingExpenses,
    netProfit,
    netMarginPercent: percentOf(netProfit, revenue),
    unitsSold,
    products,
    productsWithIncompleteCost: incomplete,
    unknownProductIds: [...unknown]
  };
}

/* ========================================================================== */
/* 3. Matriz de Menú (Kasavana–Smith)                                         */
/* ========================================================================== */

const EMPTY_CATEGORIES = (): Record<MenuMatrixCategory, MenuMatrixItem[]> => ({
  ESTRELLA: [],
  CABALLO_DE_BATALLA: [],
  ROMPECABEZAS: [],
  PESO_MUERTO: []
});

/** Decide la categoría a partir de popularidad y margen ya comparados con sus umbrales. */
export function classifyMenuItem(isPopular: boolean, isHighMargin: boolean): MenuMatrixCategory {
  if (isPopular) return isHighMargin ? "ESTRELLA" : "CABALLO_DE_BATALLA";
  return isHighMargin ? "ROMPECABEZAS" : "PESO_MUERTO";
}

function marginOf(product: ProductProfit, basis: MarginBasis): number {
  return basis === "UNIT_PROFIT" ? product.unitProfit : product.grossMarginPercent;
}

/**
 * Clasifica los productos vendidos en la Matriz de Menú.
 *
 * - Popularidad: parte de las unidades vendidas del menú. "Popular" si
 *   >= (1/n) × 0.7 (n = productos clasificables), o el umbral fijado.
 * - Margen: por defecto la ganancia por unidad. "Alto" si es >= al margen
 *   promedio PONDERADO por unidades (o el umbral fijado).
 *
 *   Popular + margen alto  → ESTRELLA
 *   Popular + margen bajo  → CABALLO_DE_BATALLA
 *   Poco popular + alto    → ROMPECABEZAS
 *   Poco popular + bajo    → PESO_MUERTO
 *
 * Un producto con costo incompleto o sin ventas suficientes NO se clasifica
 * (su margen sería inventado) y se informa en `unclassified`.
 */
export function classifyMenuMatrix(
  products: readonly ProductProfit[],
  options: MenuMatrixOptions = {}
): MenuMatrixResult {
  const basis: MarginBasis = options.marginBasis ?? "UNIT_PROFIT";
  const minUnits = options.minUnits !== undefined ? safe(options.minUnits) : 1;

  const unclassified: MenuMatrixResult["unclassified"][number][] = [];
  const eligible: ProductProfit[] = [];

  for (const product of products) {
    if (product.unitsSold < minUnits || product.unitsSold <= 0) {
      unclassified.push({
        productId: product.productId,
        productName: product.productName,
        reason: "SIN_VENTAS_SUFICIENTES"
      });
    } else if (!product.costKnown) {
      unclassified.push({
        productId: product.productId,
        productName: product.productName,
        reason: "COSTO_INCOMPLETO"
      });
    } else {
      eligible.push(product);
    }
  }

  const totalUnits = eligible.reduce((sum, p) => sum + p.unitsSold, 0);
  const factor = options.popularityFactor !== undefined ? safe(options.popularityFactor) : 0.7;
  const popularityThreshold =
    options.popularityThreshold !== undefined
      ? safe(options.popularityThreshold)
      : eligible.length > 0
        ? (1 / eligible.length) * factor
        : 0;

  const weightedMargin =
    totalUnits > 0 ? eligible.reduce((sum, p) => sum + marginOf(p, basis) * p.unitsSold, 0) / totalUnits : 0;
  const marginThreshold = options.marginThreshold !== undefined ? options.marginThreshold : weightedMargin;

  const byCategory = EMPTY_CATEGORIES();
  const items: MenuMatrixItem[] = eligible.map((product) => {
    const share = totalUnits > 0 ? product.unitsSold / totalUnits : 0;
    const category = classifyMenuItem(share >= popularityThreshold, marginOf(product, basis) >= marginThreshold);
    const item: MenuMatrixItem = {
      productId: product.productId,
      productName: product.productName,
      category,
      unitsSold: product.unitsSold,
      popularityShare: share,
      unitProfit: product.unitProfit,
      grossMarginPercent: product.grossMarginPercent,
      revenue: product.revenue,
      grossProfit: product.grossProfit
    };
    byCategory[category].push(item);
    return item;
  });

  return {
    items,
    byCategory,
    thresholds: { marginBasis: basis, popularity: popularityThreshold, margin: marginThreshold },
    unclassified
  };
}

/** Atajo: del input crudo a la Matriz de Menú en una sola llamada. */
export function buildMenuMatrix(input: ProfitInput, options: MenuMatrixOptions = {}): MenuMatrixResult {
  return classifyMenuMatrix(computeProfitSummary(input).products, options);
}