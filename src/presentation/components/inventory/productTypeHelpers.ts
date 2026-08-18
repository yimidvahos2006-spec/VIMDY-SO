import { Product } from "../../../core/entities/Entities";

export type ProductType = "producto_para_venta" | "ingrediente" | "cocina_sin_receta" | "cocina_con_receta" | "servicio";

export function inferProductType(product?: Product): ProductType {
  if (!product) return "producto_para_venta";
  if (product.isIngredient) return "ingrediente";
  if (product.recipe && product.recipe.length > 0) return "cocina_con_receta";
  if (product.trackStock === false && product.requiresKitchen !== true) return "servicio";
  if (product.requiresKitchen) return "cocina_sin_receta";
  return "producto_para_venta";
}
