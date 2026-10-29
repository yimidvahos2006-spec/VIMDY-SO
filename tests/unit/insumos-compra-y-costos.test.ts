// tests/unit/insumos-compra-y-costos.test.ts
/* ===========================================================================
   PRUEBAS — Reabastecimiento de insumos y costos de las recetas
   ---------------------------------------------------------------------------
     1. Registrar una compra suma el stock y actualiza el costo del insumo.
     2. El costo de los platos que usan ese insumo cambia de inmediato
        (RecipeEngine calcula en vivo con el costo guardado del insumo).
     3. computeCostImpact avisa qué platos cambian (costo y margen antes/después).
     4. Una compra sin costo no toca el costo; un costo inválido se rechaza.
=========================================================================== */

import { beforeEach, describe, expect, it } from "vitest";

import type { InventoryMovement, Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { computeCostImpact } from "../../src/core/utils/recipeCostImpact";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function setup() {
  const movements = new InMemoryRepository<InventoryMovement>("inventory_movements");
  const products = new FakeProductRepository(movements);
  const inventory = new InventoryEngine(products, new KardexEngine(movements));
  const recipes = new RecipeEngine(products);
  return { products, inventory, recipes };
}

async function catalog(ctx: ReturnType<typeof setup>) {
  const all = await ctx.products.findAll();
  return { all, map: new Map(all.map((p) => [p.id, p])) };
}

describe("Insumos · compra y costo en las recetas", () => {
  let ctx: ReturnType<typeof setup>;
  let carne: Product;
  let burger: Product;

  beforeEach(async () => {
    ctx = setup();
    carne = await ctx.inventory.createProduct({
      name: "Carne",
      categoryId: "ins",
      unit: "kg",
      stock: 10,
      purchasePrice: 20000,
      isIngredient: true
    });
    burger = await ctx.inventory.createProduct({
      name: "Hamburguesa",
      categoryId: "plat",
      price: 15000,
      isIngredient: false,
      recipe: [{ productId: carne.id, quantity: 0.2 }],
      sizes: [
        { id: "dbl", name: "Doble", priceDelta: 6000, recipe: [{ productId: carne.id, quantity: 0.4 }] }
      ]
    });
  });

  it("la compra suma stock y deja el costo nuevo en el insumo", async () => {
    await ctx.inventory.increaseStock(carne.id, 5, "Compra de insumo", undefined, undefined, 24000);
    const saved = await ctx.products.findById(carne.id);
    expect(saved?.stock).toBe(15);
    expect(saved?.purchasePrice).toBe(24000);
  });

  it("el costo del plato cambia de inmediato tras la compra", async () => {
    const before = ctx.recipes.getProfitability(burger, (await catalog(ctx)).map);
    expect(before.cost).toBe(4000);

    await ctx.inventory.increaseStock(carne.id, 5, "Compra de insumo", undefined, undefined, 30000);

    const after = ctx.recipes.getProfitability(burger, (await catalog(ctx)).map);
    expect(after.cost).toBe(6000);
    expect(after.profit).toBe(9000);
  });

  it("una compra sin costo no toca el costo del insumo", async () => {
    await ctx.inventory.increaseStock(carne.id, 2, "Compra de insumo");
    expect((await ctx.products.findById(carne.id))?.purchasePrice).toBe(20000);
  });

  it("rechaza un costo negativo y no mueve el stock", async () => {
    await expect(
      ctx.inventory.increaseStock(carne.id, 2, "Compra de insumo", undefined, undefined, -5)
    ).rejects.toThrow("PURCHASE_PRICE_INVALID");
    expect((await ctx.products.findById(carne.id))?.stock).toBe(10);
  });

  it("computeCostImpact lista plato y tamaño con su costo y margen antes/después", async () => {
    const { all } = await catalog(ctx);
    const impact = computeCostImpact(ctx.recipes, all, carne.id, 30000);

    const base = impact.find((c) => c.label === "Hamburguesa");
    const doble = impact.find((c) => c.label === "Hamburguesa · Doble");
    expect(base).toMatchObject({ costBefore: 4000, costAfter: 6000, price: 15000, losesMoney: false });
    expect(base?.marginBefore).toBeCloseTo(73.33, 1);
    expect(base?.marginAfter).toBeCloseTo(60, 1);
    expect(doble).toMatchObject({ costBefore: 8000, costAfter: 12000, price: 21000 });
  });

  it("avisa cuando el costo nuevo hace perder dinero y calla si nada cambia", async () => {
    const { all } = await catalog(ctx);
    const caro = computeCostImpact(ctx.recipes, all, carne.id, 100000);
    expect(caro.find((c) => c.label === "Hamburguesa")?.losesMoney).toBe(true);
    expect(computeCostImpact(ctx.recipes, all, carne.id, 20000)).toEqual([]);
  });
});