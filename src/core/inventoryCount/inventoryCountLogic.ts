import type { LossCategory, Product } from "../entities/Entities";

/**
 * Lógica pura del conteo guiado (sin base de datos ni pantalla), para poder
 * probarla sola. El motor (InventoryCountEngine) y la pantalla la reutilizan.
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
  /** Lo que decía el sistema al abrir el conteo (solo referencia). */
  systemStockAtStart: number;
  /** Lo que se contó. `null` = todavía no contado (no se ajusta). */
  counted: number | null;
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

export const DEFAULT_TOP_LIMIT = 20;

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
  systemStock: number;
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
    const systemStock = currentStock.get(line.productId);
    if (systemStock === undefined) continue; // el producto ya no existe
    const difference = round4(line.counted - systemStock);
    result.push({
      line,
      systemStock,
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