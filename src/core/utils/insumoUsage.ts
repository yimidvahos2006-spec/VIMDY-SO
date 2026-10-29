// src/core/utils/insumoUsage.ts
//
// "¿En qué platos se usa cada insumo?" — respuesta única para la tabla de
// Insumos. Mira la receta base de cada producto de venta Y las recetas de sus
// tamaños y extras (un insumo que solo se gasta en "Extra queso" también está
// en uso). Sin React ni red: se prueba solo.

import type { Product, RecipeItem } from "../entities/Entities";

function collectRecipes(product: Product): ReadonlyArray<readonly RecipeItem[]> {
  const recipes: Array<readonly RecipeItem[]> = [];
  if (product.recipe && product.recipe.length > 0) recipes.push(product.recipe);
  for (const size of product.sizes ?? []) {
    if (size.recipe && size.recipe.length > 0) recipes.push(size.recipe);
  }
  for (const extra of product.extras ?? []) {
    if (extra.recipe && extra.recipe.length > 0) recipes.push(extra.recipe);
  }
  return recipes;
}

/**
 * insumoId → nombres de los productos de venta que lo consumen (sin repetir,
 * en orden alfabético). Ignora insumos (no se venden) y productos desactivados.
 */
export function buildInsumoUsage(products: readonly Product[]): Map<string, string[]> {
  const usage = new Map<string, Set<string>>();

  for (const product of products) {
    if (product.isIngredient === true || product.active === false) continue;
    for (const recipe of collectRecipes(product)) {
      for (const item of recipe) {
        const names = usage.get(item.productId) ?? new Set<string>();
        names.add(product.name);
        usage.set(item.productId, names);
      }
    }
  }

  const result = new Map<string, string[]>();
  for (const [insumoId, names] of usage) {
    result.set(insumoId, [...names].sort((a, b) => a.localeCompare(b, "es")));
  }
  return result;
}