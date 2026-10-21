import { parseDecimalInput } from "./importHelpers";

/** Minúsculas y sin tildes: "Azúcar" se encuentra escribiendo "azucar". */
export function normalizeSearch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim();
}

/**
 * Filtra ingredientes para el buscador de la receta. Sin texto devuelve los
 * primeros (orden alfabético); con texto, primero los que EMPIEZAN igual y
 * luego los que lo contienen. Nunca devuelve los ya agregados a la receta.
 */
export function filterIngredientOptions<T extends { id: string; name: string }>(
  options: readonly T[],
  query: string,
  excludeIds: ReadonlySet<string>,
  limit = 8
): { items: T[]; total: number } {
  const q = normalizeSearch(query);
  const available = options.filter((o) => !excludeIds.has(o.id));
  const words = q.split(/\s+/).filter(Boolean);

  const matches = available
    .map((o) => ({ o, n: normalizeSearch(o.name) }))
    .filter(({ n }) => words.every((w) => n.includes(w)))
    .sort((a, b) => {
      const aStarts = q && a.n.startsWith(q) ? 0 : 1;
      const bStarts = q && b.n.startsWith(q) ? 0 : 1;
      return aStarts - bStarts || a.n.localeCompare(b.n);
    })
    .map(({ o }) => o);

  return { items: matches.slice(0, limit), total: matches.length };
}

/** Solo deja números y un separador decimal (coma o punto). */
export function sanitizeQuantityInput(raw: string): string {
  const cleaned = raw.replace(/[^\d.,]/g, "");
  const firstSep = cleaned.search(/[.,]/);
  if (firstSep === -1) return cleaned;
  return cleaned.slice(0, firstSep + 1) + cleaned.slice(firstSep + 1).replace(/[.,]/g, "");
}

export interface RecipeRowProblem {
  message: string;
  rowId?: string;
}

/**
 * Revisa la receta ANTES de guardar y dice exactamente qué falta, en vez de
 * descartar filas en silencio: sin ingredientes, repetidos o sin cantidad.
 */
export function findRecipeRowProblem(
  rows: ReadonlyArray<{ rowId: string; productId: string; quantity: string }>,
  nameOf: (productId: string) => string
): RecipeRowProblem | null {
  const filled = rows.filter((r) => r.productId);
  if (filled.length === 0) {
    return { message: "Agrega al menos un ingrediente a la receta, o cambia el tipo de producto." };
  }

  const seen = new Set<string>();
  for (const row of filled) {
    const name = nameOf(row.productId);
    if (seen.has(row.productId)) {
      return { message: `"${name}" está repetido en la receta. Déjalo una sola vez.`, rowId: row.rowId };
    }
    seen.add(row.productId);

    const qty = parseDecimalInput(row.quantity);
    if (!Number.isFinite(qty) || qty <= 0) {
      return { message: `Escribe la cantidad de "${name}" (mayor a 0).`, rowId: row.rowId };
    }
  }
  return null;
}
