// tests/smoke/kardex-stock-antes-despues.test.ts
/* ===========================================================================
   SMOKE TEST — Punto 7 (Kardex y trazabilidad): stock anterior / stock
   posterior en cada movimiento.
   ---------------------------------------------------------------------------
   Hueco encontrado en la auditoría del Punto 7 (2026-08-07): InventoryMovement
   solo guardaba `quantity` + `type`, así que responder "¿por qué tengo 37 y
   no 40?" para UN movimiento puntual exigía reconstruir sumando/restando
   TODO el historial a mano -- el propio checklist del Punto 7 pide
   "Stock anterior. Stock posterior." como algo verificable por movimiento,
   no solo por el total acumulado (eso ya lo cubre
   kardex-trazabilidad-produccion.test.ts con `replayStockFromKardex`).

   Corrección: `InventoryMovement.stockBefore/stockAfter` (Entities.ts),
   calculados en InventoryEngine.increaseStock/decreaseStock/createProduct a
   partir del valor REAL que ya devolvió el ajuste atómico (adjustStock),
   nunca con una lectura previa aparte -- ver comentarios en
   InventoryEngine.ts. Este test prueba:

     1. Stock inicial: stockBefore siempre 0 (un producto nuevo nunca tuvo
        stock antes de existir).
     2. Una secuencia mixta y realista (entrada, venta, devolución, merma,
        ajuste) encadena exactamente: el stockAfter de un movimiento es
        SIEMPRE el stockBefore del siguiente, sin huecos ni saltos.
     3. Producción por tandas: tanto el ingrediente consumido como el
        producto elaborado quedan con su propio stockBefore/stockAfter
        correcto (no se cruzan entre sí).
     4. Reintento offline (mismo movementId): no se genera un segundo par
        stockBefore/stockAfter -- el movimiento sigue siendo uno solo.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Product, InventoryMovement } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";

import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryMovementRepository } from "../fakes/InMemoryMovementRepository";

function buildInventory() {
  const movements = new InMemoryMovementRepository();
  const products = new FakeProductRepository(movements);
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

describe("Kardex y trazabilidad — Punto 7: stock anterior / stock posterior por movimiento", () => {
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

  it("Stock inicial: stockBefore siempre 0, stockAfter igual al stock con el que se crea", async () => {
    const cocacola = await ctx.inventory.createProduct({
      name: "Coca-Cola",
      categoryId: "cat-1",
      price: 3000,
      stock: 20,
      minStock: 5,
      trackStock: true,
      requiresKitchen: false
    });

    const history = await ctx.movements.findByProduct(cocacola.id);
    expect(history).toHaveLength(1);
    expect(history[0].stockBefore).toBe(0);
    expect(history[0].stockAfter).toBe(20);
  });

  it("Una secuencia mixta encadena: el stockAfter de cada movimiento es el stockBefore del siguiente", async () => {
    const cocacola = await ctx.inventory.createProduct({
      name: "Coca-Cola",
      categoryId: "cat-1",
      price: 3000,
      stock: 24, // movimiento 1: 0 -> 24
      minStock: 5,
      trackStock: true,
      requiresKitchen: false
    });

    await ctx.inventory.increaseStock(cocacola.id, 12, "Compra a proveedor", "yimid"); // 24 -> 36
    await ctx.inventory.consumeForSale([{ productId: cocacola.id, quantity: 5 }], "Venta VTA-0001"); // 36 -> 31
    await ctx.inventory.restoreForSale([{ productId: cocacola.id, quantity: 1 }], "Devolución venta VTA-0001"); // 31 -> 32
    await ctx.inventory.decreaseStock(cocacola.id, 2, "Se cayeron al piso", "yimid", "MERMA"); // 32 -> 30
    await ctx.inventory.increaseStock(cocacola.id, 1, "Ajuste por conteo físico", "yimid"); // 30 -> 31

    // findByProduct del fake no garantiza orden -- se ordena por fecha para
    // recorrer la cadena en el mismo orden en que ocurrieron los movimientos.
    const history = (await ctx.movements.findByProduct(cocacola.id)).sort(
      (a, b) => a.date.getTime() - b.date.getTime()
    );

    expect(history.map((m) => [m.stockBefore, m.stockAfter])).toEqual([
      [0, 24],
      [24, 36],
      [36, 31],
      [31, 32],
      [32, 30],
      [30, 31]
    ]);

    // La cadena nunca tiene huecos: stockAfter de uno == stockBefore del siguiente.
    for (let i = 1; i < history.length; i++) {
      expect(history[i].stockBefore).toBe(history[i - 1].stockAfter);
    }

    const final = await ctx.products.findById(cocacola.id);
    expect(final!.stock).toBe(31);
    expect(history[history.length - 1].stockAfter).toBe(31);
  });

  it("Producción por tandas: ingrediente y producto elaborado llevan cada uno su propio stockBefore/stockAfter, sin cruzarse", async () => {
    const harinaAntes = (await ctx.products.findById("ing-harina"))!.stock; // 1_000_000

    await ctx.inventory.produceBatch("prod-pastel", 10, "yimid"); // consume 3000 g de harina, produce 10 pasteles

    const harinaMov = (await ctx.movements.findByProduct("ing-harina"))[0];
    expect(harinaMov.type).toBe("DECREASE");
    expect(harinaMov.stockBefore).toBe(harinaAntes);
    expect(harinaMov.stockAfter).toBe(harinaAntes - 3000);

    const pastelMov = (await ctx.movements.findByProduct("prod-pastel"))[0];
    expect(pastelMov.type).toBe("INCREASE");
    expect(pastelMov.stockBefore).toBe(0);
    expect(pastelMov.stockAfter).toBe(10);
  });

  it("Reintentar el mismo movementId (offline) no genera un segundo stockBefore/stockAfter", async () => {
    const movementId = "pending-adj-002";

    await ctx.inventory.increaseStock(
      "ing-harina", 500, "Compra a proveedor (offline)", "yimid", undefined, undefined, movementId
    );
    await ctx.inventory.increaseStock(
      "ing-harina", 500, "Compra a proveedor (offline)", "yimid", undefined, undefined, movementId
    );

    const movements: InventoryMovement[] = (await ctx.movements.findAll()).filter(
      (m: any) => m.id === movementId
    );

    expect(movements).toHaveLength(1);
    expect(movements[0].stockBefore).toBe(1000000);
    expect(movements[0].stockAfter).toBe(1000500);
  });
});