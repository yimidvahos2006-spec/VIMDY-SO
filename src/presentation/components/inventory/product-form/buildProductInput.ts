// src/presentation/components/inventory/product-form/buildProductInput.ts
//
// Lógica PURA del guardado (sin React): valida lo escrito y arma el
// ProductInput que espera InventoryEngine. Se puede probar con vitest.

import type { Category, Product, RecipeItem } from "../../../../core/entities/Entities";
import type { ProductInput } from "../../../../core/engines/InventoryEngine";
import { ProductType, inferProductType, resolveProductFlags } from "../../../../core/types/productType";
import { convertQuantity, normalizeUnit } from "../../../../core/utils/unitConversion";
import { parseMoneyInput } from "../../../../core/utils/parseMoneyInput";
import { parseDecimalInput } from "../importHelpers";
import { findRecipeRowProblem } from "../recipeFormHelpers";
import { DEFAULT_STATION, RecipeRowDraft } from "./productFormTypes";

/**
 * Tipo con el que se guarda el producto. El formulario no pregunta "qué tipo es":
 *  - con ingredientes   -> cocina_receta (descuenta insumos al vender)
 *  - sin ingredientes   -> cocina (se prepara, sin descontar nada)
 * Al EDITAR un producto que no es de cocina (gaseosa, servicio, insumo) se respeta
 * su tipo original para no cambiarle el comportamiento sin querer.
 */
export function resolveFormType(product: Product | undefined, hasRecipe: boolean): ProductType {
  if (hasRecipe) return "cocina_receta";
  if (!product) return "cocina";
  const original: ProductType = product.isIngredient ? "ingrediente" : inferProductType(product);
  return original === "cocina_receta" ? "cocina" : original;
}

/** ¿Este tipo se arma con receta y se envía a una estación? (los demás se editan sin esas secciones) */
export function isKitchenFormType(type: ProductType): boolean {
  return type === "cocina" || type === "cocina_receta";
}

/**
 * La estación solo se guarda en el producto si es distinta a la que ya le
 * toca por su categoría (o a "Cocina" cuando la categoría no define ninguna).
 */
export function resolveStationOverride(station: string, category: Pick<Category, "printStation"> | undefined): string | undefined {
  const chosen = station.trim();
  if (!chosen) return undefined;
  const inherited = category?.printStation?.trim() || DEFAULT_STATION;
  return chosen.toLowerCase() === inherited.toLowerCase() ? undefined : chosen;
}

export interface BuildProductInputArgs {
  product?: Product;
  name: string;
  categoryId: string;
  /** Precio de venta tal como se escribió ("22.000"). */
  price: string;
  /** "" = automática (la de la categoría). */
  station: string;
  rows: readonly RecipeRowDraft[];
  allProducts: readonly Product[];
  categories: readonly Category[];
}

export type BuildProductInputResult =
  | { ok: true; input: ProductInput; recipe: RecipeItem[] | undefined }
  | { ok: false; error: string; rowId?: string };

export function buildProductInput(args: BuildProductInputArgs): BuildProductInputResult {
  const { product, rows, allProducts, categories } = args;
  const isEditing = !!product;
  const type = resolveFormType(product, rows.length > 0);
  const productionMode = product?.productionMode ?? "ON_DEMAND";
  const flags = resolveProductFlags(type, productionMode);
  const isIngredientType = type === "ingrediente";

  const name = args.name.trim();
  if (!name) return { ok: false, error: "Escribe el nombre del plato." };

  if (!args.categoryId) return { ok: false, error: "Elige una categoría o crea una nueva." };

  const price = isIngredientType && !args.price.trim() ? 0 : parseMoneyInput(args.price);
  if (!isIngredientType && (!args.price.trim() || Number.isNaN(price) || price < 0)) {
    return { ok: false, error: "Escribe un precio de venta válido." };
  }

  // Receta: se revisa ANTES de guardar y se dice exactamente qué falta.
  let recipe: RecipeItem[] | undefined;
  if (rows.length > 0) {
    const nameOf = (id: string) => allProducts.find((p) => p.id === id)?.name ?? "un ingrediente";
    const problem = findRecipeRowProblem(rows, nameOf);
    if (problem) return { ok: false, error: problem.message, rowId: problem.rowId };

    const items: RecipeItem[] = [];
    for (const row of rows) {
      const typed = parseDecimalInput(row.quantity);
      const ingredient = allProducts.find((p) => p.id === row.productId);
      const converted = convertQuantity(typed, row.unit || ingredient?.unit, ingredient?.unit);
      if (converted === null || converted <= 0) {
        return {
          ok: false,
          rowId: row.rowId,
          error: `La unidad elegida para "${ingredient?.name ?? "un ingrediente"}" no se puede convertir a ${normalizeUnit(ingredient?.unit)}. Elige una unidad de la misma clase (peso con peso, líquido con líquido).`
        };
      }
      const item: RecipeItem = { productId: row.productId, quantity: converted, optional: row.optional };
      // Se recuerda lo que escribió la persona solo cuando eligió otra unidad que la del insumo.
      items.push(
        row.unit && normalizeUnit(row.unit) !== normalizeUnit(ingredient?.unit)
          ? { ...item, entryQuantity: typed, entryUnit: row.unit }
          : item
      );
    }
    recipe = items;
  } else if (isEditing && product?.recipe && product.recipe.length > 0) {
    // Tenía receta y la persona la vació: [] le dice a updateProduct que la borre.
    recipe = [];
  }

  const category = categories.find((c) => c.id === args.categoryId);
  const keepsKitchen = flags.requiresKitchen;

  const input: ProductInput = {
    name,
    description: product?.description,
    active: product?.active ?? true,
    categoryId: args.categoryId,
    price,
    purchasePrice: product?.purchasePrice,
    taxRate: product?.taxRate,
    // updateProduct no toca el stock a propósito; al crear, un plato nace en 0.
    stock: isEditing ? product!.stock : 0,
    minStock: product?.minStock ?? 0,
    unit: product?.unit ?? "unidad",
    barcode: product?.barcode,
    sku: product?.sku,
    supplierId: product?.supplierId,
    alternateSupplierId: product?.alternateSupplierId,
    image: product?.image,
    recipe,
    productionMode: rows.length > 0 ? productionMode : undefined,
    requiresKitchen: flags.requiresKitchen,
    estimatedPrepMinutes: keepsKitchen ? product?.estimatedPrepMinutes : undefined,
    printStationOverride: keepsKitchen ? resolveStationOverride(args.station, category) : product?.printStationOverride,
    // Tamaños y extras ya configurados se conservan tal cual al editar.
    sizes: product?.sizes ? [...product.sizes] : [],
    extras: product?.extras ? [...product.extras] : [],
    // Flags persistidos: única fuente de verdad = resolveProductFlags (inversa de inferProductType).
    trackStock: flags.trackStock,
    isIngredient: isIngredientType
  };

  return { ok: true, input, recipe };
}