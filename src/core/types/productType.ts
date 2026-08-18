// src/core/types/productType.ts
import { Product } from "../entities/Entities";

/**
 * Tipo canónico de producto de VIMDY.
 *
 * Es la ÚNICA fuente de verdad para clasificar un producto. NUNCA debe
 * deducirse de combinaciones accidentales de flags en la UI; se infiere
 * de forma determinística a partir del estado persistido (ver
 * inferProductType), de modo que al recargar/editar un producto el tipo
 * sea estable.
 */
export type ProductType = "inventario" | "ingrediente" | "cocina" | "cocina_receta" | "servicio";

/**
 * Infiere el tipo de producto a partir de un producto existente (o el
 * default para uno nuevo).
 *
 * BLOQUEANTE #2 (auditoría Fase 2) — fix: antes "Inventario" y "Servicio"
 * se guardaban con los MISMOS flags (requiresKitchen=false, sin receta),
 * así que esta función no tenía forma de distinguirlos y un producto
 * Servicio volvía a aparecer como Inventario al reabrirlo. Se introdujo
 * `trackStock` explícito para distinguirlos.
 *
 * BLOQUEANTE (bug cocina_receta ON_DEMAND — auditoría Fase 1): la versión
 * anterior revisaba `trackStock === false` ANTES que la receta, así que un
 * producto "cocina_receta" en modo ON_DEMAND (que legítimamente se guarda
 * con trackStock=false porque no maneja stock propio — consume ingredientes
 * directo de la receta) se reabría como "servicio", perdiendo su tipo.
 *
 * La inferencia es estrictamente determinística y por orden de "fuerza" del
 * flag, sin depender de combinaciones accidentales:
 *   1. ¿Tiene receta?        -> cocina_receta (siempre, ON_DEMAND o BATCH)
 *   2. ¿Requiere cocina?     -> cocina (sin receta)
 *   3. ¿trackStock === false?-> servicio  (solo queda este caso: no receta,
 *                              no cocina, no stock propio)
 *   4. Si no                -> inventario
 *
 * Esto garantiza que un producto con receta NUNCA se interprete como
 * servicio aunque trackStock sea false por el modo de producción.
 */
export function inferProductType(product?: Product): ProductType {
  if (!product) return "cocina"; // nuevo producto: mismo default seguro que ya usa requiresKitchen.
  if (product.isIngredient === true) return "ingrediente";
  if (product.recipe && product.recipe.length > 0) return "cocina_receta";
  if (product.requiresKitchen) return "cocina";
  if (product.trackStock === false) return "servicio";
  return "inventario";
}

/**
 * Traduce el tipo canónico a los flags persistidos que entienden los
 * motores (InventoryEngine, SalesEngine, etc.). Es el inverso de
 * inferProductType: garantiza que el estado guardado sea ESTABLE y que
 * re-inferir el tipo devuelva exactamente el mismo tipo.
 *
 * Reglas funcionales (ver FASE 1 de la auditoría):
 *  - inventario:     trackStock=true,  requiresKitchen=false, sin receta
 *  - ingrediente:    trackStock=true,  requiresKitchen=false, sin receta
 *  - cocina:         trackStock=false, requiresKitchen=true,  sin receta
 *  - cocina_receta:  trackStock Depende del modo de producción:
 *                      - ON_DEMAND: trackStock=false (consume ingredientes
 *                        directo de la receta; no maneja stock propio)
 *                      - BATCH:     trackStock=true  (maneja stock propio:
 *                        unidades producidas por tanda que se descuentan
 *                        al vender)
 *                    requiresKitchen=true siempre.
 *  - servicio:       trackStock=false, requiresKitchen=false, sin receta
 */
export function resolveProductFlags(type: ProductType, productionMode: "ON_DEMAND" | "BATCH"): {
  trackStock: boolean;
  requiresKitchen: boolean;
  hasRecipe: boolean;
} {
  switch (type) {
    case "inventario":
      return { trackStock: true, requiresKitchen: false, hasRecipe: false };
    case "ingrediente":
      return { trackStock: true, requiresKitchen: false, hasRecipe: false };
    case "cocina":
      return { trackStock: false, requiresKitchen: true, hasRecipe: false };
    case "cocina_receta":
      return {
        trackStock: productionMode === "BATCH",
        requiresKitchen: true,
        hasRecipe: true
      };
    case "servicio":
      return { trackStock: false, requiresKitchen: false, hasRecipe: false };
  }
}