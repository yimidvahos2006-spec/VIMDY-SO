// src/presentation/components/inventory/product-form/recipeSummary.ts
//
// Costo y ganancia EN VIVO mientras se arma la receta (sin guardar), con el
// mismo RecipeEngine que usa el resto de VIMDY.

import type { Product, RecipeItem } from "../../../../core/entities/Entities";
import { container } from "../../../../infrastructure/di/CompositionRoot";
import { convertQuantity } from "../../../../core/utils/unitConversion";
import { parseMoneyInput } from "../../../../core/utils/parseMoneyInput";
import { parseDecimalInput } from "../importHelpers";
import type { RecipeRowDraft } from "./productFormTypes";

export interface RecipeSummary {
  cost: number;
  profit: number;
  marginPercent: number;
  /** true si a algún insumo le falta el precio de compra: el costo real es mayor. */
  costUnreliable: boolean;
}

export function computeRecipeSummary(
  rows: readonly RecipeRowDraft[],
  allProducts: readonly Product[],
  price: string
): RecipeSummary | null {
  const draft: RecipeItem[] = [];
  for (const row of rows) {
    const typed = parseDecimalInput(row.quantity);
    if (!Number.isFinite(typed) || typed <= 0) continue;
    const ingredient = allProducts.find((p) => p.id === row.productId);
    const converted = convertQuantity(typed, row.unit || ingredient?.unit, ingredient?.unit);
    if (converted !== null && converted > 0) draft.push({ productId: row.productId, quantity: converted });
  }
  if (draft.length === 0) return null;

  const draftProduct: Product = {
    id: "__draft__",
    name: "Plato",
    categoryId: "",
    price: parseMoneyInput(price) || 0,
    stock: 0,
    minStock: 0,
    lastUpdated: new Date(),
    recipe: draft
  };

  const engine = container.recipeEngine.get();
  const map = new Map(allProducts.map((p) => [p.id, p]));
  const profitability = engine.getProfitability(draftProduct, map);
  return profitability
    ? {
        cost: profitability.cost,
        profit: profitability.profit,
        marginPercent: profitability.marginPercent,
        costUnreliable: profitability.costUnreliable
      }
    : null;
}