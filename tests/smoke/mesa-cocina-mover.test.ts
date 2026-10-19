// tests/smoke/mesa-cocina-mover.test.ts
/* ===========================================================================
   Mesas + Cocina (punto 3B, 4, 5 y 6)
   ---------------------------------------------------------------------------
   3B  Unir mesa: lo que ya salió a cocina NO se vuelve a enviar.
   4   Agregar personas: con 4 y agregar 1 quedan 5 (no 9).
   5   Transferir mesa: cocina y pedido siguen a la mesa nueva, sin duplicados.
   6   Cancelar pedido: cocina deja de preparar y la mesa queda libre.
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
const gaseosa: SaleItem = { productId: "gaseosa", quantity: 2, price: 4000, requiresKitchen: false };

function buildContext() {
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const kitchenOrders = new InMemoryRepository<KitchenOrder>("kitchen");
  const kitchen = new KitchenEngine(kitchenOrders as never, { log: async () => undefined } as never);
  const orderEngine = new OrderEngine(orders as never, kitchen, {} as never);
  const engine = new TableEngine(tables as any, kitchen, {} as any, orderEngine);
  return { engine, tables, orders, orderEngine, kitchen, kitchenOrders };
}

async function openWith(
  ctx: ReturnType<typeof buildContext>,
  id: string,
  name: string,
  people: number,
  items: SaleItem[]
) {
  await ctx.tables.save({
    id,
    name,
    capacity: 8,
    peopleCount: 0,
    status: "FREE",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: new Date()
  } as Table);
  await ctx.engine.openTable({ tableId: id, peopleCount: people, waiterId: "w1", operationId: `op-${id}` });
  const opened = (await ctx.tables.findById(id)) as Table;
  await ctx.tables.update({ ...opened, items } as Table);
}

async function freeTable(ctx: ReturnType<typeof buildContext>, id: string, name: string) {
  await ctx.tables.save({
    id,
    name,
    capacity: 8,
    peopleCount: 0,
    status: "FREE",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: new Date()
  } as Table);
}

function quantitySent(orders: KitchenOrder[], productId: string): number {
  return orders
    .filter((order) => order.status !== "CANCELADO")
    .flatMap((order) => order.items)
    .filter((item) => item.productId === productId)
    .reduce((sum, item) => sum + item.quantity, 0);
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

describe("3B — unir mesa no reenvía a cocina lo ya enviado", () => {
  it("las comandas de la mesa origen pasan a la destino con su nombre", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza, gaseosa]);
    await openWith(ctx, "t2", "Mesa 2", 3, [pasta]);

    await ctx.engine.sendToKitchen("t1");
    await ctx.engine.mergeTables("t1", "t2");

    const onTarget = await ctx.kitchen.getByTableId("t2");
    expect(onTarget).toHaveLength(1);
    expect(onTarget[0].origin).toBe("Mesa 2");
    expect(await ctx.kitchen.getByTableId("t1")).toHaveLength(0);
  });

  it("al enviar la mesa destino solo sale lo nuevo (la pizza ya enviada no se repite)", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza, gaseosa]);
    await openWith(ctx, "t2", "Mesa 2", 3, [pasta]);

    await ctx.engine.sendToKitchen("t1"); // 2 pizzas
    await ctx.engine.mergeTables("t1", "t2");
    await ctx.engine.sendToKitchen("t2"); // solo falta la pasta

    const all = await ctx.kitchen.getByTableId("t2");
    expect(quantitySent(all, "pizza")).toBe(2);
    expect(quantitySent(all, "pasta")).toBe(1);
  });

  it("si la unión falla, las comandas vuelven a la mesa origen", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza]);
    await openWith(ctx, "t2", "Mesa 2", 3, [pasta]);
    await ctx.engine.sendToKitchen("t1");

    const realUpdate = ctx.tables.update.bind(ctx.tables);
    (ctx.tables as any).update = async (row: Table) => {
      if (row.id === "t1" && row.status === "FREE") throw new Error("FALLO_SIMULADO_DE_RED");
      return realUpdate(row);
    };

    await expect(ctx.engine.mergeTables("t1", "t2")).rejects.toThrow("FALLO_SIMULADO_DE_RED");

    const back = await ctx.kitchen.getByTableId("t1");
    expect(back).toHaveLength(1);
    expect(back[0].origin).toBe("Mesa 1");
    expect(await ctx.kitchen.getByTableId("t2")).toHaveLength(0);
  });
});

describe("4 — agregar personas", () => {
  it("con 4 personas y agregar 1 quedan 5", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 4, [pasta]);

    await ctx.engine.addPeople("t1", 1);

    expect(((await ctx.tables.findById("t1")) as Table).peopleCount).toBe(5);
  });

  it("rechaza cantidades inválidas y mesas cerradas", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 4, [pasta]);
    await freeTable(ctx, "t9", "Mesa 9");

    await expect(ctx.engine.addPeople("t1", 0)).rejects.toThrow("TABLE_PEOPLE_INVALID");
    await expect(ctx.engine.addPeople("t1", -2)).rejects.toThrow("TABLE_PEOPLE_INVALID");
    await expect(ctx.engine.addPeople("t9", 1)).rejects.toThrow("TABLE_NOT_OPEN");
  });
});

describe("5 — transferir mesa", () => {
  it("la cuenta, la comanda y el pedido pasan a la mesa nueva; el origen queda libre", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 3, [pizza, gaseosa]);
    await freeTable(ctx, "t5", "Mesa 5");
    const before = (await ctx.tables.findById("t1")) as Table;

    await ctx.engine.sendToKitchen("t1");
    const moved = await ctx.engine.transferTable("t1", "t5");

    expect(moved.items).toHaveLength(2);
    expect(moved.peopleCount).toBe(3);
    expect(moved.orderId).toBe(before.orderId);

    const source = (await ctx.tables.findById("t1")) as Table;
    expect(source.status).toBe("FREE");
    expect(source.items).toHaveLength(0);
    expect(source.openOperationId).toBeUndefined();

    const kitchenOrders = await ctx.kitchen.getByTableId("t5");
    expect(kitchenOrders).toHaveLength(1);
    expect(kitchenOrders[0].origin).toBe("Mesa 5");

    const order = await ctx.orderEngine.getOrder(before.orderId as string);
    expect(order.tableId).toBe("t5");
  });

  it("después de transferir no se reenvía lo que ya estaba en cocina", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 3, [pizza]);
    await freeTable(ctx, "t5", "Mesa 5");

    await ctx.engine.sendToKitchen("t1");
    await ctx.engine.transferTable("t1", "t5");
    await ctx.engine.sendToKitchen("t5");

    const all = await ctx.kitchen.getByTableId("t5");
    expect(quantitySent(all, "pizza")).toBe(2);
  });

  it("nunca hay dos mesas abiertas con la misma sesión (la base de datos lo prohíbe)", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 3, [pizza]);
    await freeTable(ctx, "t5", "Mesa 5");
    const op = ((await ctx.tables.findById("t1")) as Table).openOperationId;

    const realUpdate = ctx.tables.update.bind(ctx.tables);
    let overlap = false;
    (ctx.tables as any).update = async (row: Table) => {
      await realUpdate(row);
      const open = (await ctx.tables.findAll()).filter(
        (t) => t.status !== "FREE" && t.status !== "CLOSED" && t.openOperationId === op
      );
      if (open.length > 1) overlap = true;
    };

    await ctx.engine.transferTable("t1", "t5");
    expect(overlap).toBe(false);
  });

  it("si ocupar la mesa nueva falla, todo vuelve a como estaba", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 3, [pizza]);
    await freeTable(ctx, "t5", "Mesa 5");
    await ctx.engine.sendToKitchen("t1");
    const before = (await ctx.tables.findById("t1")) as Table;

    const realUpdate = ctx.tables.update.bind(ctx.tables);
    (ctx.tables as any).update = async (row: Table) => {
      if (row.id === "t5") throw new Error("FALLO_SIMULADO_DE_RED");
      return realUpdate(row);
    };

    await expect(ctx.engine.transferTable("t1", "t5")).rejects.toThrow("FALLO_SIMULADO_DE_RED");

    const source = (await ctx.tables.findById("t1")) as Table;
    expect(source.status).toBe(before.status);
    expect(source.items).toHaveLength(1);
    expect(source.openOperationId).toBe(before.openOperationId);
    expect((await ctx.kitchen.getByTableId("t1"))[0].origin).toBe("Mesa 1");
    expect((await ctx.orderEngine.getOrder(before.orderId as string)).tableId).toBe("t1");
  });

  it("rechaza mesa ocupada, la misma mesa o una mesa sin cuenta", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza]);
    await openWith(ctx, "t2", "Mesa 2", 2, [pasta]);
    await freeTable(ctx, "t5", "Mesa 5");

    await expect(ctx.engine.transferTable("t1", "t2")).rejects.toThrow("TABLE_NOT_AVAILABLE");
    await expect(ctx.engine.transferTable("t1", "t1")).rejects.toThrow("TABLE_TRANSFER_SAME");
    await expect(ctx.engine.transferTable("t5", "t1")).rejects.toThrow("TABLE_NOT_OPEN");
  });
});

describe("6 — cancelar pedido", () => {
  it("cocina deja de preparar, el pedido se cancela y la mesa queda libre", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza, gaseosa]);
    const before = (await ctx.tables.findById("t1")) as Table;
    await ctx.engine.sendToKitchen("t1");

    await ctx.engine.cancelTableOrder("t1", "Cliente se fue");

    const table = (await ctx.tables.findById("t1")) as Table;
    expect(table.status).toBe("FREE");
    expect(table.items).toHaveLength(0);
    expect(table.total).toBe(0);
    expect(table.orderId).toBeUndefined();

    const kitchenOrders = await ctx.kitchen.getByTableId("t1");
    expect(kitchenOrders.every((order) => order.status === "CANCELADO")).toBe(true);
    expect(kitchenOrders[0].cancelReason).toBe("Cliente se fue");

    const order = await ctx.orderEngine.getOrder(before.orderId as string);
    expect(order.status).toBe("CANCELLED");

    // La mesa se puede volver a abrir.
    const reopened = await ctx.engine.openTable({
      tableId: "t1",
      peopleCount: 1,
      waiterId: "w2",
      operationId: "op-nuevo"
    });
    expect(reopened.status).toBe("BUSY");
  });

  it("si ya se entregó comida no se puede cancelar (habría consumo sin cobrar)", async () => {
    const ctx = buildContext();
    await openWith(ctx, "t1", "Mesa 1", 2, [pizza]);
    const sent = (await ctx.engine.sendToKitchen("t1")) as KitchenOrder;
    await ctx.kitchen.updateStatus(sent.id, "EN_PREPARACION");
    await ctx.kitchen.updateStatus(sent.id, "LISTO");
    await ctx.kitchen.updateStatus(sent.id, "ENTREGADO");

    await expect(ctx.engine.cancelTableOrder("t1", "x")).rejects.toThrow("TABLE_CANCEL_HAS_DELIVERED");

    const table = (await ctx.tables.findById("t1")) as Table;
    expect(table.status).not.toBe("FREE");
    expect(table.items).toHaveLength(1);
  });

  it("una mesa sin cuenta abierta no se puede cancelar", async () => {
    const ctx = buildContext();
    await freeTable(ctx, "t9", "Mesa 9");
    await expect(ctx.engine.cancelTableOrder("t9")).rejects.toThrow("TABLE_NOT_OPEN");
  });
});

describe("duración promedio de mesa", () => {
  async function completedTableOrder(ctx: ReturnType<typeof buildContext>, id: string, minutes: number) {
    const start = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await ctx.orders.save({
      id,
      tableId: "t1",
      status: "COMPLETED",
      items: [],
      createdAt: start,
      updatedAt: new Date(start.getTime() + minutes * 60 * 1000)
    } as unknown as Order);
  }

  it("sin historial suficiente usa 45 minutos", async () => {
    const ctx = buildContext();
    await completedTableOrder(ctx, "o1", 30);
    expect(await ctx.engine.getAverageDuration()).toBe(45 * 60 * 1000);
  });

  it("con historial usa la mediana y descarta duraciones absurdas", async () => {
    const ctx = buildContext();
    const minutes = [30, 40, 50, 60, 70, 2, 900]; // 2 min y 15 h se descartan
    for (let i = 0; i < minutes.length; i++) await completedTableOrder(ctx, `o${i}`, minutes[i]);
    expect(await ctx.engine.getAverageDuration()).toBe(50 * 60 * 1000);
  });
});