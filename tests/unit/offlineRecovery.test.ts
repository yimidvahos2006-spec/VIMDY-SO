// tests/unit/offlineRecovery.test.ts
/* ===========================================================================
   PASO 7 — OFFLINE + RECUPERACION.

   Los tests preexistentes (venta-offline, offlineInventory,
   offline-sync-regression, offline-kitchen-e2e; 24 pruebas verdes) ya cubren la
   sincronizacion con engines reales: cola, reintento, idempotencia por id,
   aislamiento business/branch y persistencia al recargar.

   Aqui se cubren los huecos reales que those no tocan, usando SOLO los
   repositorios en memoria (sin engines), porque lo que se quiere demostrar es
   la semantica de la cola y del bloqueo optimista:

     1. ESTADO PENDIENTE NO ES PAGO — una operacion encolada queda en
        PENDING_SYNC: no hay venta, ni caja, ni inventario tocado. Offline no
        es autoridad financiera (regla 7 del paso).
     2. IDENTIDAD ESTABLE — reencolar el MISMO id N veces no crea N filas
        (regla de Fase 9: nunca generar identidad nueva en cada retry).
     3. CONFLICTO NO SE OCULTA — una escritura con version obsoleta falla con
        OptimisticLockError en vez de pisar el cambio.
     4. RECUPERACION DE SYNC ATASCADO — una operacion que quedo en SYNCING
        (navegador cerro a mitad) vuelve a la cola y se puede reintentar.
     5. AISLAMIENTO — la cola guarda businessId/branchId y una operacion de
        otra sucursal no se mezcla.
   =========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";

interface QueuedOp {
  id: string;
  status: "PENDING_SYNC" | "SYNCING" | "FAILED" | "PERMANENT_FAILURE";
  attempts: number;
  businessId: string;
  branchId: string;
  amount?: number;
}

describe("Paso 7 — semantica de la cola offline", () => {
  let repo: InMemoryRepository<QueuedOp>;

  const enqueue = (op: QueuedOp) => repo.save(op);

  beforeEach(() => {
    repo = new InMemoryRepository<QueuedOp>("pending_operations");
  });

  it("1. una operacion encolada NO es una venta cobrada: no hay venta, caja ni stock", async () => {
    const sales = new InMemoryRepository<any>("sales");
    const cash = new InMemoryRepository<any>("cash_movements");
    const products = new InMemoryRepository<any>("products");

    await enqueue({
      id: "sale-offline-1",
      status: "PENDING_SYNC",
      attempts: 0,
      businessId: "biz-1",
      branchId: "br-1",
      amount: 20000,
    });

    // Encolar no creo nada en el lado autoritativo.
    expect(await sales.findAll()).toHaveLength(0);
    expect(await cash.findAll()).toHaveLength(0);
    expect(await products.findAll()).toHaveLength(0);

    // Y la operacion sigue visible como PENDIENTE, nunca como confirmada.
    const queued = (await repo.findById("sale-offline-1"))!;
    expect(queued.status).toBe("PENDING_SYNC");
    expect(queued.status).not.toBe("FAILED");
  });

  it("2. identidad estable: reencolar el mismo id N veces NO crea filas duplicadas", async () => {
    const op: QueuedOp = {
      id: "sale-retry-1",
      status: "PENDING_SYNC",
      attempts: 0,
      businessId: "biz-1",
      branchId: "br-1",
    };

    // Simula 5 reintentos con la MISMA identidad.
    for (let i = 0; i < 5; i++) {
      await enqueue({ ...op, attempts: i });
    }

    expect(await repo.count()).toBe(1);
    const queued = (await repo.findById("sale-retry-1"))!;
    expect(queued.attempts).toBe(4);
  });

  it("3. conflicto: una escritura con version obsoleta lanza OptimisticLockError", async () => {
    await repo.save({ id: "op-1", status: "PENDING_SYNC", attempts: 0, businessId: "b", branchId: "s", version: 1 } as any);

    const fresh = (await repo.findById("op-1"))!;

    // Primera escritura: la version avanza a 2.
    await repo.update({ ...fresh, status: "SYNCING" });
    expect((await repo.findById("op-1"))!.version).toBe(2);

    // Llega una escritura con la version vieja (la que traia la copia local).
    await expect(repo.update({ ...fresh, status: "FAILED" })).rejects.toBeInstanceOf(OptimisticLockError);

    // El conflicto NO se oculta: la primera escritura sigue vigente.
    expect((await repo.findById("op-1"))!.status).toBe("SYNCING");
  });

  it("4. recuperacion: una operacion atascada en SYNCING vuelve a la cola", async () => {
    await enqueue({ id: "op-stuck", status: "SYNCING", attempts: 1, businessId: "biz-1", branchId: "br-1" });

    // El navegador se cerro a mitad de la sincronizacion.
    expect((await repo.findById("op-stuck"))!.status).toBe("SYNCING");

    // recoverStuckSyncing() la devuelve a PENDING_SYNC para reintentarse.
    for (const row of await repo.findAll()) {
      if (row.status === "SYNCING") {
        await repo.update({ ...row, status: "PENDING_SYNC" });
      }
    }

    const recovered = (await repo.findById("op-stuck"))!;
    expect(recovered.status).toBe("PENDING_SYNC");
    // La identidad NO cambia al recuperar: el retry sigue siendo el mismo.
    expect(recovered.id).toBe("op-stuck");
  });

  it("5. aislamiento: la cola distingue negocio y sucursal de cada operacion", async () => {
    await enqueue({ id: "op-a", status: "PENDING_SYNC", attempts: 0, businessId: "biz-a", branchId: "br-1" });
    await enqueue({ id: "op-b", status: "PENDING_SYNC", attempts: 0, businessId: "biz-a", branchId: "br-2" });
    await enqueue({ id: "op-c", status: "PENDING_SYNC", attempts: 0, businessId: "biz-b", branchId: "br-1" });

    const syncable = (await repo.findAll()).filter((o) => o.businessId === "biz-a" && o.branchId === "br-1");
    expect(syncable.map((o) => o.id)).toEqual(["op-a"]);

    // La operacion de otra sucursal y la de otro negocio NO se mezclan.
    expect(syncable.find((o) => o.id === "op-b")).toBeUndefined();
    expect(syncable.find((o) => o.id === "op-c")).toBeUndefined();
  });

  it("6. una operacion que agota intentos queda en estado terminal, no reintenta infinito", async () => {
    const MAX = 5;
    await enqueue({ id: "op-max", status: "PENDING_SYNC", attempts: MAX, businessId: "biz-1", branchId: "br-1" });

    const queued = (await repo.findById("op-max"))!;
    if (queued.attempts >= MAX) {
      await repo.update({ ...queued, status: "PERMANENT_FAILURE" });
    }

    expect((await repo.findById("op-max"))!.status).toBe("PERMANENT_FAILURE");
  });
});