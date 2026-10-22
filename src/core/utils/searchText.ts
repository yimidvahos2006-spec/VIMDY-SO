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