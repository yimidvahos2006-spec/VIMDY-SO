import { describe, it, expect, vi, beforeEach } from "vitest";

const m = vi.hoisted(() => ({
  registerPayment: vi.fn(),
  generateReceipt: vi.fn(),
  printReceiptIfEnabled: vi.fn(),
  syncDashboardAfterSale: vi.fn(),
  toastWarning: vi.fn(),
  toastError: vi.fn(),
  cartClear: vi.fn(),
  paymentReset: vi.fn(),
  paymentState: {} as any
}));

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: {
    salesEngine: {
      get: () => ({
        registerPayment: m.registerPayment,
        generateReceipt: m.generateReceipt
      })
    }
  }
}));
vi.mock("../../src/core/services/checkout", () => ({
  assertShiftOpen: vi.fn(),
  assertSubscriptionActive: vi.fn(),
  printReceiptIfEnabled: m.printReceiptIfEnabled,
  syncDashboardAfterSale: m.syncDashboardAfterSale
}));
vi.mock("../../src/core/store/toastStore", () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    warning: m.toastWarning,
    error: m.toastError
  }
}));
vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: { isOnline: () => true }
}));
vi.mock("../../src/core/offline/pendingSalesStore", () => ({
  pendingSalesStore: { list: () => [], enqueue: vi.fn() }
}));
vi.mock("../../src/core/store/cartStore", () => ({
  cartStore: { getItems: () => [], clear: m.cartClear }
}));
vi.mock("../../src/core/store/paymentStore", () => ({
  paymentStore: { get: () => m.paymentState, reset: m.paymentReset }
}));
vi.mock("../../src/core/store/productCatalogStore", () => ({
  productCatalogStore: { refresh: () => Promise.resolve() }
}));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logError: vi.fn()
}));

import { chargeSale } from "../../src/core/services/processSale";

const SALE: any = { id: "sale-1", total: 10000, items: [], status: "PENDING_PAYMENT" };
const PARAMS = { cashierId: "c1", cashierName: "Ana", saleId: "sale-1" };

function setPayment(over: Record<string, unknown>) {
  m.paymentState = {
    method: "cash",
    total: 10000,
    received: 10000,
    reference: "",
    mixedCash: 0,
    mixedCard: 0,
    mixedTransfer: 0,
    customerName: "",
    ...over
  };
}

describe("chargeSale — pago pendiente en el mostrador", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.generateReceipt.mockResolvedValue({ id: "rcp" });
    m.syncDashboardAfterSale.mockResolvedValue(undefined);
  });

  it.each([
    ["card", "CARD", { reference: "ref-1" }],
    ["transfer", "TRANSFER", { reference: "ref-2" }],
    ["mixed", "MIXED", { mixedCash: 4000, mixedCard: 6000, reference: "ref-3" }]
  ])("%s pendiente: no es éxito, no imprime, conserva el carrito", async (method, _label, extra) => {
    setPayment({ method, ...extra });
    m.registerPayment.mockResolvedValue({
      sale: { ...SALE },
      payment: { success: false, verificationStatus: "PENDING_VERIFICATION", message: "pendiente" }
    });

    const result = await chargeSale(SALE, PARAMS, new Map());

    expect(result.success).toBe(false);
    expect(result.pendingPayment).toBe(true);
    expect(m.generateReceipt).not.toHaveBeenCalled();
    expect(m.printReceiptIfEnabled).not.toHaveBeenCalled();
    expect(m.syncDashboardAfterSale).not.toHaveBeenCalled();
    expect(m.cartClear).not.toHaveBeenCalled();
    expect(m.paymentReset).not.toHaveBeenCalled();
    expect(m.toastWarning).toHaveBeenCalledTimes(1);
    expect(String(m.toastWarning.mock.calls[0][0])).toContain("NO quedó confirmado");
  });

  it("efectivo confirmado: sigue siendo éxito, imprime y vacía el carrito", async () => {
    setPayment({ method: "cash" });
    m.registerPayment.mockResolvedValue({
      sale: { ...SALE, status: "PAID" },
      payment: { success: true, verificationStatus: "CONFIRMED", message: "ok" }
    });

    const result = await chargeSale(SALE, PARAMS, new Map());

    expect(result.success).toBe(true);
    expect(result.pendingPayment).toBeUndefined();
    expect(m.printReceiptIfEnabled).toHaveBeenCalledTimes(1);
    expect(m.cartClear).toHaveBeenCalledTimes(1);
    expect(m.paymentReset).toHaveBeenCalledTimes(1);
    expect(m.toastWarning).not.toHaveBeenCalled();
  });
});