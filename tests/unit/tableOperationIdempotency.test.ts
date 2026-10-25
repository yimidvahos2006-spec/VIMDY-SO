// tests/unit/tableOperationIdempotency.test.ts
/* ===========================================================================
   Paso 3 — Idempotencia de operaciones de mesa de la cola offline.

   El marcador vive DENTRO de `data` de la mesa (`appliedOperationIds`) y se
   escribe en el mismo update con bloqueo optimista que el cambio de líneas:

     1. Módulo puro de marcadores (añadir, deduplicar, tope, sin mutar).
     2. Engine real (TableEngine + InMemoryRepository con el mismo contrato de
        versión que Supabase): reintentar la misma operación no la repite.
     3. Respuesta perdida: el UPDATE llegó a la base pero el cliente recibió un
        error de red. El reintento NO duplica.
     4. Atomicidad: cambio y marcador salen en UN solo update; si el update
        pierde el bloqueo optimista, no queda marcador huérfano.
     5. Una operación ya aplicada es éxito aunque la mesa se haya cobrado
        después (el marcador se evalúa antes que las validaciones de estado).
   =========================================================================== */

import { describe, it, expect, vi } from "vitest";
import type { Table } from "../../src/core/entities/Entities";
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";
import { TableEngine } from "../../src/core/engines/TableEngine";
import {
  MAX_APPLIED_OPERATION_IDS,
  appendAppliedOperation,
  hasAppliedOperation
} from "../../src/core/offline/tableOperationMarkers";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const BURGER = { id: "burger", name: "Burger", price: 18000, requiresKitchen: true };
const COLA = { id: "cola", name: "Cola", price: 4000, requiresKitchen: false };

async function setup(overrides: Partial<Table> = {}) {
  const repo = new InMemoryRepository<Table>("tables");
  await repo.save({
    id: "t1",
    name: "Mesa 1",
    capacity: 4,
    peopleCount: 2,
    status: "BUSY",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: new Date(),
    ...overrides
  });
  return { repo, engine: new TableEngine(repo as any) };
}

const qty = async (repo: InMemoryRepository<Table>, productId: string) =>
  (await repo.findById("t1"))!.items.find((i) => i.productId === productId)?.quantity ?? 0;

describe("marcadores (módulo puro)", () => {
  it("hasAppliedOperation: false sin id, sin lista o con id ausente", () => {
    expect(hasAppliedOperation({}, "op-1")).toBe(false);
    expect(hasAppliedOperation({ appliedOperationIds: ["op-2"] }, "op-1")).toBe(false);
    expect(hasAppliedOperation({ appliedOperationIds: ["op-1"] }, undefined)).toBe(false);
    expect(hasAppliedOperation({ appliedOperationIds: ["op-1"] }, "op-1")).toBe(true);
  });

  it("appendAppliedOperation agrega al final, no duplica y no muta la entrada", () => {
    const current = Object.freeze(["a", "b"]);
    expect(appendAppliedOperation(current, "c")).toEqual(["a", "b", "c"]);
    expect(appendAppliedOperation(current, "a")).toEqual(["b", "a"]);
    expect(current).toEqual(["a", "b"]);
  });

  it("sin operationId devuelve la lista tal cual", () => {
    expect(appendAppliedOperation(["a"], undefined)).toEqual(["a"]);
    expect(appendAppliedOperation(undefined, undefined)).toBeUndefined();
  });

  it(`recorta a los últimos ${MAX_APPLIED_OPERATION_IDS} ids (descarta los más viejos)`, () => {
    let ids: readonly string[] | undefined;
    for (let i = 0; i < MAX_APPLIED_OPERATION_IDS + 5; i++) {
      ids = appendAppliedOperation(ids, `op-${i}`);
    }
    expect(ids).toHaveLength(MAX_APPLIED_OPERATION_IDS);
    expect(ids![0]).toBe("op-5");
    expect(ids![ids!.length - 1]).toBe(`op-${MAX_APPLIED_OPERATION_IDS + 4}`);
  });
});

describe("ADD_ITEM — reintento de la misma operación", () => {
  it("aplicada dos veces con el mismo operationId: la cantidad se suma UNA vez", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: BURGER, quantity: 2, operationId: "op-1" });
    await engine.addItem({ tableId: "t1", product: BURGER, quantity: 2, operationId: "op-1" });

    expect(await qty(repo, "burger")).toBe(2);
    expect((await repo.findById("t1"))!.appliedOperationIds).toEqual(["op-1"]);
  });

  it("el reintento NO escribe: la versión de la mesa no sube", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1" });
    const versionAfterFirst = (await repo.findById("t1"))!.version;

    const update = vi.spyOn(repo, "update");
    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1" });

    expect(update).not.toHaveBeenCalled();
    expect((await repo.findById("t1"))!.version).toBe(versionAfterFirst);
  });

  it("operationId distintos SÍ se aplican los dos (son dos pedidos reales)", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1" });
    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-2" });

    expect(await qty(repo, "cola")).toBe(2);
    expect((await repo.findById("t1"))!.appliedOperationIds).toEqual(["op-1", "op-2"]);
  });

  it("sin operationId (camino online) funciona como siempre y no deja marcador", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: COLA });
    await engine.addItem({ tableId: "t1", product: COLA });

    expect(await qty(repo, "cola")).toBe(2);
    expect((await repo.findById("t1"))!.appliedOperationIds).toBeUndefined();
  });

  it("el tamaño y los extras de la operación llegan a la línea (paridad con la regla de identidad)", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({
      tableId: "t1",
      product: BURGER,
      selectedSizeId: "grande",
      selectedExtraIds: ["tocineta", "queso"],
      operationId: "op-1"
    });

    const [line] = (await repo.findById("t1"))!.items;
    expect(line).toMatchObject({ selectedSizeId: "grande", selectedExtraIds: ["queso", "tocineta"] });
  });
});

describe("respuesta perdida (el UPDATE llegó pero el cliente vio un error de red)", () => {
  it("el reintento detecta el marcador y no duplica", async () => {
    const { repo, engine } = await setup();
    const realUpdate = repo.update.bind(repo);
    let lost = true;

    vi.spyOn(repo, "update").mockImplementation(async (item) => {
      await realUpdate(item); // la base SÍ aplicó el cambio
      if (lost) {
        lost = false;
        throw new TypeError("Failed to fetch"); // pero la respuesta se perdió
      }
    });

    await expect(
      engine.addItem({ tableId: "t1", product: BURGER, quantity: 3, operationId: "op-1" })
    ).rejects.toThrow("Failed to fetch");
    expect(await qty(repo, "burger")).toBe(3);

    // La cola reintenta con el MISMO id.
    await engine.addItem({ tableId: "t1", product: BURGER, quantity: 3, operationId: "op-1" });

    expect(await qty(repo, "burger")).toBe(3);
  });

  it("sin marcador el mismo reintento duplicaría (documenta el bug que se corrige)", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: BURGER, quantity: 3 });
    await engine.addItem({ tableId: "t1", product: BURGER, quantity: 3 });

    expect(await qty(repo, "burger")).toBe(6);
  });

  it("dos reintentos concurrentes del mismo id: uno aplica, el otro pierde el lock y ve el marcador", async () => {
    const { repo, engine } = await setup();

    await Promise.all([
      engine.addItem({ tableId: "t1", product: COLA, quantity: 1, operationId: "op-1" }),
      engine.addItem({ tableId: "t1", product: COLA, quantity: 1, operationId: "op-1" })
    ]);

    expect(await qty(repo, "cola")).toBe(1);
  });
});

describe("atomicidad: cambio + marcador en el mismo update con bloqueo optimista", () => {
  it("un solo update lleva las líneas nuevas Y el marcador", async () => {
    const { repo, engine } = await setup();
    const update = vi.spyOn(repo, "update");

    await engine.addItem({ tableId: "t1", product: COLA, quantity: 2, operationId: "op-1" });

    expect(update).toHaveBeenCalledTimes(1);
    const written = update.mock.calls[0][0] as Table;
    expect(written.items[0]).toMatchObject({ productId: "cola", quantity: 2 });
    expect(written.appliedOperationIds).toEqual(["op-1"]);
    expect(written.version).toBeDefined(); // viaja con la versión leída => eq("version", n)
  });

  it("si el update pierde el bloqueo optimista no queda marcador: el reintento interno aplica una sola vez", async () => {
    const { repo, engine } = await setup();
    const realUpdate = repo.update.bind(repo);
    let calls = 0;

    vi.spyOn(repo, "update").mockImplementation(async (item) => {
      calls += 1;
      if (calls === 1) {
        // Otro dispositivo guardó primero: el UPDATE no afecta filas.
        throw new OptimisticLockError("tables", item.id);
      }
      await realUpdate(item);
    });

    await engine.addItem({ tableId: "t1", product: COLA, quantity: 1, operationId: "op-1" });

    expect(calls).toBe(2);
    expect(await qty(repo, "cola")).toBe(1);
    expect((await repo.findById("t1"))!.appliedOperationIds).toEqual(["op-1"]);
  });

  it("el marcador sobrevive a los cambios de otras operaciones (se acumula)", async () => {
    const { repo, engine } = await setup();

    await engine.addItem({ tableId: "t1", product: COLA, operationId: "op-1" });
    await engine.updateItemQuantity("t1", "cola", 5, undefined, { operationId: "op-2" });
    await engine.removeItem("t1", "cola", undefined, { operationId: "op-3" });

    expect((await repo.findById("t1"))!.appliedOperationIds).toEqual(["op-1", "op-2", "op-3"]);
  });
});

describe("REMOVE_ITEM, UPDATE_QUANTITY y UPDATE_NOTE también son idempotentes", () => {
  it("UPDATE_NOTE parcial reintentado NO mueve unidades de más", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: COLA, quantity: 4 });

    // 1 unidad pasa a "con hielo" y las otras 3 quedan sin nota.
    await engine.updateItemNote("t1", "cola", undefined, "con hielo", 1, undefined, { operationId: "op-1" });
    await engine.updateItemNote("t1", "cola", undefined, "con hielo", 1, undefined, { operationId: "op-1" });

    const items = (await repo.findById("t1"))!.items;
    expect(items.find((i) => !i.note)?.quantity).toBe(3);
    expect(items.find((i) => i.note === "con hielo")?.quantity).toBe(1);
  });

  it("UPDATE_NOTE respeta tamaño y extras de la línea", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: BURGER, selectedSizeId: "grande" });
    await engine.addItem({ tableId: "t1", product: BURGER });

    await engine.updateItemNote("t1", "burger", undefined, "sin cebolla", undefined, { selectedSizeId: "grande" }, { operationId: "op-1" });

    const items = (await repo.findById("t1"))!.items;
    expect(items.find((i) => i.selectedSizeId === "grande")?.note).toBe("sin cebolla");
    expect(items.find((i) => !i.selectedSizeId)?.note).toBeUndefined();
  });

  it("UPDATE_QUANTITY y REMOVE_ITEM reintentados no cambian el resultado ni escriben otra vez", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: COLA, quantity: 2 });
    await engine.updateItemQuantity("t1", "cola", 7, undefined, { operationId: "op-q" });

    // Alguien más cambia la cantidad después: el reintento viejo NO debe pisarla.
    await engine.updateItemQuantity("t1", "cola", 3);
    await engine.updateItemQuantity("t1", "cola", 7, undefined, { operationId: "op-q" });
    expect(await qty(repo, "cola")).toBe(3);

    await engine.removeItem("t1", "cola", undefined, { operationId: "op-r" });
    await engine.addItem({ tableId: "t1", product: COLA, quantity: 1 });
    await engine.removeItem("t1", "cola", undefined, { operationId: "op-r" });
    expect(await qty(repo, "cola")).toBe(1); // el reintento no vuelve a quitar la línea nueva
  });
});

describe("la operación ya aplicada es éxito aunque la mesa cambie después", () => {
  it("mesa cobrada y liberada: el reintento de una operación YA aplicada no falla ni toca nada", async () => {
    const { repo, engine } = await setup();
    await engine.addItem({ tableId: "t1", product: COLA, quantity: 2, operationId: "op-1" });

    // La mesa se cobra: el trigger la libera conservando `data` (incluye el marcador).
    const paid = (await repo.findById("t1"))!;
    await repo.update({ ...paid, status: "FREE", items: [], subtotal: 0, tax: 0, total: 0 });

    const update = vi.spyOn(repo, "update");
    await expect(
      engine.addItem({ tableId: "t1", product: COLA, quantity: 2, operationId: "op-1" })
    ).resolves.toBeDefined();

    expect(update).not.toHaveBeenCalled();
    expect((await repo.findById("t1"))!.items).toEqual([]);
  });

  it("en cambio, una operación NO aplicada sobre una mesa libre sigue fallando con TABLE_NOT_OPEN", async () => {
    const { engine } = await setup({ status: "FREE" });

    await expect(
      engine.addItem({ tableId: "t1", product: COLA, operationId: "op-nueva" })
    ).rejects.toThrow(/^TABLE_NOT_OPEN/);
  });

  it("REMOVE_ITEM offline sobre una mesa ya cobrada es conflicto (online no cambia)", async () => {
    const { engine } = await setup({ status: "FREE" });

    await expect(
      engine.removeItem("t1", "cola", undefined, { operationId: "op-1" })
    ).rejects.toThrow(/^TABLE_NOT_OPEN/);
    // Camino online: sin operationId se comporta como antes.
    await expect(engine.removeItem("t1", "cola")).resolves.toBeDefined();
  });
});