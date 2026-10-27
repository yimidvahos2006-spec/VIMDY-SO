// src/presentation/components/inventory/dishDraft.ts
//
// VIMDY IA: convierte lo que devolvió la IA (DishAIResult) en un "borrador"
// listo para precargar ProductFormModal. Todo es lógica pura (sin React ni
// base de datos) para poder probarla con vitest.
//
// Regla de oro: la IA NUNCA crea ni modifica nada por su cuenta. Aquí solo se
// decide qué insumo del inventario real corresponde a cada ingrediente
// (o que no existe todavía) y en qué unidad queda cada fila de la receta.

import type { Category, Product } from "../../../core/entities/Entities";
import type { DishAIIngredient, DishAIResult, DishUnit } from "../../../core/ia/DishAI";
import { convertQuantity, normalizeUnit } from "../../../core/utils/unitConversion";
import { normalizeSearch } from "./recipeFormHelpers";

export interface DishDraftMatch {
  productId: string;
  name: string;
  unit?: string;
}

export interface DishDraftIngredient extends DishAIIngredient {
  /** Insumo real del inventario que corresponde, o null si todavía no existe. */
  match: DishDraftMatch | null;
}

export interface DishDraft {
  name: string;
  price: number | null;
  /** Id de una categoría real de venta, o null si ninguna encajó. */
  categoryId: string | null;
  /** Nombre sugerido para crear una categoría nueva (solo si categoryId es null). */
  suggestedCategory: string | null;
  station: string | null;
  ingredients: DishDraftIngredient[];
}

export const UNIT_LABEL: Record<DishUnit, string> = {
  g: "g",
  kg: "kg",
  ml: "ml",
  litro: "L",
  libra: "lb",
  unidad: "und"
};

/** Texto corto "150 g" / "1 und" para avisos. */
export function formatDishQuantity(quantity: number, unit: DishUnit): string {
  const rounded = Math.round(quantity * 1000) / 1000;
  return `${String(rounded).replace(".", ",")} ${UNIT_LABEL[unit]}`;
}

function words(text: string): string[] {
  return normalizeSearch(text)
    .replace(/[^a-z0-9ñ\s]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    // "tajadas" -> "tajada", "huevos" -> "huevo": plural simple en español.
    .map((w) => (w.length > 3 && w.endsWith("s") ? w.slice(0, -1) : w));
}

/**
 * Busca, entre los insumos reales, el que corresponde al nombre que dijo la IA.
 *   1) Mismo nombre (sin tildes, mayúsculas ni plurales).
 *   2) Uno contiene al otro palabra por palabra ("Queso cheddar" ↔ "Queso cheddar lonchas");
 *      gana el insumo igual o más específico sobre uno más genérico.
 * Si hay empate gana el de nombre más parecido en longitud.
 */
export function matchIngredient(
  aiName: string,
  insumos: readonly Pick<Product, "id" | "name" | "unit">[]
): DishDraftMatch | null {
  const target = words(aiName);
  if (target.length === 0) return null;
  const targetKey = target.join(" ");

  let best: { score: number; gap: number; item: Pick<Product, "id" | "name" | "unit"> } | null = null;

  for (const item of insumos) {
    const candidate = words(item.name);
    if (candidate.length === 0) continue;

    let score = 0;
    if (candidate.join(" ") === targetKey) {
      score = 3;
    } else {
      // Mejor un insumo igual o más específico que lo dicho ("Queso cheddar" ->
      // "Queso cheddar lonchas") que uno más genérico ("Queso"), que podría ser otro queso.
      const targetInCandidate = target.every((w) => candidate.includes(w));
      const candidateInTarget = candidate.every((w) => target.includes(w));
      if (targetInCandidate) score = 2.5;
      else if (candidateInTarget) score = 2;
    }
    if (score === 0) continue;

    const gap = Math.abs(candidate.length - target.length);
    if (!best || score > best.score || (score === best.score && gap < best.gap)) {
      best = { score, gap, item };
    }
  }

  return best ? { productId: best.item.id, name: best.item.name, unit: best.item.unit } : null;
}

/**
 * Arma el borrador a partir de la respuesta de la IA.
 * @param sellCategories solo categorías de venta (no las de insumos).
 * @param insumos productos marcados como ingrediente (isIngredient === true).
 */
export function buildDishDraft(
  ai: DishAIResult,
  sellCategories: readonly Pick<Category, "id" | "name">[],
  insumos: readonly Pick<Product, "id" | "name" | "unit">[]
): DishDraft {
  const categoryKey = ai.category ? normalizeSearch(ai.category) : "";
  const category = categoryKey ? sellCategories.find((c) => normalizeSearch(c.name) === categoryKey) : undefined;

  return {
    name: ai.name,
    price: ai.price,
    categoryId: category?.id ?? null,
    suggestedCategory: category ? null : ai.suggestedCategory ?? ai.category,
    station: ai.station,
    ingredients: ai.ingredients.map((ingredient) => ({
      ...ingredient,
      match: matchIngredient(ingredient.name, insumos)
    }))
  };
}

/** Unidad en la que se guarda un insumo nuevo (el precio de compra será POR esta unidad). */
export function storedUnitFor(unit: DishUnit): string {
  switch (unit) {
    case "g":
    case "kg":
      return "kg";
    case "ml":
    case "litro":
      return "litro";
    case "libra":
      return "libra";
    default:
      return "unidad";
  }
}

export interface PlannedRecipeRow {
  /** Cantidad tal como se muestra en el formulario ("" si hay que escribirla a mano). */
  quantity: string;
  /** Unidad en que se escribió la cantidad ("" = la misma del insumo). */
  unit: string;
  /** true si la unidad de la IA no se puede convertir a la del insumo: la cantidad queda vacía. */
  needsManualQuantity: boolean;
}

/**
 * Decide cómo queda la fila de receta para un insumo guardado en `storedUnit`.
 * Ej: la IA dice 150 g y el insumo está en kg -> cantidad "150", unidad "g"
 * (el formulario convierte a 0,15 kg al guardar). Si la IA dice "unidad" pero
 * el insumo está en kg, no se puede convertir: la cantidad queda vacía para
 * que la persona la escriba, en vez de guardar un número que descuente mal.
 */
export function planRecipeRow(
  ingredient: Pick<DishAIIngredient, "quantity" | "unit">,
  storedUnit: string | undefined
): PlannedRecipeRow {
  const converted = convertQuantity(ingredient.quantity, ingredient.unit, storedUnit);
  if (converted === null || converted <= 0) {
    return { quantity: "", unit: "", needsManualQuantity: true };
  }
  const sameUnit = normalizeUnit(ingredient.unit) === normalizeUnit(storedUnit);
  return {
    quantity: String(ingredient.quantity),
    unit: sameUnit ? "" : ingredient.unit,
    needsManualQuantity: false
  };
}