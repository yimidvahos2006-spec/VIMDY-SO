// tests/unit/tableConflictRules.test.ts
/* ===========================================================================
   Paso 4 — Conflictos de significado (reglas puras + guardia del engine).

     1. classifyTableConflict: qué errores del engine son conflicto de
        significado y cuáles NO (red caída, validación, conflicto de versión).
     2. assertSameTableSession: la mesa se cobró y se reabrió para otro cliente.
     3. TableEngine con operationId/expectedSessionId: una operación offline
        nunca se aplica a la cuenta de otro cliente.
     4. blockedTablesFrom: mesas bloqueadas derivadas de la cola.
   =========================================================================== */

import { describe, it, expect } from "vitest";
import type { Table } from "../../src/core/entities/Entities";
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";
import { TableEngine } from "../../src/core/engines/TableEngine";
import type { PendingTableOperation } from "../../src/core/offline/PendingTableOperation";
import {
  assertSameTableSession,
  blockedTableIds,
  blockedTablesFrom,
  classifyTableConflict
} from "../../src/core/offline/tableConflictRules";
import { isBusinessError } from "../../src/core/offline/offlineConstants";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const COLA = { id: "cola", name: "Cola", price: 4000, requiresKitchen: false };

describe("classifyTableConflict", () => {
  it.each([
    ["TABLE_NOT_OPEN: la mesa ya no tiene una cuenta abierta", "TABLE_NOT_OPEN"],
    ["TABLE_NOT_OPEN", "TABLE_NOT_OPEN"],
    ["TABLE_ALREADY_CLOSED", "TABLE_ALREADY_CLOSED"],
    ["TABLE_NOT_AVAILABLE", "TABLE_NOT_AVAILABLE"],
    ["TABLE_SESSION_CHANGED: otra cuenta", "TABLE_SESSION_CHANGED"],
    ["TABLE_SALE_STALE: la venta no coincide", "TABLE_SALE_STALE"],
    ["TABLE_NOTE_ALREADY_SENT: ya salió a cocina", "TABLE_NOTE_ALREADY_SENT"],
    ["TABLE_NOT_FOUND", "TABLE_NOT_FOUND"]
  ])("%s => conflicto %s", (message, code) => {
    const conflict = classifyTableConflict(new Error(message));
    expect(conflict).toMatchObject({ code, detail: message });
    expect(conflict!.detectedAt).toBeInstanceOf(Date);
  });

  it("acepta errores que no son Error (string)", () => {
    expect(classifyTableConflict("TABLE_NOT_OPEN")?.code).toBe("TABLE_NOT_OPEN");
  });

  it.each([
    new TypeError("Failed to fetch"),
    new Error("VALIDATION_ERROR: cantidad inválida"),
    new Error("TABLE_UPDATE_CONFLICT"),
    new Error("SUPABASE_UPDATE_FAILED (tables): boom"),
    new Error("PENDING_TABLE_OPERATION_MISSING_PRODUCT: falta"),
    new OptimisticLockError("tables", "t1"),
    new Error("")
  ])("NO es conflicto de significado: %s", (error) => {
    expect(classifyTableConflict(error)).toBeNull();
  });

  it("TABLE_ALREADY_CLOSED y TABLE_SALE_STALE hoy cuentan como error de negocio genérico: el sync debe clasificarlos como conflicto ANTES", () => {
    expect(isBusinessError(new Error("TABLE_ALREADY_CLOSED"))).toBe(true);
    expect(classifyTableConflict(new Error("TABLE_ALREADY_CLOSED"))).not.toBeNull();
    expect(classifyTableConflict(new Error("TABLE_SALE_STALE: x"))).not.toBeNull();
  });
});

describe("assertSameTableSession", () => {
  const table = { name: "Mesa 7", openOperationId: "sesion-B" };

  it("misma cuenta: pasa", () => {
    expect(() => assertSameTableSession(table, "sesion-B")).not.toThrow();
  });

  it("otra cuenta abierta: TABLE_SESSION_CHANGED", () => {
    expect(() => assertSameTableSession(table, "sesion-A")).toThrow(/^TABLE_SESSION_CHANGED/);
  });

  it("sin id esperado o sin id en la mesa no hay base para afirmar un cambio: pasa", () => {
    expect(() => assertSameTableSession(table, undefined)).not.toThrow();
    expect(() => assertSameTableSession({ name: "Mesa 7" }, "sesion-A")).not.toThrow();
  });
});

describe("TableEngine: guardia de sesión en operaciones offline", () => {
  async function setup(over: Partial<Table> = {}) {
    const repo = new InMemoryRepository<Table>("tables");
    await repo.save({
      id: "t1",
      name: "Mesa 1",
      capacity: 4,
      peopleCount: 2,
      status: "BUSY",
      openOperationId: "sesion-B",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      updatedAt: new Date(),
      ...over
    });
    return { repo, engine: new TableEngine(repo as any) };
  }

  it("ADD_ITEM hecho sobre la cuenta anterior NO se aplica a la cuenta nueva", async () => {
    const { repo, engine } = await setup();

    await expect(
      engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1", expectedSessionId: "sesion-A" })
    ).rejects.toThrow(/^TABLE_SESSION_CHANGED/);

    const table = (await repo.findById("t1"))!;
    expect(table.items).toEqual([]);
    expect(table.appliedOperationIds).toBeUndefined();
  });

  it("ADD_ITEM sobre la misma cuenta sí se aplica", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1", expectedSessionId: "sesion-B" });

    expect((await repo.findById("t1"))!.items).toHaveLength(1);
  });

  it("UPDATE_QUANTITY, UPDATE_NOTE y REMOVE_ITEM usan la misma guardia", async () => {
    const { engine } = await setup();
    const stale = { operationId: "op-1", expectedSessionId: "sesion-A" };

    await expect(engine.updateItemQuantity("t1", "cola", 2, undefined, stale)).rejects.toThrow(/^TABLE_SESSION_CHANGED/);
    await expect(engine.updateItemNote("t1", "cola", undefined, "x", undefined, undefined, stale)).rejects.toThrow(/^TABLE_SESSION_CHANGED/);
    await expect(engine.removeItem("t1", "cola", undefined, stale)).rejects.toThrow(/^TABLE_SESSION_CHANGED/);
  });

  it("SEND_TO_KITCHEN: mesa libre => TABLE_NOT_OPEN; otra cuenta => TABLE_SESSION_CHANGED (antes de enviar nada)", async () => {
    const free = await setup({ status: "FREE", openOperationId: undefined });
    await expect(free.engine.sendToKitchen("t1", "NORMAL", { expectedSessionId: "sesion-A" })).rejects.toThrow(/^TABLE_NOT_OPEN/);

    const reopened = await setup();
    await expect(reopened.engine.sendToKitchen("t1", "NORMAL", { expectedSessionId: "sesion-A" })).rejects.toThrow(/^TABLE_SESSION_CHANGED/);
  });

  it("una operación ya aplicada gana a la guardia (la cuenta se reabrió después de aplicarse)", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1", expectedSessionId: "sesion-B" });
    const current = (await repo.findById("t1"))!;
    await repo.update({ ...current, openOperationId: "sesion-C", items: [] });

    await expect(
      engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1", expectedSessionId: "sesion-B" })
    ).resolves.toBeDefined();
    expect((await repo.findById("t1"))!.items).toEqual([]);
  });
});

describe("blockedTablesFrom", () => {
  let n = 0;
  const op = (over: Partial<PendingTableOperation>): PendingTableOperation => ({
    id: `op-${String(++n).padStart(3, "0")}`,
    tableId: "t1",
    tableName: "Mesa 1",
    type: "ADD_ITEM",
    status: "PENDING_SYNC",
    queuedAt: new Date(2026, 0, 1, 0, 0, n),
    attempts: 0,
    businessId: "biz",
    branchId: "br",
    ...over
  });
  const conflict = (code: "TABLE_NOT_OPEN" | "TABLE_ALREADY_CLOSED" = "TABLE_NOT_OPEN") => ({
    code,
    detail: code,
    detectedAt: new Date(2026, 0, 2)
  });

  it("sin conflictos no hay mesas bloqueadas", () => {
    expect(blockedTablesFrom([op({}), op({ status: "FAILED" }), op({ status: "PERMANENT_FAILURE" })])).toEqual([]);
    expect(blockedTableIds([])).toEqual(new Set());
  });

  it("un CONFLICT bloquea solo su mesa y cuenta la operación del conflicto + las que esperan detrás", () => {
    const ops = [
      op({ tableId: "t1", status: "CONFLICT", conflict: conflict() }),
      op({ tableId: "t1" }),
      op({ tableId: "t1" }),
      op({ tableId: "t2", tableName: "Mesa 2" })
    ];

    const blocked = blockedTablesFrom(ops);

    expect(blocked).toHaveLength(1);
    expect(blocked[0]).toMatchObject({
      tableId: "t1",
      tableName: "Mesa 1",
      code: "TABLE_NOT_OPEN",
      conflictOperationId: ops[0].id,
      heldOperations: 3
    });
    expect(blockedTableIds(ops)).toEqual(new Set(["t1"]));
  });

  it("varias mesas con conflicto se listan por separado; con dos conflictos en una mesa manda el primero", () => {
    const ops = [
      op({ tableId: "t1", status: "CONFLICT", conflict: conflict("TABLE_NOT_OPEN") }),
      op({ tableId: "t2", tableName: "Mesa 2", status: "CONFLICT", conflict: conflict("TABLE_ALREADY_CLOSED") }),
      op({ tableId: "t1", status: "CONFLICT", conflict: conflict("TABLE_ALREADY_CLOSED") })
    ];

    const blocked = blockedTablesFrom(ops);

    expect(blocked.map((b) => b.tableId).sort()).toEqual(["t1", "t2"]);
    expect(blocked.find((b) => b.tableId === "t1")).toMatchObject({ code: "TABLE_NOT_OPEN", heldOperations: 2 });
  });

  it("un CONFLICT sin detalle (dato corrupto) no bloquea nada en vez de romper", () => {
    expect(blockedTablesFrom([op({ status: "CONFLICT" })])).toEqual([]);
  });

  it("no muta ni reordena la lista de entrada", () => {
    const ops = [op({ status: "CONFLICT", conflict: conflict() }), op({})];
    const copy = [...ops];
    blockedTablesFrom(ops);
    expect(ops).toEqual(copy);
  });
});