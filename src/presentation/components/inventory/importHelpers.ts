import { ProductInput } from "../../../core/engines/InventoryEngine";
import { RecipeItem } from "../../../core/entities/Entities";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";

export type ImportedRecipeRow = {
  rowId: string;
  productId: string;
  quantity: string;
};

export type ImportedProductRow = {
  id: string;
  name: string;
  price: string;
  requiresReview: boolean;
  categoryId: string;
  requiresKitchen: boolean;
  stock: string;
  recipeRows: ImportedRecipeRow[];
  taxRate: string;
  unit: string;
  productionMode: "ON_DEMAND" | "BATCH" | "NONE";
  isIngredient: boolean;
  pendingReview: boolean;
  tipo: "plato_final" | "ingrediente" | "producto_simple";
};

const UNIT_PATTERNS: Array<[RegExp, string]> = [
  [/(?:^|[^a-zA-Z])(kg|kgs|kilo|kilos|kilogramos)\b/, "kg"],
  [/(?:^|[^a-zA-Z])(g|gramo|gramos)\b/, "g"],
  [/(?:^|[^a-zA-Z])(l|litro|litros)\b/, "litro"],
  [/(?:^|[^a-zA-Z])(ml)\b/, "ml"],
  [/(?:^|[^a-zA-Z])(lb|lbs|libra|libras)\b/, "libra"],
  [/(?:^|[^a-zA-Z])(servicio|servicios)\b/, "servicio"]
];

export function inferUnitFromProductName(name: string): string {
  const normalized = name.trim().toLowerCase();
  for (const [pattern, unit] of UNIT_PATTERNS) {
    if (pattern.test(normalized)) {
      return unit;
    }
  }
  return "unidad";
}

/** Decimal simple (porcentajes y cantidades de receta): acepta coma o punto como decimal. "0,12" y "0.12" -> 0.12. */
export function parseDecimalInput(raw: string): number {
  const text = String(raw ?? "").replace(/\s/g, "").replace(",", ".");
  return /^-?\d*\.?\d+$/.test(text) ? Number(text) : Number.NaN;
}

export function buildProductInputFromImportRow(
  row: ImportedProductRow,
  batchTax: string
): ProductInput {
  const price = parseMoneyInput(row.price);
  const taxRate = row.taxRate.trim()
    ? parseDecimalInput(row.taxRate)
    : batchTax.trim()
      ? parseDecimalInput(batchTax)
      : undefined;

  const validIngredientRows = row.recipeRows.filter(
    (ing) => ing.productId && ing.quantity?.trim() && parseDecimalInput(ing.quantity) > 0
  );

  const recipe: RecipeItem[] | undefined = validIngredientRows.length > 0
    ? validIngredientRows.map((ing) => ({
        productId: ing.productId,
        quantity: parseDecimalInput(ing.quantity)
      }))
    : undefined;

  const productionMode = recipe && row.productionMode !== "NONE"
    ? row.productionMode
    : undefined;

  const trackStock = !row.requiresKitchen || (productionMode === "BATCH");
  const stock = trackStock
    ? row.stock.trim()
      ? parseMoneyInput(row.stock)
      : 0
    : 0;

  return {
    name: row.name.trim(),
    categoryId: row.categoryId,
    price,
    stock,
    minStock: 0,
    taxRate,
    unit: row.unit.trim() || inferUnitFromProductName(row.name),
    active: true,
    requiresKitchen: row.requiresKitchen,
    recipe,
    productionMode,
    trackStock,
    isIngredient: row.isIngredient
  };
}