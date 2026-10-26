// tests/unit/purchaseOperationId.test.ts
/* ===========================================================================
   Compras — el engine respeta la clave de idempotencia PERSISTENTE.

   Antes el operationId vivía solo en un Map en memoria del engine: al reiniciar
   el navegador se perdía y el reintento generaba otro id. Ahora la cola offline
   (PendingPurchase) guarda el id en IndexedDB y se lo pasa al engine, que debe
   mandarlo al servidor tal cual.
   =========================================================================== */

import { describe, expect, it } from "vitest";

import { PurchaseOrderEngine } from "../../src/core/engines/PurchaseOrderEngine";
import type { PurchaseOrder } from "../../src/core/entities/Entities";

function setup(order?: Partial<PurchaseOrder>) {
  const directCalls: any[] = [];
  const receiveCalls: any[] = [];

  const stored: PurchaseOrder = {
    id: "po-1",
    supplierId: "sup-1",
    status: "PENDIENTE",
    createdAt: new Date(),
    items: [{ productId: "harina", quantity: 10, unitPrice: 2500 }],
    ...order
  } as PurchaseOrder;

  const repo: any = {
    findById: async () => stored,
    findAll: async () => [stored],
    save: async () => undefined,
    update: async () => undefined,
    receive: async (params: any) => {
      receiveCalls.push(params);
      return { status: "COMPRADO", idempotent: false };
    },
    recordDirect: async (params: any) => {
      directCalls.push(params);
      return { status: "COMPRADO", idempotent: false, purchaseOrderId: "po-direct-1" };
    }
  };
  const inventory: any = { listAll: async () => [] };
  const recipes: any = { getProductionCapacity: () => null };

  return { engine: new PurchaseOrderEngine(repo, inventory, recipes), directCalls, receiveCalls };
}

const directInput = {
  supplierId: "sup-1",
  items: [{ productId: "harina", quantity: 30, unitPrice: 2500 }]
};

describe("Compras — operationId persistente", () => {
  it("compra directa: usa EXACTAMENTE el operationId recibido", async () => {
    const { engine, directCalls } = setup();
    await engine.recordDirectPurchase({ ...directInput, operationId: "op-guardado-en-indexeddb" });

    expect(directCalls).toHaveLength(1);
    expect(directCalls[0].operationId).toBe("op-guardado-en-indexeddb");
  });

  it("compra directa: el mismo operationId en dos llamadas manda el mismo id al servidor (reintento tras reinicio)", async () => {
    const { engine, directCalls } = setup();
    await engine.recordDirectPurchase({ ...directInput, operationId: "op-1" });
    await engine.recordDirectPurchase({ ...directInput, operationId: "op-1" });

    expect(directCalls.map((c) => c.operationId)).toEqual(["op-1", "op-1"]);
  });

  it("compra directa sin operationId: sigue generando uno y reusándolo en reintentos (comportamiento anterior)", async () => {
    const { engine, directCalls } = setup();
    await engine.recordDirectPurchase(directInput);
    expect(typeof directCalls[0].operationId).toBe("string");
    expect(directCalls[0].operationId.length).toBeGreaterThan(10);
  });

  it("recepción: usa EXACTAMENTE el operationId recibido y las líneas explícitas", async () => {
    const { engine, receiveCalls } = setup();
    await engine.markAsPurchased("po-1", "Camila", [{ productId: "harina", quantity: 10, unitPrice: 2500 }], "op-rec-1");

    expect(receiveCalls).toHaveLength(1);
    expect(receiveCalls[0]).toMatchObject({
      purchaseOrderId: "po-1",
      operationId: "op-rec-1",
      performedBy: "Camila",
      items: [{ productId: "harina", quantity: 10, unitPrice: 2500 }]
    });
  });

  it("recepción REINTENTADA sobre una orden que ya quedó COMPRADO: no se rechaza en el cliente, lo decide el servidor", async () => {
    // El primer intento sí llegó al servidor (la orden ya está COMPRADO) pero la
    // respuesta se perdió. El reintento con el MISMO id debe llegar al servidor,
    // que responde idempotente, en vez de fallar aquí con PURCHASE_ORDER_NOT_OPEN.
    const { engine, receiveCalls } = setup({ status: "COMPRADO" });
    await engine.markAsPurchased("po-1", undefined, [{ productId: "harina", quantity: 10, unitPrice: 2500 }], "op-rec-1");

    expect(receiveCalls).toHaveLength(1);
    expect(receiveCalls[0].operationId).toBe("op-rec-1");
  });

  it("recepción SIN operationId sobre una orden COMPRADO: se sigue rechazando en el cliente", async () => {
    const { engine, receiveCalls } = setup({ status: "COMPRADO" });
    await expect(engine.markAsPurchased("po-1")).rejects.toThrow("PURCHASE_ORDER_NOT_OPEN");
    expect(receiveCalls).toHaveLength(0);
  });
});