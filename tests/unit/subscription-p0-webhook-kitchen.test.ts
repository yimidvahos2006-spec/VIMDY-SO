import { describe, it, expect, vi, beforeEach } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";

const WOMBI_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "wompi-webhook", "index.ts"),
  "utf-8"
);
const MERCADOPAGO_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "mercadopago-webhook", "index.ts"),
  "utf-8"
);
const PAYPAL_WEBHOOK = readFileSync(
  join(process.cwd(), "supabase", "functions", "paypal-webhook", "index.ts"),
  "utf-8"
);

const mockSalesEngine = {
  createSale: vi.fn(),
  sendToKitchen: vi.fn(),
  registerPayment: vi.fn()
};

const mockKitchenEngine = {
  getById: vi.fn()
};

describe("P0 — Webhooks: sin referencias a businesses.payment_status", () => {
  it("wompi-webhook no actualiza businesses.payment_status", () => {
    expect(WOMBI_WEBHOOK).not.toMatch(/\.from\("businesses"\)\.update\(\{\s*payment_status/);
  });

  it("mercadopago-webhook no actualiza businesses.payment_status", () => {
    expect(MERCADOPAGO_WEBHOOK).not.toMatch(/\.from\("businesses"\)\.update\(\{\s*payment_status/);
  });

  it("paypal-webhook no actualiza businesses.payment_status", () => {
    expect(PAYPAL_WEBHOOK).not.toMatch(/\.from\("businesses"\)\.update\(\{\s*payment_status/);
  });
});

describe("P1 — Venta → Cocina: recuperación por sync", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    vi.doMock("../../src/infrastructure/supabase/supabaseClient", () => ({
      getCurrentBusinessId: vi.fn(() => "b1"),
      getCurrentBranchId: vi.fn(() => "br1")
    }));
    vi.doMock("../../src/infrastructure/di/CompositionRoot", () => ({
      container: {
        salesEngine: { get: () => mockSalesEngine },
        kitchenEngine: { get: () => mockKitchenEngine }
      }
    }));
  });

  it("syncPendingSales re-encola comanda de cocina si la venta ya existe", async () => {
    vi.resetModules();
    mockSalesEngine.createSale.mockResolvedValue({ id: "sale-1", type: "QUICK" });
    mockKitchenEngine.getById.mockResolvedValue(null);
    mockSalesEngine.sendToKitchen.mockResolvedValue({ id: "sale-1", status: "PENDIENTE" });

    const { syncOne } = await import("../../src/core/offline/syncPendingSales");

    const pending = {
      id: "pending-1",
      businessId: "b1",
      branchId: "br1",
      createSaleInput: {
        id: "sale-1",
        type: "QUICK" as const,
        items: [],
        skipKitchen: false
      },
      payment: null
    };

    await syncOne(pending as any);

    expect(mockSalesEngine.createSale).toHaveBeenCalledWith(pending.createSaleInput);
    expect(mockKitchenEngine.getById).toHaveBeenCalledWith("sale-1");
    expect(mockSalesEngine.sendToKitchen).toHaveBeenCalledWith({ id: "sale-1", type: "QUICK" });
  });

  it("syncPendingSales no duplica comanda si ya existe", async () => {
    vi.resetModules();
    mockSalesEngine.createSale.mockResolvedValue({ id: "sale-2", type: "QUICK" });
    mockKitchenEngine.getById.mockResolvedValue({ id: "sale-2", status: "PENDIENTE" });

    const { syncOne } = await import("../../src/core/offline/syncPendingSales");

    const pending = {
      id: "pending-2",
      businessId: "b1",
      branchId: "br1",
      createSaleInput: {
        id: "sale-2",
        type: "QUICK" as const,
        items: [],
        skipKitchen: false
      },
      payment: null
    };

    await syncOne(pending as any);

    expect(mockSalesEngine.createSale).toHaveBeenCalledWith(pending.createSaleInput);
    expect(mockKitchenEngine.getById).toHaveBeenCalledWith("sale-2");
    expect(mockSalesEngine.sendToKitchen).not.toHaveBeenCalled();
  });
});
