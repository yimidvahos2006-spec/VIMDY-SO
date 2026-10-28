import { describe, it, expect } from "vitest";
import { normalizeSearchText, productMatchesSearch } from "../../src/core/utils/searchText";

/** Búsqueda de Caja e Inventario con un catálogo grande (1.500 productos). */
const N = 1500;
const catalog = Array.from({ length: N }, (_, i) => ({
  name: i % 3 === 0 ? `Gaseosa Sabor ${i} Café` : `Producto ${i}`,
  categoryId: `cat-${i % 12}`,
  barcode: i % 2 === 0 ? String(7702000000000 + i) : undefined,
  sku: `SKU-${i}`,
  aliases: i % 5 === 0 ? [`alias ${i}`] : undefined
}));
const names = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`cat-${i}`, `Categoría ${i}`]));
const search = (text: string) => {
  const needle = normalizeSearchText(text);
  return catalog.filter((p) => productMatchesSearch(p, needle, names[p.categoryId]));
};

describe("búsqueda con 1.500 productos", () => {
  it("encuentra por nombre sin importar tildes ni mayúsculas", () => {
    expect(search("CAFE").length).toBe(N / 3);
  });

  it("encuentra un código de barras exacto (lo que manda el lector)", () => {
    const hit = search("7702000000998");
    expect(hit.map((p) => p.barcode)).toEqual(["7702000000998"]);
  });

  it("responde rápido: una búsqueda por tecla cabe de sobra en un fotograma", () => {
    const queries = ["g", "ga", "gas", "gase", "7702000000", "77020000009", "770200000099", "7702000000998"];
    const start = performance.now();
    for (let round = 0; round < 10; round++) queries.forEach(search);
    const perSearch = (performance.now() - start) / (10 * queries.length);
    // Margen amplio para no fallar en CI lento: lo esperado es de pocos milisegundos.
    expect(perSearch).toBeLessThan(50);
    console.info(`[búsqueda] ${N} productos: ${perSearch.toFixed(2)} ms por búsqueda`);
  });
});