import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText, productMatchesSearch } from "../../src/core/utils/searchText";

describe("normalizeSearchText", () => {
  it("quita tildes, diéresis y pasa a minúsculas", () => {
    expect(normalizeSearchText("  Café Jalapeño ÜBER ")).toBe("cafe jalapeno uber");
  });

  it("devuelve cadena vacía para null, undefined o vacío", () => {
    expect(normalizeSearchText(undefined)).toBe("");
    expect(normalizeSearchText(null)).toBe("");
    expect(normalizeSearchText("")).toBe("");
  });
});

describe("matchesSearch", () => {
  it("encuentra con o sin tilde en cualquiera de los dos lados", () => {
    expect(matchesSearch("Café Americano", normalizeSearchText("cafe"))).toBe(true);
    expect(matchesSearch("Cafe Americano", normalizeSearchText("café"))).toBe(true);
  });

  it("encuentra por SKU y no encuentra lo que no coincide", () => {
    expect(matchesSearch("SKU-GAS-350", normalizeSearchText("gas-350"))).toBe(true);
    expect(matchesSearch("Pizza", normalizeSearchText("hamburguesa"))).toBe(false);
  });

  it("una búsqueda vacía coincide con todo", () => {
    expect(matchesSearch("Cualquier cosa", "")).toBe(true);
  });
});
describe("productMatchesSearch", () => {
  const product = { name: "Café Americano", categoryId: "cat-1", sku: "BEB-001", barcode: "7701234567890", aliases: ["Tinto"] };

  it("encuentra por nombre ignorando tildes", () => {
    expect(productMatchesSearch(product, normalizeSearchText("cafe"))).toBe(true);
  });
  it("encuentra por SKU y por código de barras", () => {
    expect(productMatchesSearch(product, normalizeSearchText("beb-001"))).toBe(true);
    expect(productMatchesSearch(product, normalizeSearchText("770123"))).toBe(true);
  });
  it("encuentra por nombre de categoría y por alias", () => {
    expect(productMatchesSearch(product, normalizeSearchText("bebídas"), "Bebidas")).toBe(true);
    expect(productMatchesSearch(product, normalizeSearchText("tinto"))).toBe(true);
  });
  it("no encuentra lo que no coincide", () => {
    expect(productMatchesSearch(product, normalizeSearchText("pizza"), "Bebidas")).toBe(false);
  });
});
