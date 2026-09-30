// tests/smoke/produccion-por-tandas.test.ts
/* ===========================================================================
   SMOKE TEST — Producción por tandas (Fase E del rediseño de Inventario,
   sección 5 "🏭 Producción" de la instrucción de Yimid: "Produces 10
   pasteles" -> consumir ingredientes, aumentar stock del producto
   elaborado, registrar todo en Kardex, e impedir producir si faltan
   ingredientes).
   ---------------------------------------------------------------------------
   `InventoryEngine.produceBatch()` ya existía y ya estaba conectado a la UI
   ("Producir tanda" en InventoryDashboard.tsx), pero no tenía NINGÚN test
   propio -- a diferencia de casi todo lo demás en este proyecto. Además,
   hasta el fix de IngredientConsumptionEditor.tsx (pregunta "¿Cómo lo
   produces?"), era imposible crear un producto BATCH desde el editor, así
   que esta ruta llevaba tiempo sin ejercitarse con datos reales.

   Casos cubiertos:
     1. Camino feliz: producir una tanda descuenta cada ingrediente en
        (cantidad_receta * cantidad_a_producir) y suma esa cantidad al
        stock propio del producto elaborado (ej. Pastel).
     2. Impide producir si falta stock de un ingrediente (INSUFFICIENT_STOCK),
        sin dejar ningún ingrediente descontado a medias.
     3. Rechaza producir un producto ON_DEMAND (ej. Pizza) por tanda --
        eso se prepara al vender, no con anticipación.
     4. Cada movimiento (consumo de ingredientes + entrada del producto
        elaborado) queda registrado en Kardex, con el mismo
        `saleReference`/motivo legible que ve el dueño.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";

import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryMovementRepository } from "../fakes/InMemoryMovementRepository";

function buildInventory() {
  const products = new FakeProductRepository();
  const movements = new InMemoryMovementRepository();
  const kardex = new KardexEngine(movements);
  const inventory = new InventoryEngine(products, kardex);
  return { inventory, products, movements };
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

describe("InventoryEngine.produceBatch — Producción por tandas (Fase E)", () => {
  let ctx: ReturnType<typeof buildInventory>;

  beforeEach(async () => {
    ctx = buildInventory();
    // Ingredientes del Pastel: harina y azúcar.
    await seed(ctx.products, { id: "ing-harina", name: "Harina", stock: 10000, unit: "g" });
    await seed(ctx.products, { id: "ing-azucar", name: "Azúcar", stock: 2000, unit: "g" });

    // Pastel: producto elaborado por tanda (BATCH), receta por unidad.
    await seed(ctx.products, {
      id: "prod-pastel",
      name: "Pastel",
      stock: 0,
      productionMode: "BATCH",
      recipe: [
        { productId: "ing-harina", quantity: 300 },
        { productId: "ing-azucar", quantity: 150 }
      ]
    });

    // Pizza: producto elaborado a la orden (ON_DEMAND) -- para el caso 3.
    await seed(ctx.products, {
      id: "prod-pizza",
      name: "Pizza",
      stock: 0,
      productionMode: "ON_DEMAND",
      recipe: [{ productId: "ing-harina", quantity: 350 }]
    });
  });

  it("Camino feliz: producir 10 pasteles descuenta ingredientes y suma stock del producto", async () => {
    const result = await ctx.inventory.produceBatch("prod-pastel", 10, "yimid");

    expect(result.product.stock).toBe(10);
    expect(result.consumed).toEqual(
      expect.arrayContaining([
        { productId: "ing-harina", name: "Harina", quantity: 3000 },
        { productId: "ing-azucar", name: "Azúcar", quantity: 1500 }
      ])
    );

    const harina = await ctx.products.findById("ing-harina");
    const azucar = await ctx.products.findById("ing-azucar");
    expect(harina!.stock).toBe(10000 - 3000);
    expect(azucar!.stock).toBe(2000 - 1500);
  });

  it("Impide producir si falta stock de un ingrediente, y no descuenta nada", async () => {
    // Solo alcanza azúcar para 13 pasteles (150*13=1950 <= 2000), pero
    // harina alcanza para 33 (300*33=9900 <= 10000) -- forzamos una
    // cantidad que sí choca con azúcar.
    await expect(ctx.inventory.produceBatch("prod-pastel", 14, "yimid")).rejects.toThrow(
      /INSUFFICIENT_STOCK/
    );

    // Nada debió descontarse: ni harina ni azúcar se tocaron.
    const harina = await ctx.products.findById("ing-harina");
    const azucar = await ctx.products.findById("ing-azucar");
    expect(harina!.stock).toBe(10000);
    expect(azucar!.stock).toBe(2000);

    const pastel = await ctx.products.findById("prod-pastel");
    expect(pastel!.stock).toBe(0);
  });

  it("Rechaza producir por tanda un producto ON_DEMAND (Pizza) -- se prepara al vender, no con anticipación", async () => {
    await expect(ctx.inventory.produceBatch("prod-pizza", 5, "yimid")).rejects.toThrow(
      /NOT_BATCH_PRODUCT/
    );

    const pizza = await ctx.products.findById("prod-pizza");
    expect(pizza!.stock).toBe(0);
  });

  it("Rechaza cantidades inválidas (cero o negativas) antes de tocar el inventario", async () => {
    await expect(ctx.inventory.produceBatch("prod-pastel", 0, "yimid")).rejects.toThrow(
      /INVALID_QUANTITY/
    );
    await expect(ctx.inventory.produceBatch("prod-pastel", -5, "yimid")).rejects.toThrow(
      /INVALID_QUANTITY/
    );
  });

  it("Registra en Kardex tanto el consumo de ingredientes como la entrada del producto elaborado", async () => {
    await ctx.inventory.produceBatch("prod-pastel", 4, "yimid");

    const movements = await ctx.movements.findAll();

    // El signo del movimiento lo da `type` ('INCREASE'/'DECREASE'), no el
    // número de `quantity` (que siempre se guarda positivo) -- ver
    // InventoryEngine.increaseStock/decreaseStock.
    const harinaMovement = movements.find(
      (m: any) => m.productId === "ing-harina" && m.type === "DECREASE"
    );
    const azucarMovement = movements.find(
      (m: any) => m.productId === "ing-azucar" && m.type === "DECREASE"
    );
    const pastelMovement = movements.find(
      (m: any) => m.productId === "prod-pastel" && m.type === "INCREASE"
    );

    expect(harinaMovement).toBeDefined();
    expect(azucarMovement).toBeDefined();
    expect(pastelMovement).toBeDefined();
    // Cada movimiento debe traer un motivo legible para el dueño, no un
    // código interno -- ver InventoryEngine.produceBatch().
    expect(String((pastelMovement as any).reason)).toMatch(/Producción/i);
  });
});