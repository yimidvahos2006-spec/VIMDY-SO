// tests/smoke/produccion-por-tandas-venta-devolucion.test.ts
/* ===========================================================================
   SMOKE TEST — Producción por tandas: el flujo COMPLETO (Punto 6 de la
   auditoría de Inventario, pedido explícito de Yimid: "Ingredientes ->
   producir tanda -> aumenta stock del producto -> vender -> disminuye
   stock del producto").

   `produccion-por-tandas.test.ts` ya cubre produceBatch() de forma aislada
   (camino feliz, ingrediente insuficiente, ON_DEMAND rechazado, Kardex).
   Lo que NINGÚN test ejercitaba todavía es la cadena completa una vez que
   el pastel ya está en stock: ¿una venta descuenta el pastel mismo o
   vuelve a tocar harina/azúcar? ¿una devolución repone el pastel? ¿el
   costo/rentabilidad de un producto BATCH sale del mismo lugar que uno
   ON_DEMAND? InventoryEngine.consumeForSale/restoreForSale y
   RecipeEngine.getRecipeCost/getProfitability ya tienen ramas explícitas
   para `productionMode === 'BATCH'` (ver los comentarios "BLOQUEANTE
   (auditoría Fase 2 — Panadería)" en InventoryEngine.ts) pero esas ramas
   nunca se habían probado con un producto que de verdad pasó por
   produceBatch() primero -- este test cierra ese hueco.

   Casos cubiertos:
     1. Vender 1 pastel ya producido descuenta el STOCK PROPIO del pastel
        (no vuelve a tocar harina/azúcar -- esos ya se gastaron al producir
        la tanda).
     2. Devolver ese pastel repone su stock propio (no "repone" harina ni
        azúcar, que nunca se descontaron en la venta).
     3. Costo por porción y rentabilidad de un producto BATCH salen de la
        MISMA receta que descontó produceBatch(), igual que si fuera
        ON_DEMAND -- el modo de producción no cambia cómo se calcula el
        costo, solo cuándo se descuentan los ingredientes.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { RecipeEngine } from "../../src/core/engines/RecipeEngine";

import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryMovementRepository } from "../fakes/InMemoryMovementRepository";

function buildInventory() {
  const products = new FakeProductRepository();
  const movements = new InMemoryMovementRepository();
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  const recipe = new RecipeEngine(products);
  return { inventory, recipe, products, movements };
}

async function seed(products: FakeProductRepository, overrides: Partial<Product> & { id: string; name: string }) {
  const base: Product = {
    id: overrides.id,
    name: overrides.name,
    categoryId: "cat-1",
    price: 0,
    stock: 0,
    minStock: 0,
    active: true,
    favorite: false,
    productionMode: "ON_DEMAND",
    trackStock: true
  } as Product;
  const product = { ...base, ...overrides };
  await products.save(product);
  return product;
}

describe("Producción por tandas — flujo completo (producir → vender → devolver → costo)", () => {
  let ctx: ReturnType<typeof buildInventory>;

  beforeEach(async () => {
    ctx = buildInventory();
    // Ingredientes del Pastel, con precio de compra para poder calcular costo.
    await seed(ctx.products, { id: "ing-harina", name: "Harina", stock: 10000, unit: "g", purchasePrice: 0.01 });
    await seed(ctx.products, { id: "ing-azucar", name: "Azúcar", stock: 2000, unit: "g", purchasePrice: 0.02 });

    // Pastel: producto elaborado por tanda (BATCH), a $8000 c/u.
    await seed(ctx.products, {
      id: "prod-pastel",
      name: "Pastel",
      stock: 0,
      price: 8000,
      productionMode: "BATCH",
      trackStock: true,
      recipe: [
        { productId: "ing-harina", quantity: 300 },
        { productId: "ing-azucar", quantity: 150 }
      ]
    });
  });

  it("Vender 1 pastel ya producido descuenta el pastel, no vuelve a tocar los ingredientes", async () => {
    await ctx.inventory.produceBatch("prod-pastel", 10, "yimid");

    const harinaTrasProducir = (await ctx.products.findById("ing-harina"))!.stock;
    const azucarTrasProducir = (await ctx.products.findById("ing-azucar"))!.stock;

    // Venta de 1 unidad -- mismo camino que usa SalesEngine.updateInventory
    // en dirección DECREASE.
    await ctx.inventory.consumeForSale(
      [{ productId: "prod-pastel", quantity: 1 }],
      "Venta #1"
    );

    const pastel = await ctx.products.findById("prod-pastel");
    const harina = await ctx.products.findById("ing-harina");
    const azucar = await ctx.products.findById("ing-azucar");

    expect(pastel!.stock).toBe(9); // 10 producidos - 1 vendido
    expect(harina!.stock).toBe(harinaTrasProducir); // intacta: ya se gastó al producir
    expect(azucar!.stock).toBe(azucarTrasProducir); // intacta: ya se gastó al producir
  });

  it("Devolver el pastel vendido repone su stock propio, no los ingredientes", async () => {
    await ctx.inventory.produceBatch("prod-pastel", 10, "yimid");
    await ctx.inventory.consumeForSale([{ productId: "prod-pastel", quantity: 1 }], "Venta #1");

    const harinaTrasVenta = (await ctx.products.findById("ing-harina"))!.stock;
    const azucarTrasVenta = (await ctx.products.findById("ing-azucar"))!.stock;

    // Devolución -- mismo camino que usa SalesEngine.updateInventory en
    // dirección INCREASE (cancelación/reembolso).
    await ctx.inventory.restoreForSale(
      [{ productId: "prod-pastel", quantity: 1 }],
      "Devolución venta #1"
    );

    const pastel = await ctx.products.findById("prod-pastel");
    const harina = await ctx.products.findById("ing-harina");
    const azucar = await ctx.products.findById("ing-azucar");

    expect(pastel!.stock).toBe(10); // vuelve a las 10 unidades producidas
    expect(harina!.stock).toBe(harinaTrasVenta); // sin cambios
    expect(azucar!.stock).toBe(azucarTrasVenta); // sin cambios
  });

  it("El costo y la rentabilidad de un producto BATCH salen de su receta, igual que uno ON_DEMAND", async () => {
    await ctx.inventory.produceBatch("prod-pastel", 10, "yimid");

    const allProducts = new Map((await ctx.products.findAll()).map((p) => [p.id, p]));
    const pastel = allProducts.get("prod-pastel")!;

    const cost = ctx.recipe.getRecipeCost(pastel, allProducts);
    const profitability = ctx.recipe.getProfitability(pastel, allProducts);

    // Costo por porción: 300g harina * $0.01 + 150g azúcar * $0.02 = 3 + 3 = $6
    expect(cost!.costPerPortion).toBe(6);
    expect(profitability.cost).toBe(6);
    expect(profitability.profit).toBe(8000 - 6);
    expect(profitability.costUnreliable).toBe(false);
  });

  it("Registra en Kardex la venta y la devolución del pastel con su nombre real", async () => {
    await ctx.inventory.produceBatch("prod-pastel", 10, "yimid");
    await ctx.inventory.consumeForSale([{ productId: "prod-pastel", quantity: 1 }], "Venta #1");
    await ctx.inventory.restoreForSale([{ productId: "prod-pastel", quantity: 1 }], "Devolución venta #1");

    const movements = await ctx.movements.findAll();
    const ventaMovement = movements.find(
      (m: any) => m.productId === "prod-pastel" && m.type === "DECREASE" && String(m.reason).includes("Venta #1")
    );
    const devolucionMovement = movements.find(
      (m: any) => m.productId === "prod-pastel" && m.type === "INCREASE" && String(m.reason).includes("Devolución venta #1")
    );

    expect(ventaMovement).toBeDefined();
    expect((ventaMovement as any).productName).toBe("Pastel");
    expect(devolucionMovement).toBeDefined();
    expect((devolucionMovement as any).productName).toBe("Pastel");
  });
});