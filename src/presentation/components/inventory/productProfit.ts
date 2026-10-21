import type { Product } from "../../../core/entities/Entities";
import type { Profitability } from "../../../core/engines/RecipeEngine";
import { inferProductType } from "../../../core/types/productType";

/**
 * Qué mostrar en la tabla de Productos sobre costo y ganancia.
 * - "none": no aplica (servicios como domicilio o propina, o precio 0).
 * - "missing-cost": falta el costo (del producto o de algún ingrediente de su
 *   receta). NUNCA se muestra una ganancia en ese caso: con costo 0 saldría
 *   100% de ganancia, que es mentira.
 * - "ok": costo y ganancia confiables. `profit` puede ser negativo (pérdida).
 */
export type ProductProfitView =
  | { kind: "none" }
  | { kind: "missing-cost" }
  | { kind: "ok"; cost: number; profit: number };

/** `getProfitability` se pide solo si hace falta (los servicios no calculan nada). */
export function getProductProfitView(product: Product, getProfitability: () => Profitability): ProductProfitView {
  if (inferProductType(product) === "servicio") return { kind: "none" };
  if (!(product.price > 0)) return { kind: "none" };
  const result = getProfitability();
  if (result.costUnreliable) return { kind: "missing-cost" };
  return { kind: "ok", cost: result.cost, profit: result.profit };
}