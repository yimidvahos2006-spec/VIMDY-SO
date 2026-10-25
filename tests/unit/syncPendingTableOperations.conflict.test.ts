// tests/unit/syncPendingTableOperations.conflict.test.ts
/* ===========================================================================
   Pasos 3 y 4 en el sync real de la cola de mesas.

   Se usa el store y el sync REALES; solo se reemplazan los bordes: el
   repositorio IndexedDB (por uno en memoria), el engine de mesas (spy), la
   conexión, los toasts y el catálogo.

     Paso 3: el sync manda `operationId = pending.id` y la cuenta esperada.
     Paso 4: un conflicto de significado bloquea SOLO esa mesa, conserva la
             operación intacta, no reintenta y avisa; las demás mesas siguen.
   =========================================================================== */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const engine = vi.hoisted(() => ({
  openTable: vi.fn(),
  closeTable: vi.fn(),
  addItem: vi.fn(),
  removeItem: vi.fn(),
  updateItemQuantity: vi.fn(),
  updateItemNote: vi.fn(),
  sendToKitchen: vi.fn()
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
const localTable = vi.hoisted(() => ({ current: null as any }));
const connection = vi.hoisted(() => ({ online: true }));

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: { tableEngine: { get: () => engine } }
}));
vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: { isOnline: () => connection.online, subscribe: () => () => {} }
}));
vi.mock("../../src/core/store/toastStore", () => ({ toast: toasts }));
vi.mock("../../src/core/store/productCatalogStore", () => ({
  productCatalogStore: { getById: (id: string) => ({ id, price: 4000, requiresKitchen: false }) }
}));
vi.mock("../../src/core/services/offlineSale", () => ({
  isNetworkFailure: (error: unknown) => String((error as Error)?.message).includes("Failed to fetch")
}));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  getCurrentBusinessId: () => "biz",
  getCurrentBranchId: () => "br",
  requireCurrentBusinessId: () => "biz"
}));
vi.mock("../../src/infrastructure/di/repositories/TableLocalRepository", () => ({
  TableLocalRepository: class {
    async findById() {
      return localTable.current;
    }
    async save() {}
  }
}));
vi.mock("../../src/infrastructure/di/repositories/PendingTableOperationRepository", async () => {
  const { InMemoryRepository } = await import("../fakes/InMemoryRepository");
  class PendingTableOperationRepository extends InMemoryRepository<any> {
    async findSyncable() {
      return (await this.findAll())
        .filter((op: any) => op.status === "PENDING_SYNC")
        .sort((a: any, b: any) => a.queuedAt.getTime() - b.queuedAt.getTime());
    }
    async clear() {
      await this.deleteMany((await this.findAll()).map((op: any) => op.id));
    }
  }
  return { PendingTableOperationRepository };
});

import { pendingTableOperationsStore } from "../../src/core/offline/pendingTableOperationsStore";
import { syncPendingTableOperations } from "../../src/core/offline/syncPendingTableOperations";

let clock = 0;
async function queue(
  tableId: string,
  type: "ADD_ITEM" | "CLOSE" | "REMOVE_ITEM" | "UPDATE_QUANTITY" = "ADD_ITEM",
  id = `op-${String(++clock).padStart(3, "0")}`
) {
  vi.setSystemTime(new Date(2026, 0, 1, 0, 0, clock));
  await pendingTableOperationsStore.enqueue({
    id,
    tableId,
    tableName: `Mesa ${tableId}`,
    type,
    ...(type === "ADD_ITEM" ? { addItemInput: { productId: "cola", quantity: 1 } } : {}),
    ...(type === "CLOSE" ? { closeInput: { method: "CASH" } as any } : {}),
    ...(type === "REMOVE_ITEM" ? { removeItemInput: { productId: "cola" } } : {}),
    ...(type === "UPDATE_QUANTITY" ? { updateQuantityInput: { productId: "cola", quantity: 2 } } : {})
  });
  return id;
}

const byId = async (id: string) => (await pendingTableOperationsStore.refresh(), pendingTableOperationsStore.list().find((op) => op.id === id));

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  clock = 0;
  Object.values(engine).forEach((fn) => fn.mockReset().mockResolvedValue(undefined));
  Object.values(toasts).forEach((fn) => fn.mockReset());
  await pendingTableOperationsStore.clear();
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  localTable.current = null;
  connection.online = true;
});

describe("Paso 3 — el sync manda la identidad de la operación", () => {
  it("ADD_ITEM / REMOVE_ITEM / UPDATE_QUANTITY reciben operationId = id de la cola", async () => {
    const add = await queue("t1", "ADD_ITEM");
    const remove = await queue("t1", "REMOVE_ITEM");
    const quantity = await queue("t1", "UPDATE_QUANTITY");

    await syncPendingTableOperations();

    expect(engine.addItem).toHaveBeenCalledWith(expect.objectContaining({ operationId: add, tableId: "t1" }));
    expect(engine.removeItem).toHaveBeenCalledWith("t1", "cola", undefined, expect.objectContaining({ operationId: remove }));
    expect(engine.updateItemQuantity).toHaveBeenCalledWith("t1", "cola", 2, undefined, expect.objectContaining({ operationId: quantity }));
    expect(pendingTableOperationsStore.count()).toBe(0);
  });

  it("la cuenta en la que se hizo la operación (openOperationId de la mesa al encolar) viaja como expectedSessionId", async () => {
    // enqueue toma la foto de la mesa local solo si hay IndexedDB.
    vi.stubGlobal("indexedDB", {});
    localTable.current = {
      id: "t1", name: "Mesa t1", capacity: 4, peopleCount: 2, status: "BUSY",
      openOperationId: "sesion-A", items: [], subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date()
    };
    const id = await queue("t1");
    expect((await byId(id))!.expectedBefore?.openOperationId).toBe("sesion-A");

    await syncPendingTableOperations();

    expect(engine.addItem).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: id, expectedSessionId: "sesion-A" })
    );
  });

  it("sin foto de la mesa no se inventa una cuenta esperada", async () => {
    await queue("t1");

    await syncPendingTableOperations();

    expect(engine.addItem.mock.calls[0][0].expectedSessionId).toBeUndefined();
  });
});

describe("Paso 4 — conflicto de significado: bloqueo por mesa", () => {
  it("la mesa en conflicto se bloquea; las operaciones de OTRAS mesas siguen sincronizando", async () => {
    const a1 = await queue("A");
    await queue("B");
    engine.addItem.mockImplementation(async (input: any) => {
      if (input.tableId === "A") throw new Error("TABLE_NOT_OPEN: la mesa ya no tiene una cuenta abierta");
    });

    await syncPendingTableOperations();

    const conflict = (await byId(a1))!;
    expect(conflict.status).toBe("CONFLICT");
    expect(conflict.conflict).toMatchObject({ code: "TABLE_NOT_OPEN" });
    // La mesa B se sincronizó y salió de la cola.
    expect(pendingTableOperationsStore.list().filter((op) => op.tableId === "B")).toHaveLength(0);
    expect(pendingTableOperationsStore.blockedTables().map((b) => b.tableId)).toEqual(["A"]);
  });

  it("las operaciones POSTERIORES de la misma mesa NO se ejecutan (orden por mesa) y quedan intactas", async () => {
    const a1 = await queue("A", "ADD_ITEM");
    const a2 = await queue("A", "UPDATE_QUANTITY");
    const a3 = await queue("A", "CLOSE");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));

    await syncPendingTableOperations();

    expect(engine.addItem).toHaveBeenCalledTimes(1);
    expect(engine.updateItemQuantity).not.toHaveBeenCalled();
    expect(engine.closeTable).not.toHaveBeenCalled();

    for (const id of [a2, a3]) {
      const held = (await byId(id))!;
      expect(held.status).toBe("PENDING_SYNC");
      expect(held.attempts).toBe(0);
    }
    expect((await byId(a1))!.attempts).toBe(1);
    expect(pendingTableOperationsStore.blockedTables()[0]).toMatchObject({ tableId: "A", heldOperations: 3 });
  });

  it("la operación en conflicto se CONSERVA completa para auditoría (no se borra ni se modifica su contenido)", async () => {
    const id = await queue("A");
    engine.addItem.mockRejectedValue(new Error("TABLE_SESSION_CHANGED: otra cuenta"));

    await syncPendingTableOperations();

    const op = (await byId(id))!;
    expect(op).toMatchObject({
      id,
      tableId: "A",
      type: "ADD_ITEM",
      addItemInput: { productId: "cola", quantity: 1 },
      status: "CONFLICT",
      lastError: "TABLE_SESSION_CHANGED: otra cuenta",
      conflict: { code: "TABLE_SESSION_CHANGED", detail: "TABLE_SESSION_CHANGED: otra cuenta" }
    });
  });

  it("al volver a sincronizar la mesa sigue bloqueada: no se llama al engine ni suben los intentos", async () => {
    await queue("A");
    const a2 = await queue("A", "UPDATE_QUANTITY");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));
    await syncPendingTableOperations();
    engine.addItem.mockClear();
    engine.updateItemQuantity.mockClear();

    await syncPendingTableOperations();
    await syncPendingTableOperations();

    expect(engine.addItem).not.toHaveBeenCalled();
    expect(engine.updateItemQuantity).not.toHaveBeenCalled();
    expect((await byId(a2))!.attempts).toBe(0);
  });

  it("el bloqueo sobrevive a un reinicio: se deriva de la cola persistida, no de memoria", async () => {
    await queue("A");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));
    await syncPendingTableOperations();

    expect((await pendingTableOperationsStore.loadBlockedTableIds()).has("A")).toBe(true);
    await pendingTableOperationsStore.refresh(); // = recargar la pantalla
    expect(pendingTableOperationsStore.blockedTables()).toHaveLength(1);
  });

  it("CLOSE contra una mesa ya cobrada (TABLE_ALREADY_CLOSED) es conflicto, no 'fallo permanente'", async () => {
    const id = await queue("A", "CLOSE");
    engine.closeTable.mockRejectedValue(new Error("TABLE_ALREADY_CLOSED"));

    await syncPendingTableOperations();

    expect((await byId(id))!.status).toBe("CONFLICT");
  });

  it("avisa con un toast que nombra la mesa y no cuenta el conflicto como 'fallo para revisión manual'", async () => {
    await queue("A");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));

    await syncPendingTableOperations();

    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error.mock.calls[0][0]).toContain("Mesa A");
    expect(toasts.error.mock.calls[0][0]).not.toMatch(/revisión manual/);
  });

  it("varias mesas con conflicto en la misma pasada: un solo toast con todas", async () => {
    await queue("A");
    await queue("B");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));

    await syncPendingTableOperations();

    expect(toasts.error).toHaveBeenCalledTimes(1);
    expect(toasts.error.mock.calls[0][0]).toMatch(/Mesas .*A.*B|Mesas .*B.*A/);
    expect(pendingTableOperationsStore.blockedTables()).toHaveLength(2);
  });
});

describe("Paso 4 — lo que NO es conflicto de significado conserva su manejo", () => {
  it("red caída: se reencola, no se bloquea la mesa y se corta la pasada", async () => {
    const a1 = await queue("A");
    await queue("B");
    engine.addItem.mockRejectedValue(new TypeError("Failed to fetch"));

    await syncPendingTableOperations();

    expect((await byId(a1))!.status).toBe("PENDING_SYNC");
    expect(pendingTableOperationsStore.blockedTables()).toEqual([]);
    expect(engine.addItem).toHaveBeenCalledTimes(1); // se cortó: B ni se intentó
  });

  it("error de validación: PERMANENT_FAILURE como antes y la mesa NO se bloquea", async () => {
    const a1 = await queue("A");
    engine.addItem.mockRejectedValue(new Error("VALIDATION_ERROR: cantidad inválida"));

    await syncPendingTableOperations();

    expect((await byId(a1))!.status).toBe("PERMANENT_FAILURE");
    expect(pendingTableOperationsStore.blockedTables()).toEqual([]);
  });

  it("error técnico desconocido: FAILED como antes", async () => {
    const a1 = await queue("A");
    engine.addItem.mockRejectedValue(new Error("SUPABASE_UPDATE_FAILED (tables): boom"));

    await syncPendingTableOperations();

    expect((await byId(a1))!.status).toBe("FAILED");
    expect(pendingTableOperationsStore.blockedTables()).toEqual([]);
  });
});

describe("Paso 4 — la cola no acepta más cambios en una mesa bloqueada", () => {
  it("enqueue en la mesa bloqueada falla con TABLE_BLOCKED_BY_CONFLICT; en otra mesa funciona", async () => {
    await queue("A");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));
    await syncPendingTableOperations();

    await expect(queue("A")).rejects.toThrow(/^TABLE_BLOCKED_BY_CONFLICT/);
    await expect(queue("B")).resolves.toBeDefined();
  });

  it("syncable() excluye las operaciones retenidas de la mesa bloqueada (no se dispara sync en bucle)", async () => {
    await queue("A");
    await queue("A", "UPDATE_QUANTITY");
    engine.addItem.mockRejectedValue(new Error("TABLE_NOT_OPEN"));

    await syncPendingTableOperations();

    const held = pendingTableOperationsStore.list().filter((op) => op.status === "PENDING_SYNC");
    expect(held).toHaveLength(1); // la UPDATE_QUANTITY sigue pendiente...
    expect(pendingTableOperationsStore.syncable()).toEqual([]); // ...pero no es sincronizable
  });
});

describe("el candado del sync no se queda trabado", () => {
  it("una pasada con la cola vacía no impide las siguientes (regresión: syncPromise quedaba ocupado)", async () => {
    await syncPendingTableOperations(); // cola vacía: sale temprano
    const id = await queue("A");

    await syncPendingTableOperations();

    expect(engine.addItem).toHaveBeenCalledTimes(1);
    expect(await byId(id)).toBeUndefined();
  });

  it("una pasada sin conexión tampoco traba la siguiente", async () => {
    const id = await queue("A");
    connection.online = false;
    await syncPendingTableOperations();
    expect(engine.addItem).not.toHaveBeenCalled();

    connection.online = true;
    await syncPendingTableOperations();

    expect(engine.addItem).toHaveBeenCalledTimes(1);
    expect(await byId(id)).toBeUndefined();
  });
});