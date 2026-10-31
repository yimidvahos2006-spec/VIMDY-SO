import type { Product } from "../entities/Entities";

/**
 * Terminología de ítems de inventario
 * ---------------------------------------------------------------------------
 * En VIMDY el inventario mezcla dos jerarquías distintas:
 *   · Producto: lo que se vende en Caja.
 *   · Insumo (`isIngredient === true`): materia prima de cocina/bodega que
 *     alimenta recetas y nunca se vende suelta.
 *
 * Los avisos de stock deben llamar a cada cosa por su nombre. Este módulo es
 * puro (sin React ni Supabase) y concentra esa decisión para que alertas,
 * notificaciones y resúmenes hablen igual.
 */

export interface ItemTypeCounts {
  readonly products: number;
  readonly insumos: number;
}

/** ¿Este ítem del inventario es un insumo (materia prima)? */
export function isInsumoItem(item: Pick<Product, "isIngredient">): boolean {
  return item.isIngredient === true;
}

/** Cuenta cuántos ítems son productos y cuántos insumos. */
export function countItemTypes(
  items: ReadonlyArray<Pick<Product, "isIngredient">>
): ItemTypeCounts {
  let insumos = 0;
  for (const item of items) {
    if (isInsumoItem(item)) insumos += 1;
  }
  return { products: items.length - insumos, insumos };
}

export type WordingStyle = "alert" | "plain";

function noun(count: number, singular: string, plural: string, style: WordingStyle): string {
  if (style === "alert") return `${count} ${singular}(s)`;
  return `${count} ${count === 1 ? singular : plural}`;
}

/**
 * Frase de conteo según el tipo de ítem:
 *   { products: 3, insumos: 0 } → "3 producto(s)"
 *   { products: 0, insumos: 2 } → "2 insumo(s)"
 *   { products: 2, insumos: 3 } → "2 producto(s) y 3 insumo(s)"
 *
 * Estilo "alert" usa "(s)" (el que ya usan las alertas del negocio);
 * estilo "plain" conjuga el plural real ("1 insumo", "2 insumos").
 */
export function describeItemCounts(counts: ItemTypeCounts, style: WordingStyle = "alert"): string {
  const parts: string[] = [];
  if (counts.products > 0) parts.push(noun(counts.products, "producto", "productos", style));
  if (counts.insumos > 0) parts.push(noun(counts.insumos, "insumo", "insumos", style));
  return parts.join(" y ");
}

/** Separa una lista en productos vendibles e insumos, conservando el orden. */
export function splitByItemType<T extends { readonly isIngredient?: boolean }>(
  items: readonly T[]
): { readonly products: T[]; readonly insumos: T[] } {
  const products: T[] = [];
  const insumos: T[] = [];
  for (const item of items) {
    (isInsumoItem(item) ? insumos : products).push(item);
  }
  return { products, insumos };
}