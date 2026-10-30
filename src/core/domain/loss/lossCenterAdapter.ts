/**
 * lossCenterAdapter — puente PURO entre el Kardex y el Centro de Pérdidas.
 * ---------------------------------------------------------------------------
 * Convierte datos del negocio (InventoryMovement, Product) en:
 *   - `LossRecord[]` para `lossEngine` (usa `normalizeLossCategory`),
 *   - `LossInventoryItem[]` para el cruce con inventario,
 *   - lotes por vencer (para `findExpiryRisk`),
 *   - `LossRow[]` para `LossCenterDashboard` (stock actual, cantidad
 *     disponible del periodo y desglose por categoría).
 *
 * Sin React, sin stores, sin reloj: todo entra por parámetros, así es testeable
 * y determinista. Nunca muta sus argumentos.
 */
import type { InventoryMovement, Product } from "../../entities/Entities";
import type { LossBucket, LossCategoryKey, LossRow } from "../../../presentation/components/loss/LossCenterDashboard";
import {
  LOSS_CATEGORIES,
  computeLossCost,
  normalizeLossCategory,
  toLossTimestamp,
  type LossCategory,
  type LossInventoryItem,
  type LossRecord
} from "./lossEngine";

/* ========================================================================== */
/* Categorías: motor (MAYÚSCULAS) ↔ dashboard (minúsculas)                     */
/* ========================================================================== */

export const LOSS_CATEGORY_TO_KEY: Readonly<Record<LossCategory, LossCategoryKey>> = {
  VENCIMIENTO: "vencimiento",
  DESPERDICIO: "desperdicio",
  MERMA_PREPARACION: "merma_preparacion",
  CORTESIA: "cortesia",
  FALTANTE: "faltante"
};

/**
 * Qué hacer con un motivo que el motor no reconoce (hoy: "OTRO"). El motor
 * devuelve null a propósito y deja decidir al llamador; aquí se decide de forma
 * EXPLÍCITA: una salida sin motivo claro es una diferencia sin explicación, que
 * es justo la definición de FALTANTE. Cada caso se cuenta en `unmappedCount`
 * para que la pantalla no lo esconda.
 */
export const UNMAPPED_LOSS_FALLBACK: LossCategory = "FALTANTE";

/* ========================================================================== */
/* Costo unitario                                                             */
/* ========================================================================== */

/** Costo unitario de un producto según RecipeEngine (null = no confiable / desconocido). */
export interface LossUnitCost {
  readonly cost: number;
  readonly costUnreliable: boolean;
}

function reliableUnitCost(cost: LossUnitCost | undefined): number | null {
  if (!cost || cost.costUnreliable) return null;
  return Number.isFinite(cost.cost) && cost.cost >= 0 ? cost.cost : null;
}

/* ========================================================================== */
/* 1. Movimientos → LossRecord                                                */
/* ========================================================================== */

export interface MovementsToRecordsResult {
  readonly records: LossRecord[];
  /** Movimientos cuyo motivo no se reconoció y se asignaron a `UNMAPPED_LOSS_FALLBACK`. */
  readonly unmappedCount: number;
}

/** Solo las salidas de stock con motivo de pérdida son pérdidas (las ventas no). */
export function isLossMovement(movement: InventoryMovement): boolean {
  return movement.type === "DECREASE" && !!movement.lossCategory;
}

export function movementsToLossRecords(
  movements: readonly InventoryMovement[],
  productById: ReadonlyMap<string, Product>,
  unitCosts: ReadonlyMap<string, LossUnitCost>
): MovementsToRecordsResult {
  const records: LossRecord[] = [];
  let unmappedCount = 0;

  for (const movement of movements) {
    if (!isLossMovement(movement)) continue;

    const normalized = normalizeLossCategory(movement.lossCategory);
    if (normalized === null) unmappedCount += 1;

    const product = productById.get(movement.productId);
    records.push({
      id: movement.id,
      itemId: movement.productId,
      itemName: movement.productName ?? product?.name,
      category: normalized ?? UNMAPPED_LOSS_FALLBACK,
      quantity: movement.quantity,
      // Costo no confiable => null: el motor cuenta las unidades pero NO suma
      // dinero inventado (mismo criterio que costUnreliable del Centro de Ganancias).
      unitCost: reliableUnitCost(unitCosts.get(movement.productId)),
      occurredAt: movement.date,
      note: movement.reason,
      reportedBy: movement.performedBy
    });
  }

  return { records, unmappedCount };
}

/* ========================================================================== */
/* 2. Productos → LossInventoryItem                                           */
/* ========================================================================== */

/**
 * Foto del inventario para el motor. Los productos con stock enmascarado
 * (conteo a ciegas) NO se incluyen: su `stock` no es una cantidad real.
 * `expiresAt` se deja vacío a propósito: el vencimiento vive por LOTE en el
 * Kardex (ver `buildExpiringLots`), no en el producto.
 */
export function productsToLossInventory(
  products: readonly Product[],
  unitCosts: ReadonlyMap<string, LossUnitCost>
): LossInventoryItem[] {
  const items: LossInventoryItem[] = [];
  for (const product of products) {
    if (product.stockMasked) continue;
    items.push({
      id: product.id,
      name: product.name,
      unit: product.unit,
      stock: product.stock,
      unitCost: reliableUnitCost(unitCosts.get(product.id))
    });
  }
  return items;
}

/* ========================================================================== */
/* 3. Lotes por vencer                                                        */
/* ========================================================================== */

/** "YYYY-MM-DD" → ms de ese día a las 00:00 UTC (calendario puro, sin zona horaria). */
export function isoDayToUtcMs(isoDay: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(isoDay);
  if (!match) return null;
  const ms = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  return Number.isFinite(ms) ? ms : null;
}

/**
 * Lotes con vencimiento que AÚN tienen existencias, uno por lote, listos para
 * `findExpiryRisk`.
 *
 * El Kardex guarda `expiresAt` solo en las ENTRADAS (lotes). El stock actual es
 * la verdad, así que se reparte entre los lotes con FIFO: lo más viejo se
 * consume primero, por lo tanto el stock que queda pertenece a los lotes MÁS
 * RECIENTES. Se recorre del lote más nuevo al más viejo asignando stock hasta
 * agotarlo. Es una aproximación (el sistema no descuenta por lote), pero es la
 * que evita alertar por lotes ya consumidos.
 *
 * Calendario: el vencimiento es un día, no un instante. `expiresAt` se pasa
 * como día UTC-naive y `todayIsoDay` (el "hoy" del NEGOCIO) igual, así
 * `daysLeft` del motor es exacto: 0 = vence hoy, <0 = ya vencido.
 */
export function buildExpiringLots(
  movements: readonly InventoryMovement[],
  products: readonly Product[],
  unitCosts: ReadonlyMap<string, LossUnitCost>
): LossInventoryItem[] {
  const productById = new Map(products.map((p) => [p.id, p]));
  const lotsByProduct = new Map<string, InventoryMovement[]>();

  for (const movement of movements) {
    if (movement.type !== "INCREASE" || !movement.expiresAt) continue;
    if (!(movement.quantity > 0) || !Number.isFinite(movement.quantity)) continue;
    const list = lotsByProduct.get(movement.productId) ?? [];
    list.push(movement);
    lotsByProduct.set(movement.productId, list);
  }

  const lots: LossInventoryItem[] = [];
  for (const [productId, entries] of lotsByProduct) {
    const product = productById.get(productId);
    if (!product || product.stockMasked) continue;
    let remaining = Number.isFinite(product.stock) ? product.stock : 0;
    if (remaining <= 0) continue;

    const newestFirst = [...entries].sort(
      (a, b) => (toLossTimestamp(b.date) ?? 0) - (toLossTimestamp(a.date) ?? 0)
    );
    for (const entry of newestFirst) {
      if (remaining <= 0) break;
      const inLot = Math.min(entry.quantity, remaining);
      remaining -= inLot;
      const expiresMs = entry.expiresAt ? isoDayToUtcMs(entry.expiresAt) : null;
      if (expiresMs === null) continue;
      lots.push({
        id: product.id,
        name: product.name,
        unit: product.unit,
        stock: inLot,
        unitCost: reliableUnitCost(unitCosts.get(product.id)),
        expiresAt: expiresMs
      });
    }
  }
  return lots;
}

/* ========================================================================== */
/* 4. Filas del dashboard                                                     */
/* ========================================================================== */

export interface BuildLossRowsParams {
  /** Pérdidas del periodo ya filtradas (salida de `movementsToLossRecords` + periodo). */
  readonly records: readonly LossRecord[];
  readonly products: readonly Product[];
  /** TODOS los movimientos del kardex (no solo pérdidas): sirven para estimar el stock inicial. */
  readonly movements: readonly InventoryMovement[];
  /** Inicio del periodo (ms) o null si es "todo el histórico". */
  readonly periodFromMs: number | null;
  /** Fin exclusivo del periodo (ms). */
  readonly periodToMs: number;
  readonly unitCosts: ReadonlyMap<string, LossUnitCost>;
}

function movementDeltaForStock(movement: InventoryMovement): number {
  if (movement.type === "INCREASE") return movement.quantity;
  if (movement.type === "DECREASE") return -movement.quantity;
  // ADJUST: la cantidad no es un delta fiable; solo se usa si hay stock antes/después.
  if (Number.isFinite(movement.stockBefore) && Number.isFinite(movement.stockAfter)) {
    return (movement.stockAfter as number) - (movement.stockBefore as number);
  }
  return 0;
}

/**
 * Una fila por ítem con pérdida en el periodo.
 *
 * - `currentStock`: stock actual del producto (puede ser ≤ 0).
 * - `availableQuantity`: stock al inicio del periodo + entradas del periodo,
 *   como pide el dashboard. El stock inicial se reconstruye hacia atrás desde
 *   el actual con los movimientos del periodo. Nunca baja de lo perdido (un
 *   kardex incompleto no puede producir "más del 100 % perdido").
 * - `byCategory`: costo, cantidad e incidentes por categoría del motor.
 */
export function buildLossRows(params: BuildLossRowsParams): LossRow[] {
  const productById = new Map(params.products.map((p) => [p.id, p]));
  const inventoryById = new Map(productsToLossInventory(params.products, params.unitCosts).map((i) => [i.id, i]));
  const rowsById = new Map<
    string,
    { name: string; byCategory: Partial<Record<LossCategoryKey, LossBucket>>; last: number | null }
  >();

  for (const record of params.records) {
    const entry = rowsById.get(record.itemId) ?? {
      name: record.itemName ?? productById.get(record.itemId)?.name ?? record.itemId,
      byCategory: {},
      last: null
    };
    const key = LOSS_CATEGORY_TO_KEY[record.category];
    const previous = entry.byCategory[key] ?? { cost: 0, quantity: 0, incidents: 0 };
    // Mismo costeo que el motor (costo del registro → costo actual → desconocido = 0).
    const { cost, quantity } = computeLossCost(record, inventoryById.get(record.itemId));
    if (quantity <= 0) continue;

    entry.byCategory[key] = {
      cost: previous.cost + cost,
      quantity: previous.quantity + quantity,
      incidents: previous.incidents + 1
    };
    const at = toLossTimestamp(record.occurredAt);
    if (at !== null && (entry.last === null || at > entry.last)) entry.last = at;
    rowsById.set(record.itemId, entry);
  }

  // Movimientos del periodo, por producto, para reconstruir el stock inicial.
  const netInPeriod = new Map<string, number>();
  const incomingInPeriod = new Map<string, number>();
  for (const movement of params.movements) {
    const at = toLossTimestamp(movement.date);
    if (at === null || at >= params.periodToMs) continue;
    if (params.periodFromMs !== null && at < params.periodFromMs) continue;
    netInPeriod.set(movement.productId, (netInPeriod.get(movement.productId) ?? 0) + movementDeltaForStock(movement));
    if (movement.type === "INCREASE" && movement.quantity > 0) {
      incomingInPeriod.set(movement.productId, (incomingInPeriod.get(movement.productId) ?? 0) + movement.quantity);
    }
  }

  const rows: LossRow[] = [];
  for (const [itemId, entry] of rowsById) {
    const product = productById.get(itemId);
    const currentStock = product && !product.stockMasked && Number.isFinite(product.stock) ? product.stock : 0;
    const lostQuantity = LOSS_CATEGORIES.reduce(
      (sum, category) => sum + (entry.byCategory[LOSS_CATEGORY_TO_KEY[category]]?.quantity ?? 0),
      0
    );
    const stockAtStart = Math.max(currentStock - (netInPeriod.get(itemId) ?? 0), 0);
    const available = Math.max(stockAtStart + (incomingInPeriod.get(itemId) ?? 0), lostQuantity);

    rows.push({
      id: itemId,
      name: entry.name,
      kind: product?.isIngredient ? "insumo" : "producto",
      unit: product?.unit || "und",
      currentStock,
      availableQuantity: available,
      byCategory: entry.byCategory,
      lastIncidentAt: entry.last === null ? null : new Date(entry.last)
    });
  }

  return rows.sort((a, b) => a.name.localeCompare(b.name, "es-CO"));
}