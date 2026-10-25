import type { Product } from "../entities/Entities";

/**
 * Alerta de Caja (Opción B): ¿esta venta dejaría algún insumo o producto en negativo?
 *
 * Recibe el consumo ya expandido de la venta (producto/ingrediente -> cantidad, la
 * misma expansión de recetas que usa InventoryEngine al descontar) y el catálogo
 * cargado en Caja. Es solo informativo: la venta nunca se bloquea.
 *
 * Los productos con stock enmascarado (conteo a ciegas) se ignoran: su stock es un
 * valor de banda, no la cantidad real.
 */
export interface SaleNegativeStockRow {
  readonly productId: string;
  readonly name: string;
  readonly unit?: string;
  readonly kind: "insumo" | "producto";
  /** Stock actual antes de la venta. */
  readonly stockBefore: number;
  /** Cantidad que esta venta descuenta. */
  readonly required: number;
  /** Stock que quedaría (negativo). */
  readonly stockAfter: number;
  /** true si ya estaba en negativo antes de esta venta. */
  readonly alreadyNegative: boolean;
}

// Tolerancia para no alertar por ruido de decimales (ej. 0.1 + 0.2 - 0.3).
const EPSILON = 1e-9;

export function findSaleNegativeStock(
  consumption: ReadonlyMap<string, number>,
  products: readonly Product[]
): SaleNegativeStockRow[] {
  const byId = new Map(products.map((p) => [p.id, p]));
  const rows: SaleNegativeStockRow[] = [];

  for (const [productId, required] of consumption) {
    const product = byId.get(productId);
    if (!product) continue;
    if (product.trackStock === false) continue;
    if (product.stockMasked === true) continue;
    if (!Number.isFinite(product.stock) || !Number.isFinite(required) || required <= 0) continue;

    const stockAfter = product.stock - required;
    if (stockAfter >= -EPSILON) continue;

    rows.push({
      productId,
      name: product.name,
      unit: product.unit,
      kind: product.isIngredient === true ? "insumo" : "producto",
      stockBefore: product.stock,
      required,
      stockAfter,
      alreadyNegative: product.stock < 0
    });
  }

  // Los que quedarían más negativos primero; desempate por nombre.
  rows.sort((a, b) => a.stockAfter - b.stockAfter || a.name.localeCompare(b.name, "es"));
  return rows;
}