import { describe, expect, it, vi } from "vitest";

import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { PurchaseOrderEngine } from "../../src/core/engines/PurchaseOrderEngine";
import { buildPurchaseFingerprint } from "../../src/core/offline/PendingPurchase";
import {
  checkExpiryInput,
  isIsoDateString,
  parseIsoDateString
} from "../../src/core/utils/isoDate";
import type { IsoDateString } from "../../src/core/entities/Entities";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

const TODAY = "2026-10-29" as IsoDateString;
const FUTURE = "2026-12-01" as IsoDateString;

describe("isoDate — validación de vencimientos", () => {
  it("acepta fechas reales y rechaza formatos o días inexistentes", () => {
    expect(isIsoDateString("2026-12-01")).toBe(true);
    expect(isIsoDateString("2028-02-29")).toBe(true);
    expect(isIsoDateString("2026-02-31")).toBe(false);
    expect(isIsoDateString("2026-2-3")).toBe(false);
    expect(isIsoDateString("2026-12-01T00:00:00Z")).toBe(false);
    expect(isIsoDateString(null)).toBe(false);
  });

  it("parseIsoDateString devuelve undefined si está vacío o es inválido", () => {
    expect(parseIsoDateString("  2026-12-01 ")).toBe("2026-12-01");
    expect(parseIsoDateString("")).toBeUndefined();
    expect(parseIsoDateString("ayer")).toBeUndefined();
  });

  it("checkExpiryInput: vacío es válido salvo que sea obligatorio", () => {
    expect(checkExpiryInput("", { today: TODAY })).toEqual({ ok: true, value: undefined });
    const required = checkExpiryInput("  ", { today: TODAY, required: true });
    expect(required.ok).toBe(false);
  });

  it("checkExpiryInput: hoy y futuro pasan; pasado, inválido y > 20 años no", () => {
    expect(checkExpiryInput(TODAY, { today: TODAY })).toEqual({ ok: true, value: TODAY });
    expect(checkExpiryInput(FUTURE, { today: TODAY })).toEqual({ ok: true, value: FUTURE });
    expect(checkExpiryInput("2026-10-28", { today: TODAY }).ok).toBe(false);
    expect(checkExpiryInput("2026-02-31", { today: TODAY }).ok).toBe(false);
    expect(checkExpiryInput("2046-10-29", { today: TODAY }).ok).toBe(true);
    expect(checkExpiryInput("2046-10-30", { today: TODAY }).ok).toBe(false);
  });
});

describe("huella de compras pendientes", () => {
  const base = {
    kind: "DIRECT" as const,
    supplierId: "sup-1",
    invoiceNumber: "FE-1"
  };
  const line = { productId: "leche", quantity: 10, unitPrice: 3000 };

  it("sin vencimiento conserva la huella de siempre (compras ya encoladas no se duplican)", () => {
    const withoutKey = buildPurchaseFingerprint({ ...base, items: [line] });
    expect(withoutKey).toContain(`[["leche",10,3000]]`);
  });

  it("el mismo documento con otra fecha de vencimiento es otra compra", () => {
    const a = buildPurchaseFingerprint({ ...base, items: [{ ...line, expiresAt: FUTURE }] });
    const b = buildPurchaseFingerprint({
      ...base,
      items: [{ ...line, expiresAt: "2026-12-15" as IsoDateString }]
    });
    const none = buildPurchaseFingerprint({ ...base, items: [line] });
    expect(a).not.toBe(b);
    expect(a).not.toBe(none);
  });
});

function purchaseSetup() {
  const directCalls: any[] = [];
  const receiveCalls: any[] = [];
  const repo: any = {
    findById: async () => null,
    findAll: async () => [],
    save: async () => undefined,
    update: async () => undefined,
    receive: async (params: any) => {
      receiveCalls.push(params);
      return { status: "COMPRADO", idempotent: false };
    },
    recordDirect: async (params: any) => {
      directCalls.push(params);
      return { status: "COMPRADO", idempotent: false, purchaseOrderId: "po-1" };
    }
  };
  const inventory: any = { listAll: async () => [] };
  const recipes: any = { getProductionCapacity: () => null };
  return { engine: new PurchaseOrderEngine(repo, inventory, recipes), directCalls, receiveCalls };
}

describe("compra directa — el vencimiento viaja al servidor", () => {
  it("manda expiresAt solo en las líneas que lo traen", async () => {
    const { engine, directCalls } = purchaseSetup();
    await engine.recordDirectPurchase({
      supplierId: "sup-1",
      items: [
        { productId: "leche", quantity: 10, unitPrice: 3000, expiresAt: FUTURE },
        { productId: "sal", quantity: 2, unitPrice: 1000 }
      ]
    });

    expect(directCalls).toHaveLength(1);
    expect(directCalls[0].items[0]).toEqual({
      productId: "leche",
      quantity: 10,
      unitPrice: 3000,
      expiresAt: FUTURE
    });
    expect(directCalls[0].items[1]).not.toHaveProperty("expiresAt");
  });

  it("rechaza una fecha mal formada antes de tocar el servidor", async () => {
    const { engine, directCalls } = purchaseSetup();
    await expect(
      engine.recordDirectPurchase({
        supplierId: "sup-1",
        items: [{ productId: "leche", quantity: 1, unitPrice: 3000, expiresAt: "2026-02-31" as IsoDateString }]
      })
    ).rejects.toThrow("INVALID_EXPIRES_AT");
    expect(directCalls).toHaveLength(0);
  });
});

describe("recepción de orden — el vencimiento viaja al servidor", () => {
  it("manda expiresAt por línea recibida", async () => {
    const { engine, receiveCalls } = purchaseSetup();
    (engine as any).repository.findById = async () => ({
      id: "po-9",
      supplierId: "sup-1",
      status: "PENDIENTE",
      createdAt: new Date(),
      items: [{ productId: "leche", quantity: 10, unitPrice: 3000 }]
    });

    await engine.markAsPurchased("po-9", "Camila", [
      { productId: "leche", quantity: 10, unitPrice: 3000, expiresAt: FUTURE }
    ]);

    expect(receiveCalls).toHaveLength(1);
    expect(receiveCalls[0].items).toEqual([
      { productId: "leche", quantity: 10, unitPrice: 3000, expiresAt: FUTURE }
    ]);
  });
});

describe("reposición (Sumar stock) con vencimiento", () => {
  async function inventorySetup() {
    const repository = new FakeProductRepository();
    const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
    const adjustStockBatchWithKardex = vi.fn(async () => []);
    const adjustStockWithKardex = vi.fn(async () => ({}) as any);
    repository.adjustStockBatchWithKardex = adjustStockBatchWithKardex;
    repository.adjustStockWithKardex = adjustStockWithKardex;
    const engine = new InventoryEngine(repository, kardex);
    const milk = await engine.createProduct({ name: "Leche", stock: 1, trackStock: true });
    // createProduct con stock inicial ya registra su propio movimiento: se parte de cero.
    adjustStockBatchWithKardex.mockClear();
    adjustStockWithKardex.mockClear();
    return { engine, milk, adjustStockBatchWithKardex, adjustStockWithKardex };
  }

  it("con fecha usa el RPC por lote (el único que guarda expiresAt) con el mismo id de operación", async () => {
    const { engine, milk, adjustStockBatchWithKardex, adjustStockWithKardex } = await inventorySetup();

    await engine.increaseStock(milk.id, 5, "Reabastecimiento", undefined, undefined, undefined, "mov-1", undefined, FUTURE);

    expect(adjustStockWithKardex).not.toHaveBeenCalled();
    expect(adjustStockBatchWithKardex).toHaveBeenCalledTimes(1);
    const [operationId, movements] = adjustStockBatchWithKardex.mock.calls[0] as unknown as [
      string,
      Array<Record<string, unknown>>
    ];
    expect(operationId).toBe("mov-1");
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      productId: milk.id,
      delta: 5,
      type: "INCREASE",
      expiresAt: FUTURE
    });
    expect(Object.keys(movements[0]!.extraFields as object)).toEqual(["lastUpdated"]);
  });

  it("sin fecha todo sigue igual: RPC de un movimiento, sin tocar el lote", async () => {
    const { engine, milk, adjustStockBatchWithKardex, adjustStockWithKardex } = await inventorySetup();

    await engine.increaseStock(milk.id, 5, "Reabastecimiento");

    expect(adjustStockBatchWithKardex).not.toHaveBeenCalled();
    expect(adjustStockWithKardex).toHaveBeenCalledTimes(1);
  });

  it("con costo o proveedor rechaza la fecha en voz alta en vez de perderla", async () => {
    const { engine, milk, adjustStockBatchWithKardex, adjustStockWithKardex } = await inventorySetup();

    await expect(
      engine.increaseStock(milk.id, 5, "Compra", undefined, undefined, 2500, "mov-2", undefined, FUTURE)
    ).rejects.toThrow("EXPIRES_AT_UNSUPPORTED_WITH_COST");
    expect(adjustStockBatchWithKardex).not.toHaveBeenCalled();
    expect(adjustStockWithKardex).not.toHaveBeenCalled();
  });

  it("rechaza una fecha mal formada", async () => {
    const { engine, milk, adjustStockBatchWithKardex } = await inventorySetup();

    await expect(
      engine.increaseStock(milk.id, 5, "Reabastecimiento", undefined, undefined, undefined, "mov-3", undefined, "2026-02-31" as IsoDateString)
    ).rejects.toThrow("INVALID_EXPIRES_AT");
    expect(adjustStockBatchWithKardex).not.toHaveBeenCalled();
  });
});