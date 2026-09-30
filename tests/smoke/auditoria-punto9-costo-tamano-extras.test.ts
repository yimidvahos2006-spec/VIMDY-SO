// tests/smoke/auditoria-punto9-costo-tamano-extras.test.ts
/* ===========================================================================
   SMOKE TEST — Punto 9: costo/rentabilidad/capacidad con tamaño + extras
   ---------------------------------------------------------------------------
   Antes de esta corrección, RecipeEngine.getRecipeCost/getProfitability/
   getProductionCapacity leían `product.recipe` directo, ignorando por
   completo `selectedSize`/`selectedExtras`. Con "Pizza Grande + Tocineta"
   eso significaba costear con la receta de "Pizza" (la general/base) en vez
   de la receta REAL que se vende: la de la presentación "Grande" + los
   ingredientes del extra "Tocineta".

   Objetivo: el mismo producto que se vende -> la misma receta efectiva
   (resolveEffectiveRecipe) -> el mismo costo -> la misma rentabilidad.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product } from "../../src/core/entities/Entities";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";

/* --------------------------------------------------------------------------
   Ingredientes con purchasePrice cargado (para que el costo sea confiable).
-------------------------------------------------------------------------- */
const MASA: Product = {
  id: "ing-masa", name: "Masa", categoryId: "cat-insumos",
  price: 0, purchasePrice: 10, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const SALSA: Product = {
  id: "ing-salsa", name: "Salsa", categoryId: "cat-insumos",
  price: 0, purchasePrice: 20, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const QUESO: Product = {
  id: "ing-queso", name: "Queso mozzarella", categoryId: "cat-insumos",
  price: 0, purchasePrice: 30, stock: 5000, minStock: 0, lastUpdated: new Date(), unit: "g"
};
const TOCINETA: Product = {
  id: "ing-tocineta", name: "Tocineta", categoryId: "cat-insumos",
  price: 0, purchasePrice: 50, stock: 400, minStock: 0, lastUpdated: new Date(), unit: "g"
};

/* --------------------------------------------------------------------------
   Pizza: receta general (base) DISTINTA de la de "Pizza Grande", más el
   extra "Tocineta" -- el mismo ejemplo cerrado en el Punto 3.
-------------------------------------------------------------------------- */
const PIZZA: Product = {
  id: "prod-pizza",
  name: "Pizza",
  categoryId: "cat-comidas",
  price: 25000,
  stock: 999,
  minStock: 0,
  lastUpdated: new Date(),
  // Receta general/base -- 180g masa + 60g salsa + 120g queso.
  recipe: [
    { productId: MASA.id, quantity: 180 },
    { productId: SALSA.id, quantity: 60 },
    { productId: QUESO.id, quantity: 120 }
  ],
  sizes: [
    {
      id: "size-personal",
      name: "Pizza Personal",
      priceDelta: 0
      // Sin receta propia -> cae a product.recipe (Regla 6).
    },
    {
      id: "size-grande",
      name: "Pizza Grande",
      priceDelta: 12000,
      // Receta propia -- 350g masa + 80g salsa + 250g queso.
      recipe: [
        { productId: MASA.id, quantity: 350 },
        { productId: SALSA.id, quantity: 80 },
        { productId: QUESO.id, quantity: 250 }
      ]
    }
  ],
  extras: [
    {
      id: "extra-tocineta",
      name: "Tocineta",
      priceDelta: 4000,
      recipe: [{ productId: TOCINETA.id, quantity: 40 }]
    }
  ]
};

function buildEngine() {
  const products = new FakeProductRepository();
  const recipe = new RecipeEngine(products);
  return { recipe, products };
}

describe("Punto 9 — costo/rentabilidad/capacidad respetan tamaño + extras", () => {
  let ctx: ReturnType<typeof buildEngine>;
  let productMap: Map<string, Product>;

  beforeEach(async () => {
    ctx = buildEngine();
    for (const p of [MASA, SALSA, QUESO, TOCINETA, PIZZA]) {
      await ctx.products.save(p);
    }
    productMap = new Map([MASA, SALSA, QUESO, TOCINETA, PIZZA].map((p) => [p.id, p]));
  });

  it("getRecipeCost SIN selectedSize/selectedExtras sigue usando la receta general (compatibilidad)", () => {
    const cost = ctx.recipe.getRecipeCost(PIZZA, productMap);
    // 180*10 + 60*20 + 120*30 = 1800 + 1200 + 3600 = 6600
    expect(cost?.totalCost).toBe(6600);
  });

  it("getRecipeCost con Pizza Grande + Tocineta usa la receta EFECTIVA (tamaño propio + extra), no la general", () => {
    const cost = ctx.recipe.getRecipeCost(
      PIZZA,
      productMap,
      PIZZA.sizes![1], // Pizza Grande
      [PIZZA.extras![0]] // Tocineta
    );
    // Grande: 350*10 + 80*20 + 250*30 = 3500 + 1600 + 7500 = 12600
    // + Tocineta: 40*50 = 2000
    // Total: 14600 -- NUNCA 6600 (la general) ni solo 12600 (sin el extra).
    expect(cost?.totalCost).toBe(14600);
    expect(cost?.perIngredient.map((i) => i.productId).sort()).toEqual(
      [MASA.id, SALSA.id, QUESO.id, TOCINETA.id].sort()
    );
  });

  it("Pizza Personal (sin receta propia) + Tocineta cae a la receta general + el extra", () => {
    const cost = ctx.recipe.getRecipeCost(PIZZA, productMap, PIZZA.sizes![0], [PIZZA.extras![0]]);
    // General: 6600 + Tocineta: 2000 = 8600
    expect(cost?.totalCost).toBe(8600);
  });

  it("getProfitability propaga tamaño/extras y calcula el margen sobre el costo real de la variante", () => {
    const priceGrandeConTocineta = PIZZA.price + PIZZA.sizes![1].priceDelta + PIZZA.extras![0].priceDelta;
    const productoVendido: Product = { ...PIZZA, price: priceGrandeConTocineta };

    const profitability = ctx.recipe.getProfitability(
      productoVendido,
      productMap,
      PIZZA.sizes![1],
      [PIZZA.extras![0]]
    );

    // price: 25000 + 12000 + 4000 = 41000; cost: 14600 (receta efectiva)
    expect(profitability.cost).toBe(14600);
    expect(profitability.profit).toBe(41000 - 14600);
    expect(profitability.costUnreliable).toBe(false);
  });

  it("getProductionCapacity con la variante Grande+Tocineta respeta el stock del ingrediente exclusivo del extra (Tocineta, 400g)", () => {
    const capacity = ctx.recipe.getProductionCapacity(
      PIZZA,
      productMap,
      PIZZA.sizes![1],
      [PIZZA.extras![0]]
    );

    // Tocineta: 400 stock / 40 por unidad = 10 unidades -- es el ingrediente
    // limitante (masa/salsa/queso alcanzan para muchas más con 5000 de stock).
    expect(capacity?.maxUnits).toBe(10);
    expect(capacity?.limitingIngredient?.productId).toBe(TOCINETA.id);
  });

  it("getProductionCapacity SIN selectedExtras no se ve limitado por Tocineta (compatibilidad)", () => {
    const capacity = ctx.recipe.getProductionCapacity(PIZZA, productMap);
    // Receta general no toca Tocineta -- el limitante sale de masa/salsa/queso.
    expect(capacity?.limitingIngredient?.productId).not.toBe(TOCINETA.id);
  });
});