// tests/unit/pendingPurchasesQueue.test.ts
/* ===========================================================================
   Cola offline DEDICADA de Compras (PendingPurchase).

   Se usan el store, el servicio submitPurchase y el sync REALES; solo se
   reemplazan los bordes: el repositorio IndexedDB (por uno en memoria), el
   engine de compras (spy), la conexión, los toasts y el catálogo.

   Lo que se garantiza:
     1. Sin internet la compra queda guardada con un id estable (clave de
        idempotencia) y NO se llama al servidor.
     2. Al volver internet se envía con ESE mismo id y sale de la cola.
     3. Un fallo de red conserva la compra y el MISMO id para el reintento.
     4. Un reinicio del navegador a mitad de un envío (SYNCING) se recupera y se
        reintenta con el mismo id.
     5. Doble clic / misma compra otra vez: no se duplica.
     6. Rechazo de negocio: no se reintenta; online se descarta, en la cola queda
        para revisión.
     7. Aislamiento: una compra de otro negocio/sucursal no se envía.
   =========================================================================== */

import { describe, it, expect, vi, beforeEach } from "vitest";

const engine = vi.hoisted(() => ({
  recordDirectPurchase: vi.fn(),
  markAsPurchased: vi.fn()
}));
const toasts = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() }));
const connection = vi.hoisted(() => ({ online: true }));
const tenant = vi.hoisted(() => ({ businessId: "biz", branchId: "br" }));

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: { purchaseOrderEngine: { get: () => engine } }
}));
vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: { isOnline: () => connection.online, subscribe: () => () => {} }
}));
vi.mock("../../src/core/store/toastStore", () => ({ toast: toasts }));
vi.mock("../../src/core/store/productCatalogStore", () => ({
  productCatalogStore: { refresh: vi.fn().mockResolvedValue(undefined) }
}));
vi.mock("../../src/core/VimdyCore", () => ({ vimdyCore: { emit: vi.fn() } }));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logError: vi.fn(),
  logWarning: vi.fn()
}));
vi.mock("../../src/core/services/offlineSale", () => ({
  isNetworkFailure: (error: unknown) => String((error as Error)?.message).includes("Failed to fetch")
}));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  getCurrentBusinessId: () => tenant.businessId,
  getCurrentBranchId: () => tenant.branchId,
  requireCurrentBusinessId: () => tenant.businessId
}));
vi.mock("../../src/infrastructure/di/repositories/PendingPurchaseRepository", async () => {
  const { InMemoryRepository } = await import("../fakes/InMemoryRepository");
  class PendingPurchaseRepository extends InMemoryRepository<any> {
    async findSyncable() {
      return (await this.findAll())
        .filter((p: any) => p.status === "PENDING_SYNC")
        .sort((a: any, b: any) => a.queuedAt.getTime() - b.queuedAt.getTime());
    }
    async clear() {
      await this.deleteMany((await this.findAll()).map((p: any) => p.id));
    }
  }
  return { PendingPurchaseRepository };
});

import { pendingPurchasesStore } from "../../src/core/offline/pendingPurchasesStore";
import {
  syncPendingPurchases,
  isPermanentPurchaseError,
  resetOfflinePurchaseSyncStateForTests
} from "../../src/core/offline/syncPendingPurchases";
import { submitPurchase } from "../../src/core/services/offlinePurchase";
import { buildPurchaseFingerprint } from "../../src/core/offline/PendingPurchase";

const COMPLETED_RESULT = { order: { id: "po-1", status: "COMPRADO" }, capacityImproved: [], stockoutResolved: [] };

const direct = (overrides: Record<string, unknown> = {}) => ({
  kind: "DIRECT" as const,
  supplierId: "sup-1",
  invoiceNumber: "FE-100",
  performedBy: "Camila",
  items: [
    { productId: "harina", quantity: 30, unitPrice: 2500 },
    { productId: "azucar", quantity: 10, unitPrice: 3200 }
  ],
  ...overrides
});

beforeEach(async () => {
  resetOfflinePurchaseSyncStateForTests();
  Object.values(engine).forEach((fn) => fn.mockReset().mockResolvedValue(COMPLETED_RESULT));
  Object.values(toasts).forEach((fn) => fn.mockReset());
  connection.online = true;
  tenant.businessId = "biz";
  tenant.branchId = "br";
  await pendingPurchasesStore.clear();
});

describe("Sin internet: la compra se guarda con su clave de idempotencia", () => {
  it("queda en la cola como PENDING_SYNC, con id estable, y NO llama al servidor", async () => {
    connection.online = false;

    const outcome = await submitPurchase(direct());

    expect(outcome.status).toBe("QUEUED");
    expect(engine.recordDirectPurchase).not.toHaveBeenCalled();

    const [saved] = pendingPurchasesStore.list();
    expect(saved).toMatchObject({
      id: (outcome as any).pendingId,
      kind: "DIRECT",
      status: "PENDING_SYNC",
      supplierId: "sup-1",
      invoiceNumber: "FE-100",
      businessId: "biz",
      branchId: "br",
      totalCost: 30 * 2500 + 10 * 3200
    });
    expect(saved.id).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("al volver internet se envía con ESE mismo id como operationId y sale de la cola", async () => {
    connection.online = false;
    const outcome = (await submitPurchase(direct())) as any;

    connection.online = true;
    await syncPendingPurchases();

    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(1);
    expect(engine.recordDirectPurchase).toHaveBeenCalledWith(
      expect.objectContaining({
        operationId: outcome.pendingId,
        supplierId: "sup-1",
        invoiceNumber: "FE-100",
        items: [
          { productId: "harina", quantity: 30, unitPrice: 2500 },
          { productId: "azucar", quantity: 10, unitPrice: 3200 }
        ]
      })
    );
    expect(pendingPurchasesStore.count()).toBe(0);
    expect(toasts.success).toHaveBeenCalledTimes(1);
  });

  it("una recepción de orden se envía con markAsPurchased(orden, quién, líneas, id)", async () => {
    connection.online = false;
    const outcome = (await submitPurchase({
      kind: "RECEIPT",
      purchaseOrderId: "po-1",
      performedBy: "Camila",
      items: [{ productId: "harina", quantity: 10, unitPrice: 2500 }]
    })) as any;

    connection.online = true;
    await syncPendingPurchases();

    expect(engine.markAsPurchased).toHaveBeenCalledWith(
      "po-1",
      "Camila",
      [{ productId: "harina", quantity: 10, unitPrice: 2500 }],
      outcome.pendingId
    );
    expect(pendingPurchasesStore.count()).toBe(0);
  });
});

describe("Con internet: el envío inmediato usa la misma cola", () => {
  it("confirmada: devuelve COMPLETED, usa el id guardado y no deja nada en la cola", async () => {
    const outcome = (await submitPurchase(direct())) as any;

    expect(outcome.status).toBe("COMPLETED");
    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(1);
    expect(engine.recordDirectPurchase.mock.calls[0][0].operationId).toBe(outcome.pendingId);
    expect(pendingPurchasesStore.count()).toBe(0);
  });

  it("fallo de red: queda en la cola y el reintento usa EL MISMO id (no genera otro)", async () => {
    engine.recordDirectPurchase.mockRejectedValueOnce(new Error("Failed to fetch"));

    const outcome = (await submitPurchase(direct())) as any;
    expect(outcome).toMatchObject({ status: "QUEUED", reason: "NETWORK_ERROR" });
    const firstId = engine.recordDirectPurchase.mock.calls[0][0].operationId;
    expect(firstId).toBe(outcome.pendingId);
    expect(pendingPurchasesStore.list()).toHaveLength(1);
    expect(pendingPurchasesStore.list()[0].status).toBe("PENDING_SYNC");

    await syncPendingPurchases();

    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(2);
    expect(engine.recordDirectPurchase.mock.calls[1][0].operationId).toBe(firstId);
    expect(pendingPurchasesStore.count()).toBe(0);
  });

  it("rechazo de negocio: relanza el error, NO deja la compra en la cola y no se reintenta", async () => {
    engine.recordDirectPurchase.mockRejectedValueOnce(new Error("PURCHASE_INVOICE_DUPLICATED"));

    await expect(submitPurchase(direct())).rejects.toThrow("PURCHASE_INVOICE_DUPLICATED");

    expect(pendingPurchasesStore.count()).toBe(0);
    await syncPendingPurchases();
    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(1);
  });
});

describe("Reinicio del navegador a mitad de un envío", () => {
  it("una compra que quedó en SYNCING se recupera y se reintenta con el mismo id", async () => {
    // Simula el cierre de la pestaña: la compra se guardó y se marcó SYNCING,
    // pero el proceso murió antes de recibir la respuesta.
    const pending = await pendingPurchasesStore.enqueue({
      id: "op-persistido",
      kind: "DIRECT",
      supplierId: "sup-1",
      invoiceNumber: "FE-100",
      items: [{ productId: "harina", quantity: 30, unitPrice: 2500 }],
      summary: "Compra directa · 1 producto",
      startSyncing: true
    });
    expect(pending.status).toBe("SYNCING");
    expect(pendingPurchasesStore.syncable()).toHaveLength(0);

    // "Navegador nuevo": arranca el ciclo de sincronización.
    await syncPendingPurchases();

    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(1);
    expect(engine.recordDirectPurchase.mock.calls[0][0].operationId).toBe("op-persistido");
    expect(pendingPurchasesStore.count()).toBe(0);
  });
});

describe("No duplicar la misma compra", () => {
  it("la misma compra registrada dos veces mientras sigue en cola reusa el mismo id: una sola entrada", async () => {
    connection.online = false;
    const first = (await submitPurchase(direct())) as any;
    const second = (await submitPurchase(direct())) as any;

    expect(first.status).toBe("QUEUED");
    expect(second).toMatchObject({ status: "ALREADY_QUEUED", pendingId: first.pendingId });
    expect(pendingPurchasesStore.count()).toBe(1);
  });

  it("doble clic simultáneo con internet: una sola llamada al servidor", async () => {
    let release: (value: unknown) => void = () => {};
    engine.recordDirectPurchase.mockImplementationOnce(
      () => new Promise((resolve) => { release = resolve; })
    );

    const a = submitPurchase(direct());
    const b = submitPurchase(direct());
    // Deja que ambas lleguen a su punto de espera antes de liberar al servidor.
    await new Promise((resolve) => setTimeout(resolve, 0));
    release(COMPLETED_RESULT);

    const outcomes = (await Promise.all([a, b])).map((o) => o.status).sort();
    expect(outcomes).toEqual(["ALREADY_QUEUED", "COMPLETED"]);
    expect(engine.recordDirectPurchase).toHaveBeenCalledTimes(1);
    expect(pendingPurchasesStore.count()).toBe(0);
  });

  it("compras distintas NO se confunden (otra factura = otra entrada)", async () => {
    connection.online = false;
    await submitPurchase(direct({ invoiceNumber: "FE-100" }));
    await submitPurchase(direct({ invoiceNumber: "FE-101" }));
    expect(pendingPurchasesStore.count()).toBe(2);
  });

  it("la huella ignora el orden de las líneas y mayúsculas de la factura", () => {
    const a = buildPurchaseFingerprint(direct());
    const b = buildPurchaseFingerprint(
      direct({
        invoiceNumber: " fe-100 ",
        items: [
          { productId: "azucar", quantity: 10, unitPrice: 3200 },
          { productId: "harina", quantity: 30, unitPrice: 2500 }
        ]
      })
    );
    expect(a).toBe(b);
  });
});

describe("Errores y aislamiento", () => {
  it("rechazo de negocio durante la sincronización: queda PERMANENT_FAILURE con el motivo, no se reintenta y las demás siguen", async () => {
    connection.online = false;
    const bad = (await submitPurchase(direct({ invoiceNumber: "FE-1" }))) as any;
    const good = (await submitPurchase(direct({ invoiceNumber: "FE-2" }))) as any;

    engine.recordDirectPurchase.mockImplementation(async (input: any) => {
      if (input.operationId === bad.pendingId) throw new Error("PURCHASE_INVOICE_DUPLICATED");
      return COMPLETED_RESULT;
    });

    connection.online = true;
    await syncPendingPurchases();

    const remaining = pendingPurchasesStore.list();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({
      id: bad.pendingId,
      status: "PERMANENT_FAILURE",
      lastError: "PURCHASE_INVOICE_DUPLICATED"
    });
    expect(engine.recordDirectPurchase.mock.calls.map((c) => c[0].operationId)).toContain(good.pendingId);
    expect(toasts.error).toHaveBeenCalledTimes(1);

    // Un segundo ciclo no la vuelve a enviar.
    engine.recordDirectPurchase.mockClear();
    await syncPendingPurchases();
    expect(engine.recordDirectPurchase).not.toHaveBeenCalled();
  });

  it("una compra de otro negocio/sucursal no se envía (CONTEXT_MISMATCH)", async () => {
    connection.online = false;
    await submitPurchase(direct());

    tenant.businessId = "otro-negocio";
    connection.online = true;
    await syncPendingPurchases();

    expect(engine.recordDirectPurchase).not.toHaveBeenCalled();
    expect(pendingPurchasesStore.list()[0]).toMatchObject({ status: "PERMANENT_FAILURE" });
    expect(pendingPurchasesStore.list()[0].lastError).toContain("CONTEXT_MISMATCH");
  });

  it("agotados los intentos pasa a PERMANENT_FAILURE en vez de reintentar para siempre", async () => {
    await pendingPurchasesStore.enqueue({
      id: "op-agotada",
      kind: "DIRECT",
      supplierId: "sup-1",
      items: [{ productId: "harina", quantity: 1, unitPrice: 100 }],
      summary: "x"
    });
    for (let i = 0; i < 5; i += 1) await pendingPurchasesStore.markSyncing("op-agotada");
    await pendingPurchasesStore.requeue("op-agotada");

    await syncPendingPurchases();

    expect(engine.recordDirectPurchase).not.toHaveBeenCalled();
    expect(pendingPurchasesStore.list()[0]).toMatchObject({
      status: "PERMANENT_FAILURE",
      lastError: "MAX_ATTEMPTS_REACHED"
    });
  });

  it("clasifica bien los errores: negocio = permanente, red/desconocido = se reintenta", () => {
    for (const message of [
      "PURCHASE_INVOICE_DUPLICATED",
      "PURCHASE_RECEIVE_FORBIDDEN",
      "PURCHASE_ORDER_NOT_OPEN: la orden ya está en estado COMPRADO.",
      "SUPPLIER_REQUIRED",
      "ITEMS_REQUIRED",
      "IDEMPOTENCY_KEY_REUSED",
      "NO_BUSINESS_CONTEXT: no hay una empresa o sucursal activa."
    ]) {
      expect(isPermanentPurchaseError(new Error(message)), message).toBe(true);
    }
    for (const message of ["Failed to fetch", "Network request failed", "algo raro"]) {
      expect(isPermanentPurchaseError(new Error(message)), message).toBe(false);
    }
  });
});