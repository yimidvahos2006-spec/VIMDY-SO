// tests/smoke/kardex-trazabilidad-produccion.test.ts
/* ===========================================================================
   SMOKE TEST — Punto 7 de la auditoría de Inventario: Kardex y trazabilidad.

   `produccion-por-tandas.test.ts` y `produccion-por-tandas-venta-devolucion
   .test.ts` ya prueban que produceBatch/consumeForSale/restoreForSale mueven
   los números correctos. Lo que faltaba probar es lo que pide el Punto 7
   específicamente:

     1. Referencia única por tanda: antes de este fix, DOS tandas del mismo
        producto (ej. Pastel en la mañana y otra vez en la tarde) generaban
        movimientos con el mismo texto exacto ("Producción: 10 unidades
        preparadas") -- indistinguibles en el Kardex sin comparar
        timestamps a mano. Ahora InventoryEngine.produceBatch() devuelve un
        `reference` único (mismo patrón que el código de una venta,
        "RAP-123456-0001") y lo estampa en el `reason` de TODOS los
        movimientos que genera esa tanda -- el ingrediente consumido y el
        producto elaborado.
     2. Cuadre matemático: "stock anterior + entradas − salidas = stock
        actual" para una secuencia realista y mixta de movimientos (stock
        inicial, entrada manual, producción de tanda, venta, devolución,
        merma, ajuste manual) -- ningún movimiento se pierde ni se cuenta
        dos veces.
     3. Idempotencia ante reintentos: si el mismo `movementId` se reenvía
        dos veces (reintento de sincronización offline tras un corte de
        red a mitad de camino), el segundo envío NO debe duplicar ni el
        movimiento en Kardex ni el ajuste de stock.
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

/**
 * Reconstruye el stock de un producto desde CERO, sumando/restando cada
 * movimiento de su Kardex -- sin mirar el stock actual del producto en
 * ningún momento. Si esto no coincide con `product.stock`, el Kardex no
 * "cuadra": hay un movimiento de stock que no quedó registrado, o un
 * registro de Kardex que no corresponde a un movimiento real.
 */
function replayStockFromKardex(movements: { productId: string; type: string; quantity: number }[], productId: string): number {
  return movements
    .filter((m) => m.productId === productId)
    .reduce((stock, m) => {
      if (m.type === "INCREASE") return stock + m.quantity;
      if (m.type === "DECREASE") return stock - m.quantity;
      return stock; // ADJUST no se usa en este flujo
    }, 0);
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

describe("Kardex y trazabilidad — Punto 7", () => {
  let ctx: ReturnType<typeof buildInventory>;

  beforeEach(async () => {
    ctx = buildInventory();
    await seed(ctx.products, { id: "ing-harina", name: "Harina", stock: 1000000, unit: "g" });
    await seed(ctx.products, {
      id: "prod-pastel",
      name: "Pastel",
      stock: 0,
      price: 8000,
      productionMode: "BATCH",
      recipe: [{ productId: "ing-harina", quantity: 300 }]
    });
  });

  it("Dos tandas del mismo producto reciben referencias distintas, estampadas en todos sus movimientos", async () => {
    const tandaA = await ctx.inventory.produceBatch("prod-pastel", 10, "yimid"); // mañana
    const tandaB = await ctx.inventory.produceBatch("prod-pastel", 5, "yimid"); // tarde

    expect(tandaA.reference).toBeTruthy();
    expect(tandaB.reference).toBeTruthy();
    expect(tandaA.reference).not.toBe(tandaB.reference); // el problema real que esto corrige

    const all = await ctx.movements.findAll();
    const pastelMovements = all.filter((m: any) => m.productId === "prod-pastel" && m.type === "INCREASE");
    const harinaMovements = all.filter((m: any) => m.productId === "ing-harina" && m.type === "DECREASE");

    expect(pastelMovements).toHaveLength(2);
    expect(harinaMovements).toHaveLength(2);

    // Cada movimiento del producto elaborado trae SU PROPIA referencia.
    const pastelReasons = pastelMovements.map((m: any) => m.reason);
    expect(pastelReasons.some((r: string) => r.includes(tandaA.reference))).toBe(true);
    expect(pastelReasons.some((r: string) => r.includes(tandaB.reference))).toBe(true);

    // Y el consumo del ingrediente de CADA tanda trae la MISMA referencia
    // que su propio producto elaborado -- así se puede reconstruir la
    // tanda completa (ingrediente + producto) buscando un solo texto.
    const harinaReasons = harinaMovements.map((m: any) => m.reason);
    expect(harinaReasons.some((r: string) => r.includes(tandaA.reference))).toBe(true);
    expect(harinaReasons.some((r: string) => r.includes(tandaB.reference))).toBe(true);

    // Ya no son indistinguibles: el set de reasons de pastel tiene 2 valores únicos.
    expect(new Set(pastelReasons).size).toBe(2);
  });

  it("El Kardex cuadra: stock anterior + entradas − salidas = stock actual, sobre una secuencia mixta real", async () => {
    // 1) Stock inicial al crear el producto (Coca-Cola, inventario directo).
    const cocacola = await ctx.inventory.createProduct({
      name: "Coca-Cola",
      categoryId: "cat-1",
      price: 3000,
      stock: 24,
      minStock: 5,
      trackStock: true,
      requiresKitchen: false
    });

    // 2) Entrada manual (compra a proveedor).
    await ctx.inventory.increaseStock(cocacola.id, 12, "Compra a proveedor", "yimid");

    // 3) Venta de 5.
    await ctx.inventory.consumeForSale([{ productId: cocacola.id, quantity: 5 }], "Venta VTA-0001");

    // 4) Devolución de 1 de esas 5.
    await ctx.inventory.restoreForSale([{ productId: cocacola.id, quantity: 1 }], "Devolución venta VTA-0001");

    // 5) Merma (se cayeron 2 al piso).
    await ctx.inventory.decreaseStock(cocacola.id, 2, "Se cayeron al piso", "yimid", "MERMA");

    // 6) Ajuste manual (conteo físico encontró 1 de más).
    await ctx.inventory.increaseStock(cocacola.id, 1, "Ajuste por conteo físico", "yimid");

    const final = await ctx.products.findById(cocacola.id);

    // Cálculo esperado a mano: 24 + 12 - 5 + 1 - 2 + 1 = 31
    expect(final!.stock).toBe(31);

    // Y el Kardex, sumado desde cero (sin conocer el resultado de antemano),
    // debe reconstruir exactamente ese mismo número -- "stock anterior +
    // entradas − salidas = stock actual".
    const allMovements = await ctx.movements.findAll();
    const replayed = replayStockFromKardex(allMovements as any, cocacola.id);
    expect(replayed).toBe(31);
  });

  it("Reintentar el mismo movementId (reintento offline) no duplica el movimiento ni el stock", async () => {
    const harinaAntes = (await ctx.products.findById("ing-harina"))!.stock;
    const movementId = "pending-adj-001";

    await ctx.inventory.increaseStock(
      "ing-harina",
      500,
      "Compra a proveedor (offline)",
      "yimid",
      undefined,
      undefined,
      movementId
    );

    // Reintento: mismo movementId, como haría syncPendingInventoryAdjustments
    // tras un corte de red justo después de que el primer intento sí se
    // aplicó pero la confirmación nunca llegó al cliente.
    await ctx.inventory.increaseStock(
      "ing-harina",
      500,
      "Compra a proveedor (offline)",
      "yimid",
      undefined,
      undefined,
      movementId
    );

    const harinaDespues = (await ctx.products.findById("ing-harina"))!.stock;
    expect(harinaDespues).toBe(harinaAntes + 500); // no 1000 -- el reintento no debe duplicar

    const movements = (await ctx.movements.findAll()).filter((m: any) => m.id === movementId);
    expect(movements).toHaveLength(1); // un solo movimiento en Kardex, no dos
  });
});