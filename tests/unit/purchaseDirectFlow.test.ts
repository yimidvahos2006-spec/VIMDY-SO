import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { PurchaseOrderEngine } from "../../src/core/engines/PurchaseOrderEngine";
import type { PurchaseOrder } from "../../src/core/entities/Entities";

type Stocks = Record<string, { stock: number; minStock: number; name: string }>;

function setup(opts: { failFirst?: boolean; withRecordDirect?: boolean; stocks?: Stocks } = {}) {
  const directCalls: any[] = [];
  const receiveCalls: any[] = [];
  let attempts = 0;
  let received = false;
  const stocks: Stocks = opts.stocks ?? {
    harina: { stock: 0, minStock: 5, name: "Harina" },
    azucar: { stock: 20, minStock: 5, name: "Azúcar" }
  };

  const repo: any = {
    findById: async () => null,
    findAll: async () => [],
    save: async () => undefined,
    update: async () => undefined,
    receive: async (params: any) => {
      receiveCalls.push(params);
      return { status: "COMPRADO", idempotent: false };
    }
  };
  if (opts.withRecordDirect !== false) {
    repo.recordDirect = async (params: any) => {
      attempts++;
      directCalls.push(params);
      if (opts.failFirst && attempts === 1) throw new Error("Failed to fetch");
      received = true;
      return { status: "COMPRADO", idempotent: false, purchaseOrderId: "po-direct-1" };
    };
  }
  const inventory: any = {
    listAll: async () =>
      Object.entries(stocks).map(([id, s]) => ({
        id,
        name: s.name,
        stock: received && id === "harina" ? 30 : s.stock,
        minStock: s.minStock
      }))
  };
  const recipes: any = { getProductionCapacity: () => null };
  return { engine: new PurchaseOrderEngine(repo, inventory, recipes), directCalls, receiveCalls };
}

const validInput = {
  supplierId: "sup-1",
  invoiceNumber: "  FE-100  ",
  note: "llegó completo",
  performedBy: "Camila",
  items: [
    { productId: "harina", quantity: 30, unitPrice: 2500 },
    { productId: "azucar", quantity: 10, unitPrice: 3200 }
  ]
};

describe("Compras flujo B - compra directa", () => {
  it("manda proveedor, factura y líneas al servidor, y NO usa la recepción de órdenes del cliente", async () => {
    const { engine, directCalls, receiveCalls } = setup();
    await engine.recordDirectPurchase(validInput);

    expect(receiveCalls).toHaveLength(0);
    expect(directCalls).toHaveLength(1);
    expect(directCalls[0]).toMatchObject({
      supplierId: "sup-1",
      invoiceNumber: "FE-100",
      note: "llegó completo",
      performedBy: "Camila",
      items: [
        { productId: "harina", quantity: 30, unitPrice: 2500 },
        { productId: "azucar", quantity: 10, unitPrice: 3200 }
      ]
    });
    expect(typeof directCalls[0].operationId).toBe("string");
  });

  it("calcula el mismo impacto que el flujo A: un producto agotado que se repone sale del riesgo", async () => {
    const { engine } = setup();
    const result = await engine.recordDirectPurchase(validInput);
    expect(result.stockoutResolved).toEqual(["Harina"]);
    expect(result.order.source).toBe("DIRECTA");
    expect(result.order.status).toBe("COMPRADO");
  });

  it.each([
    ["sin proveedor", { ...validInput, supplierId: "" }, "SUPPLIER_REQUIRED"],
    ["sin líneas", { ...validInput, items: [] }, "ITEMS_REQUIRED"],
    ["cantidad 0", { ...validInput, items: [{ productId: "harina", quantity: 0, unitPrice: 100 }] }, "PURCHASE_ITEM_INVALID"],
    ["precio 0", { ...validInput, items: [{ productId: "harina", quantity: 1, unitPrice: 0 }] }, "PURCHASE_UNIT_PRICE_REQUIRED"],
    [
      "producto repetido",
      {
        ...validInput,
        items: [
          { productId: "harina", quantity: 1, unitPrice: 100 },
          { productId: "harina", quantity: 2, unitPrice: 100 }
        ]
      },
      "PURCHASE_ITEM_DUPLICATED"
    ]
  ])("rechaza una compra %s antes de llamar al servidor", async (_label, input, code) => {
    const { engine, directCalls } = setup();
    await expect(engine.recordDirectPurchase(input as any)).rejects.toThrow(code);
    expect(directCalls).toHaveLength(0);
  });

  it("si falla la red y se reintenta el mismo documento, usa el MISMO identificador de operación", async () => {
    const { engine, directCalls } = setup({ failFirst: true });
    await expect(engine.recordDirectPurchase(validInput)).rejects.toThrow();
    await engine.recordDirectPurchase(validInput);
    expect(directCalls).toHaveLength(2);
    expect(directCalls[1].operationId).toBe(directCalls[0].operationId);
  });

  it("después de un éxito, un documento nuevo usa otro identificador", async () => {
    const { engine, directCalls } = setup();
    await engine.recordDirectPurchase(validInput);
    await engine.recordDirectPurchase(validInput);
    expect(directCalls[1].operationId).not.toBe(directCalls[0].operationId);
  });

  it("sin la función segura del servidor NO cae a un método inseguro", async () => {
    const { engine, receiveCalls } = setup({ withRecordDirect: false });
    await expect(engine.recordDirectPurchase(validInput)).rejects.toThrow("PURCHASE_RECORD_UNAVAILABLE");
    expect(receiveCalls).toHaveLength(0);
  });
});

describe("Compras flujo A/B - mismo motor transaccional en el servidor (contrato)", () => {
  const sql = readFileSync("supabase/migrations/20261114000000_direct_purchase_atomic.sql", "utf8")
    // Quita los comentarios para revisar solo el código ejecutable.
    .replace(/--.*$/gm, "");

  it("la compra directa delega en receive_purchase_order_atomic", () => {
    expect(sql).toMatch(/public\.receive_purchase_order_atomic\(/);
  });

  it("no reimplementa inventario: no mueve stock, kardex, precios ni auditoría por su cuenta", () => {
    expect(sql).not.toMatch(/adjust_stock_batch_with_kardex/);
    expect(sql).not.toMatch(/UPDATE\s+public\.products/i);
    expect(sql).not.toMatch(/INSERT\s+INTO\s+public\.(inventory_movements|audit_logs)/i);
  });

  it("no modifica la función del flujo A", () => {
    expect(sql).not.toMatch(/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+public\.receive_purchase_order_atomic/i);
  });

  it("crea la orden y la recibe dentro de la misma función (una sola transacción)", () => {
    const insertAt = sql.search(/INSERT\s+INTO\s+public\.purchase_orders/i);
    const receiveAt = sql.search(/public\.receive_purchase_order_atomic\(/);
    expect(insertAt).toBeGreaterThan(-1);
    expect(receiveAt).toBeGreaterThan(insertAt);
    expect(sql.match(/\bCOMMIT\b/g)).toHaveLength(1);
  });
});