// tests/smoke/mesa-comiendo-y-guardas.test.ts
/* ===========================================================================
   Mesas ↔ Cocina: estado "Comiendo" y guardas contra mesas ya cobradas
   ---------------------------------------------------------------------------
   1. Cuando cocina entrega TODO lo enviado, la mesa pasa a "Comiendo".
   2. Si queda algo sin entregar, sigue en "Esperando comida".
   3. No se pueden agregar productos a una mesa libre (otro dispositivo la
      cobró mientras este panel seguía abierto).
   4. No se pide la cuenta de una mesa libre ni se reserva una mesa ocupada.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import type { KitchenOrder, Order, SaleItem, Table } from "../../src/core/entities/Entities";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { operationConfigStore } from "../../src/core/store/operationConfigStore";
import { kitchenOutputModeStore } from "../../src/core/store/kitchenOutputModeStore";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const pizza: SaleItem = { productId: "pizza", quantity: 2, price: 30000, requiresKitchen: true };
const pasta: SaleItem = { productId: "pasta", quantity: 1, price: 25000, requiresKitchen: true };

function buildContext() {
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen");
  const kitchen = new KitchenEngine(kitchenOrders as never, { log: async () => undefined } as never);
  const orderEngine = new OrderEngine(orders as never, kitchen, {} as never);
  const engine = new TableEngine(tables as any, kitchen, {} as any, orderEngine);
  return { engine, tables, kitchen };
}

async function freeTable(ctx: ReturnType<typeof buildContext>, id: string) {
  await ctx.tables.save({
    id, name: id, capacity: 4, peopleCount: 0, status: "FREE",
    items: [], subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date()
  } as Table);
}

async function openWith(ctx: ReturnType<typeof buildContext>, id: string, items: SaleItem[]) {
  await freeTable(ctx, id);
  await ctx.engine.openTable({ tableId: id, peopleCount: 2, waiterId: "w1", operationId: `op-${id}` });
  const opened = (await ctx.tables.findById(id)) as Table;
  await ctx.tables.update({ ...opened, items } as Table);
}

async function deliver(ctx: ReturnType<typeof buildContext>, kitchenOrderId: string) {
  await ctx.kitchen.updateStatus(kitchenOrderId, "EN_PREPARACION");
  await ctx.kitchen.updateStatus(kitchenOrderId, "LISTO");
  await ctx.kitchen.updateStatus(kitchenOrderId, "ENTREGADO");
}

beforeEach(() => {
  operationConfigStore.set({
    ...DEFAULT_OPERATION_CONFIG,
    kitchenEnabled: true,
    kitchenOutputMode: "kds",
    kdsEnabled: true,
    salesChannels: ["presencial"]
  });
  kitchenOutputModeStore.set("pantalla");
});

describe("Cocina entrega → la mesa pasa a Comiendo", () => {
  it("con todo entregado, la mesa queda en Comiendo", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    const sent = await ctx.engine.sendToKitchen("t1");
    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("WAITING_FOOD");

    await deliver(ctx, sent!.id);
    await ctx.engine.markFoodServed("t1");

    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("EATING");
  });

  it("si queda una comanda sin entregar, sigue esperando comida", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    const first = await ctx.engine.sendToKitchen("t1");

    const current = (await ctx.tables.findById("t1")) as Table;
    await ctx.tables.update({ ...current, items: [pizza, pasta] } as Table);
    await ctx.engine.sendToKitchen("t1");

    await deliver(ctx, first!.id);
    await ctx.engine.markFoodServed("t1");

    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("WAITING_FOOD");
  });

  it("no cambia una mesa que ya pidió la cuenta", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    const sent = await ctx.engine.sendToKitchen("t1");
    await ctx.engine.requestBill("t1");

    await deliver(ctx, sent!.id);
    await ctx.engine.markFoodServed("t1");

    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("CUENTA_SOLICITADA");
  });

  it("al enviar más a cocina vuelve a Esperando comida", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    const first = await ctx.engine.sendToKitchen("t1");
    await deliver(ctx, first!.id);
    await ctx.engine.markFoodServed("t1");

    const current = (await ctx.tables.findById("t1")) as Table;
    await ctx.tables.update({ ...current, items: [pizza, pasta] } as Table);
    await ctx.engine.sendToKitchen("t1");

    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("WAITING_FOOD");
  });
});

describe("Mesas ya cobradas o libres no aceptan movimientos", () => {
  it("no se agregan productos a una mesa libre", async () => {
    const ctx = buildContext();
    await freeTable(ctx, "t1");

    await expect(
      ctx.engine.addItem({ tableId: "t1", product: { id: "pizza", name: "Pizza", price: 30000, requiresKitchen: true } as never, quantity: 1 })
    ).rejects.toThrow("TABLE_NOT_OPEN");

    expect(((await ctx.tables.findById("t1")) as Table).items).toHaveLength(0);
  });

  it("no se sube la cantidad en una mesa libre", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    const current = (await ctx.tables.findById("t1")) as Table;
    await ctx.tables.update({ ...current, status: "FREE" } as Table);

    await expect(ctx.engine.updateItemQuantity("t1", "pizza", 3)).rejects.toThrow("TABLE_NOT_OPEN");
  });

  it("no se pide la cuenta de una mesa libre", async () => {
    const ctx = buildContext();
    await freeTable(ctx, "t1");
    await expect(ctx.engine.requestBill("t1")).rejects.toThrow("TABLE_NOT_OPEN");
    expect(((await ctx.tables.findById("t1")) as Table).status).toBe("FREE");
  });

  it("no se reserva una mesa ocupada", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", [pizza]);
    await expect(ctx.engine.reserveTable("t1")).rejects.toThrow("TABLE_NOT_AVAILABLE");
    expect(((await ctx.tables.findById("t1")) as Table).items).toHaveLength(1);
  });

  it("sí se agregan productos a una mesa abierta", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", []);
    const updated = await ctx.engine.addItem({
      tableId: "t1",
      product: { id: "pizza", name: "Pizza", price: 30000, requiresKitchen: true } as never,
      quantity: 1
    });
    expect(updated.items).toHaveLength(1);
  });
});