// tests/smoke/mesa-open-idempotencia.test.ts
/* ===========================================================================
   SMOKE TEST — Idempotencia de apertura de mesa
   ---------------------------------------------------------------------------
   Verifica que `TableEngine.openTable()` reconozca el mismo `operationId`
   cuando un intento de apertura se reintenta, y que no falle si la mesa
   ya fue abierta por ese mismo intento.
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { Table, Order } from "../../src/core/entities/Entities";
import { TableEngine } from "../../src/core/engines/TableEngine";
import { OrderEngine } from "../../src/core/engines/OrderEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildContext() {
  const tables = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const orderEngine = new OrderEngine(orders as never, {} as never, {} as never);
  const tableEngine = new TableEngine(tables as any, {} as any, {} as any, orderEngine);
  return { tableEngine, tables, orders };
}

describe("Smoke: idempotencia de apertura de mesa", () => {
  let ctx: ReturnType<typeof buildContext>;

  beforeEach(async () => {
    ctx = buildContext();
    await ctx.tables.save({
      id: "table-1",
      name: "Mesa 1",
      capacity: 4,
      peopleCount: 0,
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date()
    } as Table);
  });

  it("reintenta la apertura con el mismo operationId sin duplicar ni fallar", async () => {
    const operationId = "open-attempt-1";

    const firstOpen = await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1",
      operationId
    });

    expect(firstOpen.status).toBe("BUSY");
    expect(firstOpen.openOperationId).toBe(operationId);

    const secondOpen = await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1",
      operationId
    });

    expect(secondOpen.status).toBe("BUSY");
    expect(secondOpen.openOperationId).toBe(operationId);
    expect(secondOpen.id).toBe(firstOpen.id);
    expect(secondOpen.updatedAt.getTime()).toBe(firstOpen.updatedAt.getTime());
  });

  it("lanza TABLE_NOT_AVAILABLE si se reintenta con otro operationId sobre la misma mesa", async () => {
    await ctx.tableEngine.openTable({
      tableId: "table-1",
      peopleCount: 2,
      waiterId: "waiter-1",
      operationId: "open-attempt-1"
    });

    await expect(
      ctx.tableEngine.openTable({
        tableId: "table-1",
        peopleCount: 2,
        waiterId: "waiter-1",
        operationId: "open-attempt-2"
      })
    ).rejects.toThrow("TABLE_NOT_AVAILABLE");
  });
});
