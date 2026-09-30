import type { ProductType } from "../types/productType";
import { resolveProductFlags } from "../types/productType";

export type { ProductType };

export function computeTracksStock(
  productType: ProductType,
  _hasRecipe: boolean,
  productionMode: "ON_DEMAND" | "BATCH"
): boolean {
  return resolveProductFlags(productType, productionMode).trackStock;
}

export function visualTypeOf(productType: ProductType): string {
  switch (productType) {
    case "inventario":
      return "listo_para_vender";
    case "ingrediente":
      return "ingrediente";
    case "cocina":
      return "cocina";
    case "cocina_receta":
      return "cocina";
    case "servicio":
      return "servicio";
  }
}
