import { describe, expect, it } from "vitest";
import { matchesSearch, normalizeSearchText } from "../../src/core/utils/searchText";

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