import type { LossCategory, Product } from "../entities/Entities";

/**
 * Lógica pura del conteo guiado (sin base de datos ni pantalla), para poder
 * probarla sola.
 *
 * OJO (conteo a ciegas): las cifras del sistema ya NO se calculan en el cliente.
 * `selectProductsForCount` solo sirve para la vista previa ("≈ 5 min · 20 por
 * contar"); la selección real, las fotos de stock y las diferencias las hace el
 * servidor. `buildCountLines` y `computeDifferences` se conservan por
 * compatibilidad con las pruebas existentes, pero la pantalla ya no los usa
 * para datos reales.
 */

export type CountKind = "todo" | "insumos" | "productos";

export type CountScope =
  | { mode: "all" }
  | { mode: "category"; categoryId: string }
  | { mode: "top"; limit: number };

export interface CountLine {
  productId: string;
  name: string;
  unit?: string;
  categoryId: string;
  /**
   * Lo que decía el sistema al abrir el conteo (solo referencia).
   * SOLO LO RECIBEN los roles autorizados a ver diferencias: para quien cuenta el
   * servidor no la entrega (llega `undefined`). Ver inventoryCountAccess.ts.
   */
  systemStockAtStart?: number;
  /** Lo que se contó. `null` = todavía no contado (no se ajusta). */
  counted: number | null;
  /**
   * Lo que decía el sistema en el momento en que se digitó esta cantidad. Es la base para
   * calcular la diferencia: así las ventas o compras que ocurran después no se confunden
   * con sobrantes o faltantes. Lo pone el motor al guardar, nunca la pantalla.
   */
  systemStockAtCount?: number;
  /** Cuándo se guardó esta cantidad (ISO). */
  countedAt?: string;
  /** Se llenan al cerrar: stock del sistema en ese momento y diferencia aplicada. */
  systemStockAtClose?: number;
  difference?: number;
  /** Motivo con el que se registra una diferencia negativa. */
  reason?: LossCategory;
  /** Id del movimiento de Kardex: hace seguro reintentar sin duplicar. */
  movementId?: string;
  /** Costo unitario al abrir (para valorar la diferencia). */
  unitCost?: number;
}

export interface InventoryCountSession {
  id: string;
  version?: number;
  status: "OPEN" | "CLOSED";
  /** Conteo ciego: no se muestra el stock del sistema mientras se cuenta. */
  blind: boolean;
  scopeLabel: string;
  kind: CountKind;
  createdAt: Date;
  createdBy: string;
  /** true cuando ya se calcularon y guardaron las diferencias a aplicar. */
  prepared?: boolean;
  closedAt?: Date;
  closedBy?: string;
  lines: CountLine[];
}

/**
 * Una diferencia ya calculada por el SERVIDOR (rpc inventory_count_review). Solo la
 * reciben los roles autorizados a ver diferencias; para los demás el servidor
 * responde COUNT_FORBIDDEN.
 */
export interface CountReviewEntry {
  productId: string;
  name: string;
  unit?: string;
  counted: number;
  /** Base de comparación: lo que decía el sistema cuando se contó. */
  systemStock: number;
  /** true si `systemStock` es la foto tomada al contar; false si es el stock actual (conteo antiguo). */
  hasCountSnapshot: boolean;
  stockNow: number;
  movedSince: number;
  /** contado − sistema. Positivo = sobra, negativo = falta. */
  difference: number;
  /** Valor de la diferencia al costo (0 si no hay costo). */
  value: number;
  reason?: LossCategory;
}

export const DEFAULT_TOP_LIMIT = 20;

/** Segundos que se calculan por cada cosa contada (mirar, contar y digitar). Es una estimación, no una promesa. */
export const SECONDS_PER_COUNTED_ITEM = 15;

/** Minutos aproximados que toma un conteo de `itemCount` cosas. 0 si no hay nada que contar; mínimo 1. */
export function estimateCountMinutes(itemCount: number): number {
  if (!Number.isFinite(itemCount) || itemCount <= 0) return 0;
  return Math.max(1, Math.ceil((itemCount * SECONDS_PER_COUNTED_ITEM) / 60));
}

/**
 * Una diferencia "sospechosa" casi siempre es un error al digitar (1000 en vez de 100):
 * conviene volver a contar ese producto antes de cerrar. Es una alerta, no un bloqueo.
 */
export function isSuspiciousDifference(systemStock: number, counted: number): boolean {
  const diff = Math.abs(counted - systemStock);
  if (diff === 0) return false;
  if (systemStock <= 0) return counted >= 10; // aparece "de la nada"
  return diff >= 2 && diff / systemStock >= 0.5;
}

export const round4 = (n: number) => Math.round(n * 10000) / 10000;

export function inventoryValue(p: Pick<Product, "stock" | "purchasePrice">): number {
  return Math.max(0, p.stock) * (p.purchasePrice ?? 0);
}

/** Qué productos entran al conteo según el alcance elegido. */
export function selectProductsForCount(
  products: readonly Product[],
  kind: CountKind,
  scope: CountScope
): Product[] {
  let list = products.filter((p) => p.active !== false && p.trackStock !== false);
  if (kind === "insumos") list = list.filter((p) => p.isIngredient === true);
  if (kind === "productos") list = list.filter((p) => p.isIngredient !== true);

  if (scope.mode === "category") {
    list = list.filter((p) => p.categoryId === scope.categoryId);
  }
  if (scope.mode === "top") {
    list = [...list]
      .sort((a, b) => inventoryValue(b) - inventoryValue(a) || a.name.localeCompare(b.name))
      .slice(0, Math.max(1, scope.limit));
  }
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export function buildCountLines(products: readonly Product[]): CountLine[] {
  return products.map((p) => ({
    productId: p.id,
    name: p.name,
    unit: p.unit,
    categoryId: p.categoryId,
    systemStockAtStart: p.stock,
    counted: null,
    ...(p.purchasePrice !== undefined ? { unitCost: p.purchasePrice } : {})
  }));
}

/** Lee lo que escribió la persona: acepta coma o punto. Vacío o inválido = null. */
export function parseCountInput(raw: string): number | null {
  const text = raw.trim().replace(",", ".");
  if (text === "") return null;
  const n = Number(text);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export interface CountDifference {
  line: CountLine;
  /** Base de comparación: lo que decía el sistema cuando se contó (o el stock actual si el conteo es antiguo y no lo guardó). */
  systemStock: number;
  /** Stock actual del sistema. */
  stockNow: number;
  /** Cuánto cambió el stock desde que se contó (negativo = salieron unidades por ventas u otros movimientos). */
  movedSince: number;
  counted: number;
  /** contado − sistema. Positivo = sobra, negativo = falta. */
  difference: number;
  /** Valor de la diferencia al costo (0 si no hay costo). */
  value: number;
}

/**
 * Diferencias contra el stock ACTUAL del sistema (no contra el de cuando se
 * abrió el conteo), para no inventar diferencias por ventas hechas mientras
 * se contaba. Las líneas sin contar se ignoran.
 */
export function computeDifferences(
  lines: readonly CountLine[],
  currentStock: ReadonlyMap<string, number>
): CountDifference[] {
  const result: CountDifference[] = [];
  for (const line of lines) {
    if (line.counted === null) continue;
    const stockNow = currentStock.get(line.productId);
    if (stockNow === undefined) continue; // el producto ya no existe
    // Se compara contra lo que decía el sistema AL CONTAR; el ajuste se suma/resta al stock de hoy,
    // así las ventas posteriores se respetan. Conteos viejos sin esa foto usan el stock actual.
    const systemStock = line.systemStockAtCount ?? stockNow;
    const difference = round4(line.counted - systemStock);
    result.push({
      line,
      systemStock,
      stockNow,
      movedSince: round4(stockNow - systemStock),
      counted: line.counted,
      difference,
      value: round4(difference * (line.unitCost ?? 0))
    });
  }
  return result;
}

export function countProgress(lines: readonly CountLine[]) {
  const counted = lines.filter((l) => l.counted !== null).length;
  return { counted, total: lines.length };
}