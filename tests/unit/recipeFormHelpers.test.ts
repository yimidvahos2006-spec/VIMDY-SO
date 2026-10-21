import { describe, it, expect } from "vitest";
import {
  filterIngredientOptions,
  findRecipeRowProblem,
  normalizeSearch,
  sanitizeQuantityInput
} from "../../src/presentation/components/inventory/recipeFormHelpers";

const opts = [
  { id: "1", name: "Carne molida" },
  { id: "2", name: "Azúcar" },
  { id: "3", name: "Pan hamburguesa" },
  { id: "4", name: "Queso" },
  { id: "5", name: "Salsa de carne" }
];

describe("normalizeSearch", () => {
  it("quita tildes y mayúsculas", () => {
    expect(normalizeSearch("  AZÚCAR ")).toBe("azucar");
  });
});

describe("filterIngredientOptions", () => {
  it("encuentra sin tildes y pone primero los que empiezan igual", () => {
    const r = filterIngredientOptions(opts, "carne", new Set());
    expect(r.items.map((o) => o.name)).toEqual(["Carne molida", "Salsa de carne"]);
    expect(filterIngredientOptions(opts, "azucar", new Set()).items[0].id).toBe("2");
  });

  it("no ofrece ingredientes que ya están en la receta", () => {
    const r = filterIngredientOptions(opts, "carne", new Set(["1"]));
    expect(r.items.map((o) => o.id)).toEqual(["5"]);
  });

  it("sin texto lista alfabético y respeta el límite, informando el total", () => {
    const r = filterIngredientOptions(opts, "", new Set(), 2);
    expect(r.items).toHaveLength(2);
    expect(r.total).toBe(5);
    expect(r.items[0].name).toBe("Azúcar");
  });

  it("busca por varias palabras en cualquier orden", () => {
    expect(filterIngredientOptions(opts, "hamburguesa pan", new Set()).items[0].id).toBe("3");
  });
});

describe("sanitizeQuantityInput", () => {
  it("deja solo números y un separador decimal", () => {
    expect(sanitizeQuantityInput("1a2,5,7")).toBe("12,57");
    expect(sanitizeQuantityInput("-3e")).toBe("3");
    expect(sanitizeQuantityInput("0.12")).toBe("0.12");
  });
});

describe("findRecipeRowProblem", () => {
  const nameOf = (id: string) => opts.find((o) => o.id === id)?.name ?? "?";

  it("sin ingredientes pide agregar uno", () => {
    expect(findRecipeRowProblem([], nameOf)?.message).toMatch(/al menos un ingrediente/);
  });

  it("señala la fila sin cantidad, con el nombre del ingrediente", () => {
    const p = findRecipeRowProblem([{ rowId: "a", productId: "1", quantity: "" }], nameOf);
    expect(p?.rowId).toBe("a");
    expect(p?.message).toContain("Carne molida");
  });

  it("rechaza cantidad 0 o texto", () => {
    expect(findRecipeRowProblem([{ rowId: "a", productId: "1", quantity: "0" }], nameOf)).not.toBeNull();
    expect(findRecipeRowProblem([{ rowId: "a", productId: "1", quantity: "abc" }], nameOf)).not.toBeNull();
  });

  it("detecta ingredientes repetidos", () => {
    const p = findRecipeRowProblem(
      [
        { rowId: "a", productId: "1", quantity: "1" },
        { rowId: "b", productId: "1", quantity: "2" }
      ],
      nameOf
    );
    expect(p?.rowId).toBe("b");
  });

  it("acepta coma decimal y devuelve null si todo está bien", () => {
    expect(findRecipeRowProblem([{ rowId: "a", productId: "1", quantity: "0,12" }], nameOf)).toBeNull();
  });
});
