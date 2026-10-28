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
 * Lo que la persona elige arriba del formulario ("¿Qué vas a vender?"):
 *  - preparado: plato o bebida de cocina (con o sin receta)
 *  - reventa:   producto que se compra y se vende tal cual (gaseosa, snack), con stock
 *  - servicio:  se vende directo, sin descontar inventario (domicilio, propina)
 *  - ingrediente: solo al EDITAR un insumo; no se ofrece como opción.
 */
export type FormKind = "preparado" | "reventa" | "servicio" | "ingrediente";

/** Opción que se muestra al abrir el formulario: nuevo = preparado; editar = según lo ya guardado. */
export function kindOfProduct(product?: Product): FormKind {
  switch (inferProductType(product)) {
    case "inventario":
      return "reventa";
    case "servicio":
      return "servicio";
    case "ingrediente":
      return "ingrediente";
    default:
      return "preparado";
  }
}

/** Tipo canónico con el que se guarda cada opción (con ingredientes un preparado es cocina_receta). */
export function formTypeForKind(kind: FormKind, hasRecipe: boolean): ProductType {
  switch (kind) {
    case "reventa":
      return "inventario";
    case "servicio":
      return "servicio";
    case "ingrediente":
      return "ingrediente";
    default:
      return hasRecipe ? "cocina_receta" : "cocina";
  }
}

/**
 * Tipo con el que se guarda el producto.
 *  - Con `kind` (lo que eligió la persona): ver formTypeForKind.
 *  - Sin `kind` (compatibilidad): con ingredientes -> cocina_receta; sin ingredientes -> cocina,
 *    y al EDITAR un producto que no es de cocina se respeta su tipo original.
 */
export function resolveFormType(product: Product | undefined, hasRecipe: boolean, kind?: FormKind): ProductType {
  if (kind) return formTypeForKind(kind, hasRecipe);
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
  /**
   * Costo de compra escrito a mano ("8.500"), solo para platos SIN receta.
   * undefined = no se toca el costo guardado (sin permiso de ver costos, o producto sin ese campo).
   * "" = sin costo. Con receta se ignora: el costo lo calcula la receta.
   */
  cost?: string;
  /** Foto (dataURL). undefined = se conserva la actual; "" = se quita. */
  image?: string;
  /** Opción elegida arriba. undefined = comportamiento anterior (se deduce de la receta y del producto). */
  kind?: FormKind;
  /** Código de barras (solo reventa). undefined = se conserva el actual; "" = sin código. */
  barcode?: string;
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
  const { product, allProducts, categories } = args;
  // Solo un "Preparado" lleva ingredientes: al elegir otra opción la receta se ignora (y se borra si ya tenía).
  const rows = args.kind && args.kind !== "preparado" ? [] : args.rows;
  const isEditing = !!product;
  const type = resolveFormType(product, rows.length > 0, args.kind);
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

  // Costo directo: solo cuenta sin ingredientes (con receta, RecipeEngine calcula el costo de los insumos).
  let purchasePrice = product?.purchasePrice;
  if (rows.length === 0 && args.cost !== undefined) {
    if (args.cost.trim() === "") {
      purchasePrice = undefined;
    } else {
      const typedCost = parseMoneyInput(args.cost);
      if (Number.isNaN(typedCost) || typedCost < 0) return { ok: false, error: "Escribe un costo de compra válido." };
      purchasePrice = typedCost;
    }
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
    purchasePrice,
    taxRate: product?.taxRate,
    // updateProduct no toca el stock a propósito; al crear, un plato nace en 0.
    stock: isEditing ? product!.stock : 0,
    minStock: product?.minStock ?? 0,
    unit: product?.unit ?? "unidad",
    barcode: args.barcode === undefined ? product?.barcode : args.barcode.trim() || undefined,
    sku: product?.sku,
    supplierId: product?.supplierId,
    alternateSupplierId: product?.alternateSupplierId,
    image: args.image === undefined ? product?.image : args.image || undefined,
    recipe,
    productionMode: rows.length > 0 ? productionMode : undefined,
    requiresKitchen: flags.requiresKitchen,
    // Se conserva aunque el producto pase a otro modo: así volver a "Preparado" no pierde el dato.
    estimatedPrepMinutes: product?.estimatedPrepMinutes,
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