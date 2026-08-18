import { describe, it, expect } from "vitest";
import { buildProductInputFromImportRow, inferUnitFromProductName } from "../../src/presentation/components/inventory/importHelpers";

const baseRow = {
  id: "row-1",
  name: "Hamburguesa",
  price: "18000",
  requiresReview: false,
  categoryId: "cat-elaborados",
  requiresKitchen: true,
  stock: "0",
  recipeRows: [],
  taxRate: "",
  unit: "unidad",
  productionMode: "NONE" as const,
  isIngredient: false
};

describe("importHelpers", () => {
  it("infers kg unit from product name", () => {
    expect(inferUnitFromProductName("Carne 1kg")).toBe("kg");
  });

  it("builds a kitchen product without recipe as non-stock item", () => {
    const input = buildProductInputFromImportRow({
      ...baseRow,
      requiresKitchen: true,
      recipeRows: [],
      productionMode: "NONE"
    }, "");

    expect(input.requiresKitchen).toBe(true);
    expect(input.trackStock).toBe(false);
    expect(input.recipe).toBeUndefined();
    expect(input.productionMode).toBeUndefined();
    expect(input.unit).toBe("unidad");
  });

  it("builds a recipe product without assuming production mode when none is specified", () => {
    const input = buildProductInputFromImportRow({
      ...baseRow,
      requiresKitchen: true,
      recipeRows: [{ rowId: "ing-1", productId: "prod-ingrediente", quantity: "2" }],
      productionMode: "NONE"
    }, "");

    expect(input.recipe).toEqual([{ productId: "prod-ingrediente", quantity: 2 }]);
    expect(input.productionMode).toBeUndefined();
    expect(input.trackStock).toBe(false);
  });

  it("builds a batch recipe product with stock tracking enabled", () => {
    const input = buildProductInputFromImportRow({
      ...baseRow,
      requiresKitchen: true,
      recipeRows: [{ rowId: "ing-1", productId: "prod-ingrediente", quantity: "3" }],
      productionMode: "BATCH"
    }, "");

    expect(input.recipe).toEqual([{ productId: "prod-ingrediente", quantity: 3 }]);
    expect(input.productionMode).toBe("BATCH");
    expect(input.trackStock).toBe(true);
  });

  it("uses batch tax when row tax is empty", () => {
    const input = buildProductInputFromImportRow({
      ...baseRow,
      requiresKitchen: false,
      stock: "5",
      taxRate: "",
      productionMode: "NONE"
    }, "19");

    expect(input.taxRate).toBe(19);
    expect(input.trackStock).toBe(true);
    expect(input.stock).toBe(5);
  });
});
