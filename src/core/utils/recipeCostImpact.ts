// src/core/utils/recipeCostImpact.ts
//
// "¿Qué pasa con mis platos si cambia el costo de este insumo?" Calcula, para
// cada plato (o tamaño) cuya receta usa el insumo, el costo y el margen ANTES
// y DESPUÉS del nuevo costo. Es de solo lectura: el costo real de una receta
// siempre se calcula en vivo con el costo guardado de cada insumo (RecipeEngine),
// así que esto solo sirve para AVISAR al dueño lo que va a cambiar.

import type { Product, ProductSizeOption, RecipeItem } from "../entities/Entities";
import type { RecipeEngine } from "../engines/RecipeEngine";

export interface DishCostChange {
  readonly dishId: string;
  /** "Pizza" o "Pizza · Grande" cuando el cambio es de un tamaño. */
  readonly label: string;
  readonly price: number;
  readonly costBefore: number;
  readonly costAfter: number;
  readonly marginBefore: number;
  readonly marginAfter: number;
  /** Con el costo nuevo, el plato cuesta más de lo que se vende. */
  readonly losesMoney: boolean;
  /** Falta el costo de algún otro insumo de la receta: la cifra es parcial. */
  readonly costUnreliable: boolean;
}

const usesInsumo = (recipe: readonly RecipeItem[] | undefined, insumoId: string): boolean =>
  !!recipe && recipe.some((item) => item.productId === insumoId);

const marginOf = (price: number, cost: number): number => (price > 0 ? ((price - cost) / price) * 100 : 0);

export function computeCostImpact(
  engine: Pick<RecipeEngine, "getProfitability">,
  products: readonly Product[],
  insumoId: string,
  newCost: number
): DishCostChange[] {
  const before = new Map(products.map((p) => [p.id, p]));
  const after = new Map(products.map((p) => [p.id, p.id === insumoId ? { ...p, purchasePrice: newCost } : p]));
  const changes: DishCostChange[] = [];

  const push = (dish: Product, size: ProductSizeOption | undefined) => {
    const price = dish.price + (size?.priceDelta ?? 0);
    if (price <= 0) return;
    const was = engine.getProfitability(dish, before, size);
    const now = engine.getProfitability(dish, after, size);
    if (Math.abs(now.cost - was.cost) < 0.005) return;
    changes.push({
      dishId: dish.id,
      label: size ? `${dish.name} · ${size.name}` : dish.name,
      price,
      costBefore: was.cost,
      costAfter: now.cost,
      marginBefore: marginOf(price, was.cost),
      marginAfter: marginOf(price, now.cost),
      losesMoney: now.cost > price,
      costUnreliable: now.costUnreliable
    });
  };

  for (const dish of products) {
    if (dish.isIngredient === true || dish.active === false) continue;
    if (usesInsumo(dish.recipe, insumoId)) push(dish, undefined);
    for (const size of dish.sizes ?? []) {
      if (usesInsumo(size.recipe, insumoId)) push(dish, size);
    }
  }

  // Primero lo que más margen pierde (o más gana).
  return changes.sort(
    (a, b) => Math.abs(b.marginAfter - b.marginBefore) - Math.abs(a.marginAfter - a.marginBefore)
  );
}