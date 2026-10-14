import { describe, expect, it } from "vitest";
import { PurchaseOrderEngine, remainingQuantity } from "../../src/core/engines/PurchaseOrderEngine";
import type { PurchaseOrder } from "../../src/core/entities/Entities";

function baseOrder(overrides: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: "po-1",
    supplierId: "sup-1",
    status: "PENDIENTE",
    createdAt: new Date("2026-10-12T10:00:00Z"),
    items: [
      { productId: "gaseosa", quantity: 20, unitPrice: 2000 },
      { productId: "agua", quantity: 10, unitPrice: 1500 }
    ],
    ...overrides
  };
}

function setup(order: PurchaseOrder, opts: { failFirst?: boolean; withReceive?: boolean } = {}) {
  const calls: Array<{ operationId: string; items?: readonly { productId: string; quantity: number }[] }> = [];
  let attempts = 0;
  const repo: any = {
    findById: async () => order,
    findAll: async () => [order],
    save: async () => undefined,
    update: async () => undefined
  };
  if (opts.withReceive !== false) {
    repo.receive = async (params: any) => {
      attempts++;
      calls.push({ operationId: params.operationId, items: params.items });
      if (opts.failFirst && attempts === 1) throw new Error("Failed to fetch");
      return { status: "PARCIAL", idempotent: false };
    };
  }
  const inventory: any = { listAll: async () => [] };
  const recipes: any = { getProductionCapacity: () => null };
  return { engine: new PurchaseOrderEngine(repo, inventory, recipes), calls };
}

describe("PurchaseOrderEngine - recibir mercancía", () => {
  it("sin cantidades recibe todo lo que falta", async () => {
    const { engine, calls } = setup(baseOrder());
    await engine.markAsPurchased("po-1");
    expect(calls[0].items).toEqual([
      { productId: "gaseosa", quantity: 20, unitPrice: 2000 },
      { productId: "agua", quantity: 10, unitPrice: 1500 }
    ]);
  });

  it("con una recepción parcial manda solo lo que llegó", async () => {
    const { engine, calls } = setup(baseOrder());
    await engine.markAsPurchased("po-1", undefined, [{ productId: "gaseosa", quantity: 12, unitPrice: 2000 }]);
    expect(calls[0].items).toEqual([{ productId: "gaseosa", quantity: 12, unitPrice: 2000 }]);
  });

  it("en una orden PARCIAL lo pendiente es pedido menos recibido", async () => {
    const order = baseOrder({ status: "PARCIAL", receivedQuantities: { gaseosa: 12 } });
    expect(remainingQuantity(order, order.items[0])).toBe(8);
    expect(remainingQuantity(order, order.items[1])).toBe(10);
    const { engine, calls } = setup(order);
    await engine.markAsPurchased("po-1");
    expect(calls[0].items?.map((i) => [i.productId, i.quantity])).toEqual([
      ["gaseosa", 8],
      ["agua", 10]
    ]);
  });

  it("si falla la red y se reintenta igual, se usa el MISMO identificador de operación", async () => {
    const { engine, calls } = setup(baseOrder(), { failFirst: true });
    await expect(engine.markAsPurchased("po-1")).rejects.toThrow();
    await engine.markAsPurchased("po-1");
    expect(calls).toHaveLength(2);
    expect(calls[1].operationId).toBe(calls[0].operationId);
  });

  it("después de un éxito, una recepción nueva usa otro identificador", async () => {
    const { engine, calls } = setup(baseOrder());
    await engine.markAsPurchased("po-1");
    await engine.markAsPurchased("po-1");
    expect(calls[1].operationId).not.toBe(calls[0].operationId);
  });

  it("no recibe una orden ya cerrada ni cancelada", async () => {
    for (const status of ["COMPRADO", "CANCELADO"] as const) {
      const { engine, calls } = setup(baseOrder({ status }));
      await expect(engine.markAsPurchased("po-1")).rejects.toThrow("PURCHASE_ORDER_NOT_OPEN");
      expect(calls).toHaveLength(0);
    }
  });

  it("no recibe si ya no queda nada pendiente", async () => {
    const order = baseOrder({ status: "PARCIAL", receivedQuantities: { gaseosa: 20, agua: 10 } });
    const { engine, calls } = setup(order);
    await expect(engine.markAsPurchased("po-1")).rejects.toThrow("PURCHASE_ITEMS_INVALID");
    expect(calls).toHaveLength(0);
  });

  it("sin la función segura del servidor NO cae al método inseguro", async () => {
    const { engine } = setup(baseOrder(), { withReceive: false });
    await expect(engine.markAsPurchased("po-1")).rejects.toThrow("PURCHASE_RECEIVE_UNAVAILABLE");
  });

  it("una orden PARCIAL cuenta como abierta: no se puede crear otra con el mismo producto", async () => {
    const { engine } = setup(baseOrder({ status: "PARCIAL", receivedQuantities: { gaseosa: 12 } }));
    await expect(
      engine.create({ supplierId: "sup-1", items: [{ productId: "gaseosa", quantity: 5, unitPrice: 2000 }] })
    ).rejects.toThrow("DUPLICATE_PURCHASE");
  });
});