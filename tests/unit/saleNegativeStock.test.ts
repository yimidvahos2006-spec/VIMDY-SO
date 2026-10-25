import { describe, it, expect } from "vitest";
import { findSaleNegativeStock } from "../../src/core/utils/saleNegativeStock";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import type { Product } from "../../src/core/entities/Entities";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Producto",
    categoryId: "cat-1",
    price: 1000,
    stock: 10,
    minStock: 2,
    unit: "und",
    active: true,
    trackStock: true,
    requiresKitchen: false,
    recipe: [],
    productionMode: "ON_DEMAND",
    lastUpdated: new Date(),
    ...overrides
  } as Product;
}

describe("findSaleNegativeStock", () => {
  it("no avisa cuando el stock alcanza (incluso si queda justo en 0)", () => {
    const products = [makeProduct({ id: "a", stock: 5 }), makeProduct({ id: "b", stock: 3 })];
    const rows = findSaleNegativeStock(new Map([["a", 2], ["b", 3]]), products);
    expect(rows).toEqual([]);
  });

  it("avisa lo que quedaría en negativo, con antes, descuento y después", () => {
    const rows = findSaleNegativeStock(
      new Map([["a", 5]]),
      [makeProduct({ id: "a", name: "Harina", unit: "kg", isIngredient: true, stock: 2 })]
    );
    expect(rows).toEqual([
      {
        productId: "a",
        name: "Harina",
        unit: "kg",
        kind: "insumo",
        stockBefore: 2,
        required: 5,
        stockAfter: -3,
        alreadyNegative: false
      }
    ]);
  });

  it("marca los que ya estaban en negativo antes de esta venta", () => {
    const rows = findSaleNegativeStock(new Map([["a", 1]]), [makeProduct({ id: "a", stock: -2 })]);
    expect(rows[0]).toMatchObject({ stockAfter: -3, alreadyNegative: true });
  });

  it("ordena del más negativo al menos negativo", () => {
    const rows = findSaleNegativeStock(
      new Map([["a", 2], ["b", 9]]),
      [makeProduct({ id: "a", name: "A", stock: 1 }), makeProduct({ id: "b", name: "B", stock: 1 })]
    );
    expect(rows.map((r) => r.productId)).toEqual(["b", "a"]);
  });

  it("ignora servicios sin control de stock, enmascarados y productos que no están en el catálogo", () => {
    const rows = findSaleNegativeStock(
      new Map([["svc", 5], ["masked", 5], ["missing", 5]]),
      [
        makeProduct({ id: "svc", trackStock: false, stock: 0 }),
        makeProduct({ id: "masked", stockMasked: true, stock: 0 })
      ]
    );
    expect(rows).toEqual([]);
  });

  it("no alerta por ruido de decimales", () => {
    const rows = findSaleNegativeStock(new Map([["a", 0.3]]), [makeProduct({ id: "a", stock: 0.1 + 0.2 })]);
    expect(rows).toEqual([]);
  });
});

describe("InventoryEngine.previewSaleConsumption + findSaleNegativeStock", () => {
  const engine = new InventoryEngine();

  it("expande la receta como la venta real y detecta el insumo que se quedaría corto", () => {
    const flour = makeProduct({ id: "flour", name: "Harina", unit: "kg", isIngredient: true, price: 0, stock: 1 });
    const pizza = makeProduct({
      id: "pizza",
      name: "Pizza",
      trackStock: false,
      stock: 0,
      recipe: [{ productId: "flour", quantity: 0.4 }]
    });
    const products = [flour, pizza];

    const consumption = engine.previewSaleConsumption([{ productId: "pizza", quantity: 3 }], products);
    expect(consumption.get("flour")).toBeCloseTo(1.2);
    expect(consumption.has("pizza")).toBe(false);

    const rows = findSaleNegativeStock(consumption, products);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ productId: "flour", kind: "insumo" });
    expect(rows[0].stockAfter).toBeCloseTo(-0.2);
  });

  it("un producto simple con stock suficiente no genera aviso", () => {
    const soda = makeProduct({ id: "soda", stock: 10 });
    const consumption = engine.previewSaleConsumption([{ productId: "soda", quantity: 2 }], [soda]);
    expect(findSaleNegativeStock(consumption, [soda])).toEqual([]);
  });

  it("lanza PRODUCT_NOT_FOUND si el producto no está en el catálogo (el hook lo captura)", () => {
    expect(() => engine.previewSaleConsumption([{ productId: "x", quantity: 1 }], [])).toThrow("PRODUCT_NOT_FOUND");
  });
});