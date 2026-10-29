// src/core/domain/purchasing/recommendations.ts
/* ===========================================================================
   Recomendaciones de compra — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   Recibe el inventario y el CONSUMO REAL ya medido (qué cantidad de cada
   insumo se gastó en la última semana y en la anterior) y decide:

     - qué insumos se están agotando,
     - cuánto conviene pedir,
     - qué tan urgente es,
     - y POR QUÉ (con las cifras que lo justifican).

   Este archivo NO sabe de ventas ni de recetas: el consumo llega ya
   expandido por PurchaseIntelligenceEngine con la MISMA lógica que descuenta
   el stock en Caja (InventoryEngine.previewSaleConsumption). Así el cálculo
   de compras y el descuento real de inventario no pueden divergir.

   Reglas que no se negocian:
     - Nunca se recomienda "por si acaso": sin consumo medido y sin estar por
       debajo del mínimo, el insumo no aparece.
     - Un producto con receta se PREPARA, no se compra: se compran sus
       ingredientes. Productos que no manejan stock (servicios) tampoco.
     - Si el stock llega enmascarado (conteo a ciegas) la cantidad no es real:
       el producto se omite y se reporta en el resumen.
=========================================================================== */

import type { Product } from "../../entities/Entities";

export type PurchaseUrgency = "ALTA" | "MEDIA" | "BAJA";

export interface PurchasePlanningConfig {
  /** Días de la ventana con la que se mide el ritmo de consumo actual. */
  readonly windowDays: number;
  /** Días de cobertura que se recomienda comprar de una sola vez. */
  readonly coverageDays: number;
  /** Con este número de días (o menos) de stock restante la urgencia es ALTA. */
  readonly urgentDays: number;
  /** Con este número de días (o menos) de stock restante la urgencia es MEDIA. */
  readonly warningDays: number;
  /** Crecimiento mínimo (%) frente a la ventana anterior para mencionarlo como motivo. */
  readonly growthMentionPercent: number;
  /** Cuántos productos "que más lo mueven" se informan por insumo. */
  readonly maxDrivers: number;
}

export const DEFAULT_PURCHASE_PLANNING_CONFIG: PurchasePlanningConfig = {
  windowDays: 7,
  coverageDays: 14,
  urgentDays: 2,
  warningDays: 5,
  growthMentionPercent: 15,
  maxDrivers: 3
};

/**
 * Consumo medido en una ventana de tiempo.
 * `drivers` dice QUÉ producto vendido causó cada consumo: para un insumo
 * "Carne", { Hamburguesa → 6,3 kg, Combo → 1,2 kg }. Si el producto vendido es
 * el propio insumo (se vendió tal cual), aparece con su mismo id.
 */
export interface ConsumptionWindow {
  /** insumoId → cantidad total consumida en la ventana. */
  readonly totals: ReadonlyMap<string, number>;
  /** insumoId → (productoVendidoId → cantidad de ese insumo que causó). */
  readonly drivers: ReadonlyMap<string, ReadonlyMap<string, number>>;
}

export const EMPTY_CONSUMPTION_WINDOW: ConsumptionWindow = {
  totals: new Map(),
  drivers: new Map()
};

export interface ConsumptionDriver {
  readonly productId: string;
  readonly productName: string;
  /** Cantidad del insumo (en su unidad) que causó este producto en la ventana. */
  readonly quantity: number;
}

/**
 * Una recomendación de compra para UN insumo: todo lo que hace falta para
 * decidir sin sacar calculadora.
 */
export interface PurchaseRecommendation {
  readonly productId: string;
  readonly productName: string;
  readonly unit: string | null;
  readonly currentStock: number;
  readonly recommendedQuantity: number;
  readonly urgency: PurchaseUrgency;
  /** null si no hay ritmo de consumo medible todavía (sin ventas recientes). */
  readonly daysUntilStockout: number | null;
  /** Motivo principal, en una frase. */
  readonly reason: string;
  readonly alert: string;
  /** true si este insumo se consume (también, o solo) porque es ingrediente de algo que se vendió — no porque se venda suelto. */
  readonly consumedViaRecipes: boolean;
  /** false si todavía no hay consumo real medible: la cantidad sugerida es solo "completar hasta el mínimo". */
  readonly basedOnSalesHistory: boolean;

  /* ---- Detalle para explicar el "por qué" (todo derivado de datos reales) ---- */
  readonly minStock: number;
  /** Consumo promedio por día en la ventana reciente (0 si no hay historial). */
  readonly dailyConsumption: number;
  /** Total consumido en la ventana reciente. */
  readonly windowConsumption: number;
  /** Días realmente observados en la ventana reciente (menos de windowDays en un negocio nuevo). */
  readonly observedDays: number;
  /** Cambio (%) del consumo diario frente a la ventana anterior; null si no hay con qué comparar. */
  readonly trendPercent: number | null;
  /** Días de cobertura que se buscó cubrir con la cantidad sugerida. */
  readonly coverageDays: number;
  /** Cantidad sugerida × costo unitario conocido; null si el insumo no tiene costo. */
  readonly estimatedCost: number | null;
  /** Productos vendidos que más consumo causaron, de mayor a menor. */
  readonly drivers: readonly ConsumptionDriver[];
  /** Frases cortas con las cifras detrás de la recomendación. */
  readonly reasonDetails: readonly string[];
}

export interface PurchaseAnalysisSummary {
  /** Productos que se evaluaron como "comprables". */
  readonly analyzedProducts: number;
  /** Productos omitidos porque su stock llega enmascarado (conteo a ciegas). */
  readonly maskedSkipped: number;
  readonly urgent: number;
  readonly warning: number;
  readonly low: number;
  /** Estimado de lo que costaría comprar todo lo sugerido (solo insumos con costo conocido). */
  readonly estimatedTotalCost: number;
  /** false si todavía no hay ninguna venta medible (negocio nuevo). */
  readonly hasSalesHistory: boolean;
  readonly observedDays: number;
}

export interface PurchaseAnalysis {
  readonly recommendations: PurchaseRecommendation[];
  readonly summary: PurchaseAnalysisSummary;
}

export interface BuildRecommendationsInput {
  readonly products: readonly Product[];
  readonly recent: ConsumptionWindow;
  readonly previous: ConsumptionWindow;
  /** Días reales observados en la ventana reciente (1..windowDays). */
  readonly recentDays: number;
  /** Días reales observados en la ventana anterior (1..windowDays). */
  readonly previousDays: number;
  readonly config?: Partial<PurchasePlanningConfig>;
}

/* ---------------------------------------------------------------- utilidades */

/** Redondea hacia arriba sin que el ruido de punto flotante (4.0000000001) suba una unidad de más. */
function ceilClean(value: number): number {
  return Math.ceil(Math.round(value * 1000) / 1000);
}

function round(value: number, decimals = 1): number {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function formatNumber(value: number): string {
  return String(round(value, 2));
}

function withUnit(value: number, unit: string | null): string {
  return unit ? `${formatNumber(value)} ${unit}` : formatNumber(value);
}

/**
 * ¿Este producto se COMPRA? Un producto con receta se prepara (a la orden o
 * por tandas); uno sin control de stock (servicio) no tiene qué comprar.
 */
export function isPurchasableProduct(product: Product): boolean {
  if (product.recipe && product.recipe.length > 0) return false;
  if (product.trackStock === false) return false;
  return true;
}

/** Costo unitario conocido: el promedio ponderado manda sobre el último precio de compra. */
export function resolveUnitCost(product: Product): number | null {
  const cost = product.averageCost && product.averageCost > 0 ? product.averageCost : product.purchasePrice;
  return typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null;
}

/** Una venta consume stock mientras no esté cancelada o reembolsada por completo. */
export function statusConsumesStock(status: string | null | undefined): boolean {
  const normalized = (status ?? "").trim().toUpperCase();
  return normalized !== "CANCELLED" && normalized !== "REFUNDED";
}

function classifyUrgency(
  stock: number,
  daysUntilStockout: number | null,
  belowMinimum: boolean,
  config: PurchasePlanningConfig
): PurchaseUrgency {
  if (stock <= 0 || (daysUntilStockout !== null && daysUntilStockout <= config.urgentDays)) return "ALTA";
  if (belowMinimum || (daysUntilStockout !== null && daysUntilStockout <= config.warningDays)) return "MEDIA";
  return "BAJA";
}

function buildReason(args: {
  basedOnSalesHistory: boolean;
  belowMinimum: boolean;
  stock: number;
  daysUntilStockout: number | null;
  trendPercent: number | null;
  growthMentionPercent: number;
}): string {
  if (!args.basedOnSalesHistory) {
    return args.belowMinimum
      ? "Aún no hay ventas registradas de este producto — se sugiere completar hasta el stock mínimo que definiste."
      : "Aún no hay suficientes ventas para calcular una cantidad recomendada.";
  }
  if (args.stock <= 0) {
    return "Porque ya se agotó y se sigue vendiendo.";
  }
  if (args.trendPercent !== null && args.trendPercent >= args.growthMentionPercent) {
    return `Porque su consumo subió ${args.trendPercent}% frente a la semana anterior.`;
  }
  if (args.belowMinimum) {
    return "Porque ya está en o por debajo del mínimo definido para este producto.";
  }
  if (args.daysUntilStockout !== null) {
    return `Porque al ritmo de consumo actual se agota en ${args.daysUntilStockout} día(s).`;
  }
  return "Porque el stock está bajo y no hay margen de reacción.";
}

function buildAlert(
  productName: string,
  urgency: PurchaseUrgency,
  daysUntilStockout: number | null,
  basedOnSalesHistory: boolean
): string {
  if (!basedOnSalesHistory) {
    return `${productName} no tiene ventas registradas todavía — aún no se puede calcular cuánto se vende por día. Repón hasta tu mínimo definido.`;
  }
  if (urgency === "ALTA") return `Compra ${productName} hoy.`;
  if (urgency === "MEDIA") {
    return daysUntilStockout !== null
      ? `${productName} alcanzará solamente para ${daysUntilStockout} día(s) más.`
      : `${productName} está por debajo del mínimo — revísalo pronto.`;
  }
  return `No necesitas comprar ${productName} todavía${
    daysUntilStockout !== null ? ` (quedan ~${daysUntilStockout} día(s))` : ""
  }.`;
}

function topDrivers(
  ingredientId: string,
  window: ConsumptionWindow,
  nameById: ReadonlyMap<string, string>,
  limit: number
): ConsumptionDriver[] {
  const byProduct = window.drivers.get(ingredientId);
  if (!byProduct) return [];
  return [...byProduct.entries()]
    .filter(([, quantity]) => quantity > 0)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, Math.max(limit, 0))
    .map(([productId, quantity]) => ({
      productId,
      productName: nameById.get(productId) ?? "Producto eliminado",
      quantity: round(quantity, 3)
    }));
}

/* ------------------------------------------------------------------- análisis */

export function buildPurchaseAnalysis(input: BuildRecommendationsInput): PurchaseAnalysis {
  const config: PurchasePlanningConfig = { ...DEFAULT_PURCHASE_PLANNING_CONFIG, ...input.config };
  const recentDays = Math.max(input.recentDays, 1);
  const previousDays = Math.max(input.previousDays, 1);
  const nameById = new Map(input.products.map((product) => [product.id, product.name]));

  const recommendations: PurchaseRecommendation[] = [];
  let analyzedProducts = 0;
  let maskedSkipped = 0;

  for (const product of input.products) {
    if (!isPurchasableProduct(product)) continue;

    // Con el conteo a ciegas activo `stock` es una "banda", no la cantidad
    // real: calcular días de stock con ella daría recomendaciones inventadas.
    if (product.stockMasked) {
      maskedSkipped += 1;
      continue;
    }

    analyzedProducts += 1;

    const windowConsumption = input.recent.totals.get(product.id) ?? 0;
    const dailyNow = windowConsumption / recentDays;
    const dailyBefore = (input.previous.totals.get(product.id) ?? 0) / previousDays;

    const belowMinimum = product.minStock > 0 && product.stock <= product.minStock;

    // Sin ritmo de consumo real y sin estar por debajo del mínimo no hay con
    // qué recomendar nada: nunca se recomienda "por si acaso".
    if (dailyNow <= 0 && !belowMinimum) continue;

    // Stock negativo (Caja permite vender sin stock) = 0 días, nunca negativos.
    const daysUntilStockout = dailyNow > 0 ? Math.max(Math.floor(product.stock / dailyNow), 0) : null;

    const needsAttention =
      belowMinimum || (daysUntilStockout !== null && daysUntilStockout <= config.coverageDays);
    if (!needsAttention) continue;

    // Meta de stock: lo que cubre `coverageDays` de consumo, o el mínimo
    // definido si es mayor. Se pide la diferencia con lo que hay.
    const targetStock = Math.max(dailyNow * config.coverageDays, product.minStock);
    const recommendedQuantity = Math.max(ceilClean(targetStock - product.stock), belowMinimum ? 1 : 0);
    if (recommendedQuantity <= 0) continue;

    const urgency = classifyUrgency(product.stock, daysUntilStockout, belowMinimum, config);
    const unit = product.unit ?? null;
    const basedOnSalesHistory = dailyNow > 0;

    const trendPercent =
      dailyBefore > 0 && dailyNow > 0 ? Math.round(((dailyNow - dailyBefore) / dailyBefore) * 100) : null;

    const drivers = topDrivers(product.id, input.recent, nameById, config.maxDrivers);
    const consumedViaRecipes = drivers.some((driver) => driver.productId !== product.id);

    const unitCost = resolveUnitCost(product);
    const estimatedCost = unitCost !== null ? Math.round(unitCost * recommendedQuantity) : null;

    const reasonDetails: string[] = [];
    if (basedOnSalesHistory) {
      reasonDetails.push(
        `Consumo: ${withUnit(round(dailyNow, 2), unit)} por día (promedio de ${recentDays} día(s)).`
      );
      reasonDetails.push(
        product.stock <= 0
          ? "Stock actual: agotado."
          : `Stock actual: ${withUnit(product.stock, unit)}, alcanza para ~${daysUntilStockout} día(s).`
      );
      reasonDetails.push(
        `Para cubrir ${config.coverageDays} días necesitas ${withUnit(round(dailyNow * config.coverageDays, 2), unit)}.`
      );
    } else {
      reasonDetails.push("Todavía no hay ventas medibles de este insumo.");
      reasonDetails.push(`Stock actual: ${withUnit(product.stock, unit)}.`);
    }
    if (product.minStock > 0) {
      reasonDetails.push(`Mínimo definido: ${withUnit(product.minStock, unit)}.`);
    }
    if (trendPercent !== null && Math.abs(trendPercent) >= config.growthMentionPercent) {
      reasonDetails.push(
        trendPercent > 0
          ? `Su consumo subió ${trendPercent}% frente a la semana anterior.`
          : `Su consumo bajó ${Math.abs(trendPercent)}% frente a la semana anterior.`
      );
    }

    recommendations.push({
      productId: product.id,
      productName: product.name,
      unit,
      currentStock: product.stock,
      recommendedQuantity,
      urgency,
      daysUntilStockout,
      reason: buildReason({
        basedOnSalesHistory,
        belowMinimum,
        stock: product.stock,
        daysUntilStockout,
        trendPercent,
        growthMentionPercent: config.growthMentionPercent
      }),
      alert: buildAlert(product.name, urgency, daysUntilStockout, basedOnSalesHistory),
      consumedViaRecipes,
      basedOnSalesHistory,
      minStock: product.minStock,
      dailyConsumption: round(dailyNow, 3),
      windowConsumption: round(windowConsumption, 3),
      observedDays: recentDays,
      trendPercent,
      coverageDays: config.coverageDays,
      estimatedCost,
      drivers,
      reasonDetails
    });
  }

  const urgencyRank: Record<PurchaseUrgency, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
  recommendations.sort(
    (a, b) =>
      urgencyRank[a.urgency] - urgencyRank[b.urgency] ||
      (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999) ||
      a.productName.localeCompare(b.productName, "es")
  );

  const count = (urgency: PurchaseUrgency) => recommendations.filter((rec) => rec.urgency === urgency).length;

  return {
    recommendations,
    summary: {
      analyzedProducts,
      maskedSkipped,
      urgent: count("ALTA"),
      warning: count("MEDIA"),
      low: count("BAJA"),
      estimatedTotalCost: recommendations.reduce((sum, rec) => sum + (rec.estimatedCost ?? 0), 0),
      hasSalesHistory: input.recent.totals.size > 0 || input.previous.totals.size > 0,
      observedDays: recentDays
    }
  };
}

/** Atajo: solo la lista, ya ordenada por urgencia y días restantes. */
export function buildPurchaseRecommendations(input: BuildRecommendationsInput): PurchaseRecommendation[] {
  return buildPurchaseAnalysis(input).recommendations;
}