// src/presentation/components/inventory/product-form/applyAiDraft.ts
//
// VIMDY IA: convierte el borrador (texto/voz) en valores listos para el
// formulario. NO guarda el plato: solo propone campos y receta. Los insumos que
// no existían se crean sin precio de compra y se devuelven en `createdProducts`
// para que el formulario los borre si la persona cierra sin guardar.

import type { Category, Product } from "../../../../core/entities/Entities";
import { DishDraft, formatDishQuantity, planRecipeRow, storedUnitFor } from "../dishDraft";
import { normalizeSearch } from "../recipeFormHelpers";
import { resolveInsumoCategory } from "../../../../core/utils/insumoCategoryChoice";
import { createInsumo, createInsumoCategory } from "./insumoFactory";
import type { RecipeRowDraft } from "./productFormTypes";

export interface AiDraftResult {
  name: string;
  /** undefined = la IA no oyó precio. */
  price?: number;
  /** Categoría existente elegida. */
  categoryId?: string;
  /** Si ninguna encajó: nombre sugerido para crear. */
  suggestedCategory?: string;
  /** Estación sugerida (el formulario decide si difiere de la de la categoría). */
  station?: string;
  rows: RecipeRowDraft[];
  notices: string[];
  createdProducts: Product[];
  /** Categorías de insumos que se crearon para ubicar los insumos nuevos (Carnes, Verduras...). */
  createdCategories: Category[];
}

export async function applyAiDraft(
  draft: DishDraft,
  sellCategories: readonly Category[],
  insumoCategories: readonly Category[],
  products: readonly Product[]
): Promise<AiDraftResult> {
  const notices: string[] = [];
  const result: AiDraftResult = { name: draft.name, rows: [], notices, createdProducts: [], createdCategories: [] };

  if (draft.price) result.price = draft.price;
  else notices.push("No dijiste el precio de venta: escríbelo antes de guardar.");

  const chosen = draft.categoryId ? sellCategories.find((c) => c.id === draft.categoryId) : undefined;
  if (chosen) {
    result.categoryId = chosen.id;
  } else {
    if (draft.suggestedCategory) result.suggestedCategory = draft.suggestedCategory;
    notices.push(
      draft.suggestedCategory
        ? `Ninguna categoría tuya encajó. Sugerencia: "${draft.suggestedCategory}". Créala con el botón "Crear" o elige otra.`
        : "Ninguna categoría tuya encajó: elige una o crea una nueva."
    );
  }

  if (draft.station) result.station = draft.station;

  if (draft.ingredients.length === 0) {
    notices.push("No mencionaste ingredientes: el plato quedó sin receta. Puedes agregarla abajo.");
    return result;
  }

  const estimated: string[] = [];
  const created: string[] = [];
  const needsQuantity: string[] = [];
  const failed: string[] = [];
  const usedIds = new Set<string>();
  let known: Product[] = [...products];
  let knownInsumoCategories: Category[] = [...insumoCategories];

  for (const ingredient of draft.ingredients) {
    let productId = ingredient.match?.productId;
    let productName = ingredient.match?.name ?? ingredient.name;
    let storedUnit = ingredient.match?.unit;

    if (!productId) {
      try {
        // Cada insumo nuevo va a la categoría que sugiere su nombre (no a "la primera de la lista").
        // Las que se vayan creando quedan en `knownInsumoCategories` y se reutilizan, sin duplicar.
        const resolved = await resolveInsumoCategory({
          name: ingredient.name,
          manualChoice: null,
          categories: knownInsumoCategories,
          createCategory: createInsumoCategory
        });
        if (!resolved.ok) throw new Error(resolved.reason);
        if (resolved.created) {
          knownInsumoCategories = [...knownInsumoCategories, resolved.created];
          result.createdCategories.push(resolved.created);
        }
        storedUnit = storedUnitFor(ingredient.unit);
        const insumo = await createInsumo(
          { name: ingredient.name, categoryId: resolved.categoryId, unit: storedUnit },
          known
        );
        known = [...known, insumo];
        result.createdProducts.push(insumo);
        productId = insumo.id;
        productName = insumo.name;
        created.push(insumo.name);
      } catch {
        failed.push(ingredient.name);
        continue;
      }
    }

    if (usedIds.has(productId)) {
      notices.push(`"${ingredient.name}" ya estaba en la receta como "${productName}", no se repitió.`);
      continue;
    }
    usedIds.add(productId);

    const plan = planRecipeRow(ingredient, storedUnit);
    if (plan.needsManualQuantity) {
      needsQuantity.push(`${productName} (la IA dijo ${formatDishQuantity(ingredient.quantity, ingredient.unit)})`);
    } else if (ingredient.estimated) {
      estimated.push(`${productName} ${formatDishQuantity(ingredient.quantity, ingredient.unit)}`);
    }
    result.rows.push({ rowId: crypto.randomUUID(), productId, quantity: plan.quantity, unit: plan.unit, optional: false });
  }

  if (estimated.length > 0) {
    notices.push(
      `No dijiste estas cantidades y VIMDY IA propuso valores típicos. Revísalas porque descuentan inventario: ${estimated.join(", ")}.`
    );
  }
  if (needsQuantity.length > 0) notices.push(`Escribe la cantidad de: ${needsQuantity.join(", ")}.`);
  if (created.length > 0) {
    notices.push(
      `Insumos nuevos creados sin precio de compra: ${created.join(", ")}. Ponles su costo en Insumos para que el margen sea real.`
    );
  }
  if (failed.length > 0) {
    notices.push(`No se pudieron crear estos insumos, agrégalos a mano en la receta: ${failed.join(", ")}.`);
  }
  return result;
}

/** ¿La estación sugerida por la IA ya es la de la categoría? (si lo es, no hace falta fijarla en el plato) */
export function sameStation(a?: string, b?: string): boolean {
  return normalizeSearch(a ?? "") === normalizeSearch(b ?? "");
}