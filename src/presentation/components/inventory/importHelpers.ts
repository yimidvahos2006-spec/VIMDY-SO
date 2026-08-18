import { ProductInput } from "../../../core/engines/InventoryEngine";
import { RecipeItem } from "../../../core/entities/Entities";

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

export function buildProductInputFromImportRow(
  row: ImportedProductRow,
  batchTax: string
): ProductInput {
  const price = Number(row.price);
  const taxRate = row.taxRate.trim()
    ? Number(row.taxRate)
    : batchTax.trim()
      ? Number(batchTax)
      : undefined;

  const validIngredientRows = row.recipeRows.filter(
    (ing) => ing.productId && ing.quantity.trim() && Number(ing.quantity) > 0
  );

  const recipe: RecipeItem[] | undefined = validIngredientRows.length > 0
    ? validIngredientRows.map((ing) => ({
        productId: ing.productId,
        quantity: Number(ing.quantity)
      }))
    : undefined;

  const productionMode = recipe && row.productionMode !== "NONE"
    ? row.productionMode
    : undefined;

  const trackStock = !row.requiresKitchen || (productionMode === "BATCH");
  const stock = trackStock
    ? row.stock.trim()
      ? Number(row.stock)
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
