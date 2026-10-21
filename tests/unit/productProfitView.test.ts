// tests/unit/productProfitView.test.ts
/* ===========================================================================
   "Te cuesta / Ganas" en la tabla de Productos: nunca debe mostrar una
   ganancia inventada cuando falta el costo.
   =========================================================================== */
import { describe, it, expect } from "vitest";
import { Product } from "../../src/core/entities/Entities";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { getProductProfitView } from "../../src/presentation/components/inventory/productProfit";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

function buildProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "p1",
    name: "Producto",
    categoryId: "cat",
    price: 10000,
    stock: 5,
    minStock: 1,
    lastUpdated: new Date(),
    ...overrides
  };
}

function view(product: Product, all: Product[] = [product]) {
  const engine = new RecipeEngine(new FakeProductRepository());
  const map = new Map(all.map((p) => [p.id, p]));
  return getProductProfitView(product, () => engine.getProfitability(product, map));
}

describe("getProductProfitView", () => {
  it("producto simple con costo: muestra costo y ganancia", () => {
    const gaseosa = buildProduct({ name: "Gaseosa", price: 3000, purchasePrice: 1800, trackStock: true });
    expect(view(gaseosa)).toEqual({ kind: "ok", cost: 1800, profit: 1200 });
  });

  it("producto simple SIN costo: avisa que falta el costo, no inventa ganancia", () => {
    const gaseosa = buildProduct({ name: "Gaseosa", price: 3000, trackStock: true });
    expect(view(gaseosa)).toEqual({ kind: "missing-cost" });
  });

  it("servicio (domicilio): no aplica", () => {
    const domicilio = buildProduct({ name: "Domicilio", price: 3000, trackStock: false, requiresKitchen: false });
    expect(view(domicilio)).toEqual({ kind: "none" });
  });

  it("precio 0: no aplica", () => {
    expect(view(buildProduct({ price: 0, purchasePrice: 500, trackStock: true }))).toEqual({ kind: "none" });
  });

  it("con receta y todos los insumos con costo: suma el costo de la receta", () => {
    const harina = buildProduct({ id: "harina", name: "Harina", isIngredient: true, price: 0, purchasePrice: 2000 });
    const tamal = buildProduct({
      id: "tamal",
      name: "Tamal",
      price: 12000,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: "harina", quantity: 0.5 }]
    });
    expect(view(tamal, [harina, tamal])).toEqual({ kind: "ok", cost: 1000, profit: 11000 });
  });

  it("con receta y un insumo sin costo: avisa que falta el costo", () => {
    const harina = buildProduct({ id: "harina", name: "Harina", isIngredient: true, price: 0 });
    const tamal = buildProduct({
      id: "tamal",
      name: "Tamal",
      price: 12000,
      requiresKitchen: true,
      trackStock: false,
      recipe: [{ productId: "harina", quantity: 0.5 }]
    });
    expect(view(tamal, [harina, tamal])).toEqual({ kind: "missing-cost" });
  });

  it("si cuesta más de lo que se vende, la ganancia sale negativa (pérdida)", () => {
    const caro = buildProduct({ price: 1000, purchasePrice: 1800, trackStock: true });
    expect(view(caro)).toEqual({ kind: "ok", cost: 1800, profit: -800 });
  });
});