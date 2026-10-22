// src/core/utils/searchText.ts

/**
 * Normaliza texto para búsquedas: minúsculas, sin tildes ni diéresis y sin
 * espacios sobrantes. Así "cafe" encuentra "Café" y "jalapeno" encuentra
 * "Jalapeño". Función pura (sin React ni Supabase), importable desde tests.
 */
export function normalizeSearchText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** true si `haystack` contiene `needle` ignorando tildes y mayúsculas. */
export function matchesSearch(haystack: string | null | undefined, needle: string): boolean {
  if (needle === "") return true;
  return normalizeSearchText(haystack).includes(needle);
}
/** Campos de un producto que cuentan para la búsqueda (POS e Inventario). */
export interface SearchableProduct {
  readonly name: string;
  readonly categoryId: string;
  readonly barcode?: string;
  readonly sku?: string;
  readonly aliases?: readonly string[];
}

/**
 * Regla ÚNICA de búsqueda de productos, compartida por Caja e Inventario para
 * que nunca vuelvan a comportarse distinto: nombre, SKU, código de barras,
 * categoría (id y nombre visible) y alias, sin importar tildes ni mayúsculas.
 * `needle` debe venir ya normalizado con normalizeSearchText().
 */
export function productMatchesSearch(
  product: SearchableProduct,
  needle: string,
  categoryName?: string | null
): boolean {
  if (needle === "") return true;
  return (
    matchesSearch(product.name, needle) ||
    matchesSearch(product.sku, needle) ||
    matchesSearch(product.barcode, needle) ||
    matchesSearch(categoryName, needle) ||
    matchesSearch(product.categoryId, needle) ||
    (product.aliases?.some((alias) => matchesSearch(alias, needle)) ?? false)
  );
}