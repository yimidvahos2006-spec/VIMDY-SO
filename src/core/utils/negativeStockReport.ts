import type { InventoryMovement, Product } from "../entities/Entities";

/**
 * Reporte de stock en negativo (Opción B).
 *
 * Las ventas nunca se bloquean por falta de stock, así que un insumo o producto puede
 * quedar en números rojos. Esta función pura arma la lista para Inventario; no lee
 * nada del servidor: recibe los productos y (opcional) el Kardex ya cargados.
 *
 * Reglas:
 *  - Solo cuentan los productos activos que manejan stock (trackStock !== false).
 *  - Los productos con stock enmascarado (conteo a ciegas) se excluyen y se cuentan
 *    aparte en `maskedCount`: su `stock` es un valor de banda, nunca la cantidad real.
 *  - El costo del faltante solo se calcula si `includeCosts` es true (permiso
 *    inventory.viewCosts). Igual que el valor del inventario, si a algún producto le
 *    falta el costo el total es `null`: nunca se muestra una suma parcial.
 */

export interface NegativeStockRow {
  readonly productId: string;
  readonly name: string;
  readonly kind: "insumo" | "producto";
  readonly unit?: string;
  /** Stock real (negativo). */
  readonly stock: number;
  /** Cuánto falta para llegar a 0 (siempre positivo). */
  readonly shortage: number;
  /** faltante × costo de compra; null si no hay permiso de costos o falta el costo. */
  readonly shortageCost: number | null;
  /** Inicio de la racha actual en negativo según el Kardex; null si no se puede saber. */
  readonly negativeSince: Date | null;
  /** Último movimiento registrado del producto; null si no hay Kardex. */
  readonly lastMovementAt: Date | null;
}

export interface NegativeStockReport {
  readonly rows: readonly NegativeStockRow[];
  readonly totalCount: number;
  readonly insumoCount: number;
  readonly productCount: number;
  /** Suma de costos de los faltantes; null si no hay permiso o algún costo falta. */
  readonly totalShortageCost: number | null;
  /** Productos que no se pudieron evaluar porque el servidor enmascaró su stock. */
  readonly maskedCount: number;
}

export interface NegativeStockReportOptions {
  readonly includeCosts?: boolean;
  readonly movements?: readonly InventoryMovement[];
}

/** ¿Este producto cuenta como "en negativo"? Fuente única para el reporte y la alerta de Caja. */
export function isNegativeStock(product: Product): boolean {
  return (
    product.active !== false &&
    product.trackStock !== false &&
    product.stockMasked !== true &&
    Number.isFinite(product.stock) &&
    product.stock < 0
  );
}

const toTime = (date: Date): number => new Date(date).getTime();

function analyzeMovements(movements: readonly InventoryMovement[]): {
  negativeSince: Date | null;
  lastMovementAt: Date | null;
} {
  if (movements.length === 0) return { negativeSince: null, lastMovementAt: null };
  const ordered = [...movements].sort((a, b) => toTime(a.date) - toTime(b.date));
  let negativeSince: Date | null = null;
  // true = la racha negativa actual empezó antes del primer movimiento que tenemos
  // (historial recortado): no se puede saber desde cuándo, así que queda en null.
  let startUnknown = false;
  for (const movement of ordered) {
    if (typeof movement.stockAfter !== "number" || !Number.isFinite(movement.stockAfter)) continue;
    if (movement.stockAfter < 0) {
      if (negativeSince === null && !startUnknown) {
        const before = movement.stockBefore;
        if (typeof before === "number" && Number.isFinite(before) && before < 0) startUnknown = true;
        else negativeSince = new Date(movement.date);
      }
    } else {
      negativeSince = null;
      startUnknown = false;
    }
  }
  return { negativeSince, lastMovementAt: new Date(ordered[ordered.length - 1].date) };
}

export function buildNegativeStockReport(
  products: readonly Product[],
  options: NegativeStockReportOptions = {}
): NegativeStockReport {
  const includeCosts = options.includeCosts === true;

  const movementsByProduct = new Map<string, InventoryMovement[]>();
  for (const movement of options.movements ?? []) {
    const list = movementsByProduct.get(movement.productId);
    if (list) list.push(movement);
    else movementsByProduct.set(movement.productId, [movement]);
  }

  const maskedCount = products.filter(
    (p) => p.active !== false && p.trackStock !== false && p.stockMasked === true
  ).length;

  const rows: NegativeStockRow[] = products.filter(isNegativeStock).map((product) => {
    const shortage = Math.abs(product.stock);
    const cost = product.purchasePrice;
    const hasCost = typeof cost === "number" && Number.isFinite(cost) && cost >= 0;
    const { negativeSince, lastMovementAt } = analyzeMovements(movementsByProduct.get(product.id) ?? []);
    return {
      productId: product.id,
      name: product.name,
      kind: product.isIngredient === true ? "insumo" : "producto",
      unit: product.unit,
      stock: product.stock,
      shortage,
      shortageCost: includeCosts && hasCost ? shortage * cost : null,
      negativeSince,
      lastMovementAt
    };
  });

  // Más negativo primero; desempate por nombre para que el orden sea estable.
  rows.sort((a, b) => b.shortage - a.shortage || a.name.localeCompare(b.name, "es"));

  const totalShortageCost =
    includeCosts && rows.length > 0 && rows.every((r) => r.shortageCost !== null)
      ? rows.reduce((sum, r) => sum + (r.shortageCost as number), 0)
      : null;

  return {
    rows,
    totalCount: rows.length,
    insumoCount: rows.filter((r) => r.kind === "insumo").length,
    productCount: rows.filter((r) => r.kind === "producto").length,
    totalShortageCost,
    maskedCount
  };
}