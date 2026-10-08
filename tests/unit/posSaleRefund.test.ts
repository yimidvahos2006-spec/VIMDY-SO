import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock Supabase client BEFORE importing modules
const mocks = vi.hoisted(() => {
  const rpcResults: Record<string, { data: any; error: any }> = {};

  const fromResults: Record<string, any> = {};

  return {
    rpcResults,
    fromResults,
    mockSupabase: {
      from: vi.fn(() => {
        const stored = Object.values(fromResults)[0];
        if (stored) return stored;
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
              maybeSingle: async () => ({ data: null, error: null }),
            }),
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        };
      }),
      rpc: vi.fn((fnName: string) => {
        return rpcResults[fnName] ?? { data: null, error: null };
      }),
      functions: {
        invoke: vi.fn(),
      },
    },
  };
});

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: mocks.mockSupabase,
  getCurrentBusinessId: () => "test-business-id",
  getCurrentBranchId: () => "test-branch-id",
  setCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
}));

vi.mock("../../src/core/store/companyConfigStore", () => ({
  companyConfigStore: {
    get: () => ({ currency: "COP", timezone: "America/Bogota" }),
  },
}));

vi.mock("../../src/core/VimdyCore", () => ({
  vimdyCore: {
    on: vi.fn(),
    off: vi.fn(),
    once: vi.fn(),
    emit: vi.fn(),
    clearHistory: vi.fn(),
    getHistory: vi.fn(() => []),
  },
}));

import { supabase } from "../../src/infrastructure/supabase/supabaseClient";
import { SalesEngine } from "../../src/core/engines/SalesEngine";

// Build a minimal SalesEngine with mocked dependencies
function buildSalesEngine(): SalesEngine {
  const mockSaleRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    update: vi.fn(),
    findAll: vi.fn(),
    delete: vi.fn(),
    createSaleFulfillmentAtomic: vi.fn(),
    registerPaymentAtomic: vi.fn(),
  };

  const mockCart = {
    getItems: vi.fn(() => []),
    clear: vi.fn(),
    setItems: vi.fn(),
    setCustomer: vi.fn(),
    setTableId: vi.fn(),
    setWaiterId: vi.fn(),
  };

  const mockInventory = {
    consumeForSale: vi.fn(),
    restoreForSale: vi.fn(),
    produceBatch: vi.fn(),
    getProduct: vi.fn(),
    adjustStock: vi.fn(),
    getAllMovements: vi.fn(),
    getHistory: vi.fn(),
    hasMovements: vi.fn(),
    listAll: vi.fn(() => []),
  };

  const mockPayment = {
    registerPayment: vi.fn(),
  };

  const mockReceipt = {
    getByCode: vi.fn(),
    print: vi.fn(),
    last: vi.fn(),
  };

  const mockKitchen = {
    createOrder: vi.fn(),
  };

  const mockCash = {
    registerIncome: vi.fn(),
    registerExpense: vi.fn(),
    registerSalePaymentAtomic: vi.fn(),
    refundSaleCashAtomic: vi.fn(),
    getBalance: vi.fn(),
    getTodayBalance: vi.fn(),
    getMovementsForShift: vi.fn(),
    getAllMovements: vi.fn(),
    getTodayMovements: vi.fn(),
    getMovementsBetween: vi.fn(),
    isPaymentAtomicRepository: vi.fn(() => false),
    isRefundAtomicRepository: vi.fn(() => false),
  };

  const mockCustomer = {
    findOrCreate: vi.fn(),
    getAllCustomers: vi.fn(() => []),
  };

  const mockAlert = {
    check: vi.fn(),
    clear: vi.fn(),
    checkStockAlerts: vi.fn(() => []),
  };

  const mockHealth = {
    calculate: vi.fn(() => ({ score: 90, status: "healthy" })),
  };

  const mockKardex = {
    record: vi.fn(),
    getAllMovements: vi.fn(),
    getHistory: vi.fn(),
    hasMovements: vi.fn(),
  };

  const mockPosCore = {};

  const mockAudit = {
    log: vi.fn(),
  };

  const mockDashboardStore = {
    partialReverseSale: vi.fn(),
    reverseSale: vi.fn(),
  };

  return new SalesEngine(
    mockSaleRepo as any,
    mockCart as any,
    mockInventory as any,
    mockPayment as any,
    mockReceipt as any,
    mockKitchen as any,
    mockCash as any,
    mockCustomer as any,
    mockAlert as any,
    mockHealth as any,
    mockKardex as any,
    mockPosCore as any,
    mockAudit as any,
    { dashboardStore: mockDashboardStore as any }
  );
}

describe("POS Sale External Refund — SalesEngine.refundExternalSalePayment", () => {
  let engine: SalesEngine;
  let mockSaleRepo: any;

  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mocks.rpcResults)) delete mocks.rpcResults[key];
    for (const key of Object.keys(mocks.fromResults)) delete mocks.fromResults[key];

    engine = buildSalesEngine();
    mockSaleRepo = (engine as any).saleRepository;
  });

  function mockPaidSale(id = "sale-1", total = 100000): any {
    const sale = {
      id,
      businessId: "test-business-id",
      branchId: "test-branch-id",
      total,
      code: "RAP-0001",
      status: "PAID" as const,
      paymentStatus: "CONFIRMED" as const,
      paymentMethod: "WOMPI" as const,
      cashierId: "cashier-1",
      items: [],
      refunds: [],
    };
    mockSaleRepo.findById.mockResolvedValue(sale);
    mockSaleRepo.findAll.mockResolvedValue([sale]);
    // Mock update to return updated sale
    mockSaleRepo.update.mockResolvedValue({ ...sale, status: "PAID" });
    return sale;
  }

  function mockPaymentSession(session: any) {
    mocks.fromResults["payment_sessions"] = {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: session, error: null }),
          }),
        }),
      }),
    };
  }

  it("1. refund POS total: provider confirmed", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-1", amount: 70000, status: "confirmed" },
        provider: "wompi",
        status: "confirmed",
        providerReference: "wompi-refund-456",
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-1", 70000, "Devolución cliente");
    expect(result.success).toBe(true);
    expect(result.provider).toBe("wompi");
    expect(result.status).toBe("confirmed");
    expect(result.providerReference).toBe("wompi-refund-456");
  });

  it("2. refund POS parcial: partial amount refunded", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-1", amount: 30000, status: "confirmed" },
        provider: "wompi",
        status: "confirmed",
        providerReference: "wompi-refund-456",
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-1", 30000, "Reembolso parcial");
    expect(result.success).toBe(true);
    expect(result.refund.amount).toBe(30000);
    expect(result.status).toBe("confirmed");
  });

  it("3. refund exceeds remaining: RPC rejects", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: false,
        error: "POS_REFUND_AMOUNT_EXCEEDS_REMAINING",
        detail: "requested 80000 exceeds remaining 70000",
      },
      error: null,
    });

    await expect(
      engine.refundExternalSalePayment("sale-1", 80000, "Demasiado")
    ).rejects.toThrow(/POS_REFUND_AMOUNT_EXCEEDS_REMAINING/);
  });

  it("4. duplicate request: idempotent key returns existing refund", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        idempotent: true,
        refund: { id: "refund-1", amount: 70000, status: "confirmed" },
        provider: "wompi",
        status: "confirmed",
        providerReference: "wompi-refund-456",
      },
      error: null,
    });

    const r1 = await engine.refundExternalSalePayment("sale-1", 70000, "First", "key-1");
    const r2 = await engine.refundExternalSalePayment("sale-1", 70000, "Retry", "key-1");

    expect(r1.success).toBe(true);
    expect(r2.success).toBe(true);
    expect(supabase.functions.invoke).toHaveBeenCalledTimes(2);
    // Both calls use the same idempotencyKey
    const calls = (supabase.functions.invoke as any).mock.calls;
    expect(calls[0][1].body.idempotencyKey).toBe("key-1");
    expect(calls[1][1].body.idempotencyKey).toBe("key-1");
  });

  it("5. provider failure: Edge Function returns failed status", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-1", amount: 70000, status: "failed" },
        provider: "wompi",
        status: "failed",
        providerReference: null,
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-1", 70000, "Provider rechazado");
    expect(result.success).toBe(true);
    expect(result.status).toBe("failed");
  });

  it("6. provider pending: refund stays pending, no settlement", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-1", amount: 70000, status: "pending" },
        provider: "wompi",
        status: "pending",
        providerReference: null,
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-1", 70000, "Pending provider");
    expect(result.success).toBe(true);
    expect(result.status).toBe("pending");
  });

  it("7. sale not found", async () => {
    mockSaleRepo.findById.mockResolvedValue(null);

    await expect(
      engine.refundExternalSalePayment("nonexistent", 70000, "reason")
    ).rejects.toThrow("SALE_NOT_FOUND");
  });

  it("8. sale not paid: rejects", async () => {
    mockSaleRepo.findById.mockResolvedValue({
      id: "sale-1",
      status: "OPEN" as any,
      paymentStatus: "NONE" as any,
    });

    await expect(
      engine.refundExternalSalePayment("sale-1", 70000, "reason")
    ).rejects.toThrow("SALE_NOT_PAID");
  });

  it("9. sale has invoice: rejects with credit note required", async () => {
    mockSaleRepo.findById.mockResolvedValue({
      id: "sale-1",
      status: "PAID" as any,
      paymentStatus: "CONFIRMED" as any,
      paymentMethod: "WOMPI" as any,
      invoiceId: "invoice-1",
    });

    await expect(
      engine.refundExternalSalePayment("sale-1", 70000, "reason")
    ).rejects.toThrow("SALE_HAS_INVOICE");
  });

  it("10. tenant isolation: sale from different business", async () => {
    mockSaleRepo.findById.mockResolvedValue({
      id: "sale-1",
      businessId: "other-business",
      branchId: "test-branch-id",
      status: "PAID" as any,
      paymentStatus: "CONFIRMED" as any,
      paymentMethod: "WOMPI" as any,
    });

    // The payment_sessions query uses business_id filter
    mocks.fromResults["payment_sessions"] = {
      select: () => ({
        eq: () => ({
          eq: () => ({
            maybeSingle: async () => ({ data: null, error: null }),
          }),
        }),
      }),
    };

    await expect(
      engine.refundExternalSalePayment("sale-1", 70000, "reason")
    ).rejects.toThrow("POS_REFUND_NO_PROVIDER_REFERENCE");
  });

  it("11. unsupported provider: rejects", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "external_terminal",
      provider_reference: "ref-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 0,
      payment_method: "CARD",
    });

    await expect(
      engine.refundExternalSalePayment("sale-1", 70000, "reason")
    ).rejects.toThrow("POS_REFUND_PROVIDER_NOT_SUPPORTED");
  });

  it("12. session not approved: rejects", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "pending",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    await expect(
      engine.refundExternalSalePayment("sale-1", 70000, "reason")
    ).rejects.toThrow("POS_REFUND_SESSION_NOT_APPROVED");
  });

  it("13. retry with same idempotencyKey returns idempotent result", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    let callCount = 0;
    (supabase.functions.invoke as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        return {
          data: {
            ok: true,
            refund: { id: "refund-1", amount: 70000, status: "confirmed" },
            provider: "wompi",
            status: "confirmed",
            providerReference: "wompi-refund-456",
          },
          error: null,
        };
      }
      // Second call: simulate provider rejected duplicate
      return {
        data: {
          ok: true,
          idempotent: true,
          refund: { id: "refund-1", amount: 70000, status: "confirmed" },
          provider: "wompi",
          status: "confirmed",
          providerReference: "wompi-refund-456",
        },
        error: null,
      };
    });

    await engine.refundExternalSalePayment("sale-1", 70000, "First", "key-retry");
    const result = await engine.refundExternalSalePayment("sale-1", 70000, "Retry", "key-retry");

    expect(result.success).toBe(true);
    expect(result.status).toBe("confirmed");
  });

  it("14. concurrent refund requests: only one succeeds", async () => {
    mockPaidSale();
    mockPaymentSession({
      id: "session-1",
      provider: "wompi",
      provider_reference: "wompi-tx-123",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    let firstCall = true;
    (supabase.functions.invoke as any).mockImplementation(async () => {
      if (firstCall) {
        firstCall = false;
        return new Promise((resolve) => {
          setTimeout(() => {
            resolve({
              data: {
                ok: true,
                refund: { id: "refund-1", amount: 70000, status: "confirmed" },
                provider: "wompi",
                status: "confirmed",
                providerReference: "wompi-refund-456",
              },
              error: null,
            });
          }, 10);
        });
      }
      return {
        data: {
          ok: false,
          error: "POS_REFUND_ALREADY_SETTLED",
        },
        error: null,
      };
    });

    const results = await Promise.allSettled([
      engine.refundExternalSalePayment("sale-1", 70000, "A", "concurrent-1"),
      engine.refundExternalSalePayment("sale-1", 70000, "B", "concurrent-2"),
    ]);

    // At least one should succeed; the RPC/database guarantees only one real refund
    const successes = results
      .filter((r) => r.status === "fulfilled" && (r as any).value?.success)
      .map((r) => (r as any).value);
    expect(successes.length).toBe(1);
    expect(successes[0].refund.amount).toBe(70000);
    expect(successes[0].status).toBe("confirmed");
  });

  it("15. 100000 total: cash=30000, external=70000 — provider receives only external", async () => {
    mockPaidSale("sale-mixed", 100000);
    mockPaymentSession({
      id: "session-mixed",
      provider: "wompi",
      provider_reference: "wompi-tx-789",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockImplementation(async (_: string, opts: any) => {
      const body = opts.body;
      // The SalesEngine sends the amount to refund (only the external portion)
      expect(body.amount).toBe(70000);
      expect(body.amount).not.toBe(100000);
      // The session's external amount is in the payment_sessions row (70000 external, 30000 cash)
      // The SalesEngine sends only the refund amount (70000), not the total (100000)

      return {
        data: {
          ok: true,
          refund: { id: "refund-mixed-1", amount: 70000, status: "confirmed" },
          provider: "wompi",
          status: "confirmed",
          providerReference: "wompi-refund-789",
        },
        error: null,
      };
    });

    const result = await engine.refundExternalSalePayment("sale-mixed", 70000, "Reembolso total external");

    expect(result.success).toBe(true);
    expect(result.refund.amount).toBe(70000);

    // Verify the Edge Function was called with correct amounts
    const invokeCall = (supabase.functions.invoke as any).mock.calls[0];
    const body = invokeCall[1].body;
    expect(body.sessionId).toBe("session-mixed");
    expect(body.amount).toBe(70000);
     expect(body.idempotencyKey).toMatch(/pos-refund-sale-mixed-\d+/);
  });

  it("16. MIXED refund total: refund 70000 external, cash handled separately", async () => {
    mockPaidSale("sale-mixed-total", 100000);
    mockPaymentSession({
      id: "session-mixed-total",
      provider: "wompi",
      provider_reference: "wompi-tx-total",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-mixed-total-1", amount: 70000, status: "confirmed" },
        provider: "wompi",
        status: "confirmed",
        providerReference: "v2_refund_abc123",
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-mixed-total", 70000, "Reembolso total");

    expect(result.success).toBe(true);
    expect(result.refund.amount).toBe(70000);
    expect(result.status).toBe("confirmed");

    // Verify the Edge Function received ONLY the external amount, not the full sale total
    const invokeCall = (supabase.functions.invoke as any).mock.calls[0];
    const body = invokeCall[1].body;
    expect(body.sessionId).toBe("session-mixed-total");
    expect(body.amount).toBe(70000);
    expect(body.amount).not.toBe(100000); // Must NOT refund cash portion to external provider
  });

  it("17. MIXED refund partial: refund 40000 of 70000 external", async () => {
    mockPaidSale("sale-mixed-partial", 100000);
    mockPaymentSession({
      id: "session-mixed-partial",
      provider: "wompi",
      provider_reference: "wompi-tx-partial",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: true,
        refund: { id: "refund-mixed-partial-1", amount: 40000, status: "confirmed" },
        provider: "wompi",
        status: "confirmed",
        providerReference: "v2_refund_def456",
      },
      error: null,
    });

    const result = await engine.refundExternalSalePayment("sale-mixed-partial", 40000, "Reembolso parcial");

    expect(result.success).toBe(true);
    expect(result.refund.amount).toBe(40000);
    expect(result.status).toBe("confirmed");
  });

  it("18. MIXED refund exceeds external amount: RPC rejects", async () => {
    mockPaidSale("sale-mixed-exceeds", 100000);
    mockPaymentSession({
      id: "session-mixed-exceeds",
      provider: "wompi",
      provider_reference: "wompi-tx-exceeds",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    (supabase.functions.invoke as any).mockResolvedValue({
      data: {
        ok: false,
        error: "POS_REFUND_AMOUNT_EXCEEDS_REMAINING",
        detail: "requested 80000 exceeds remaining 70000",
      },
      error: null,
    });

    await expect(
      engine.refundExternalSalePayment("sale-mixed-exceeds", 80000, "Demasiado")
    ).rejects.toThrow(/POS_REFUND_AMOUNT_EXCEEDS_REMAINING/);
  });

  it("19. MIXED refund total then partial: only remaining can be refunded", async () => {
    mockPaidSale("sale-mixed-sequential", 100000);
    mockPaymentSession({
      id: "session-mixed-seq",
      provider: "wompi",
      provider_reference: "wompi-tx-seq",
      status: "approved",
      amount: 70000,
      currency: "COP",
      cash_amount: 30000,
      payment_method: "MIXED",
    });

    let callCount = 0;
    (supabase.functions.invoke as any).mockImplementation(async () => {
      callCount++;
      if (callCount === 1) {
        // First refund: 70000 (full external)
        return {
          data: {
            ok: true,
            refund: { id: "refund-seq-1", amount: 70000, status: "confirmed" },
            provider: "wompi",
            status: "confirmed",
            providerReference: "v2_refund_seq_1",
          },
          error: null,
        };
      }
      // Second refund: should reject (0 remaining)
      return {
        data: {
          ok: false,
          error: "POS_REFUND_NOTHING_LEFT",
          detail: "remaining 0",
        },
        error: null,
      };
    });

    // First refund: full external amount
    const r1 = await engine.refundExternalSalePayment("sale-mixed-sequential", 70000, "Full external");
    expect(r1.success).toBe(true);
    expect(r1.refund.amount).toBe(70000);

    // Second refund: should fail (no remaining external amount)
    await expect(
      engine.refundExternalSalePayment("sale-mixed-sequential", 10000, "No remaining")
    ).rejects.toThrow(/POS_REFUND_NOTHING_LEFT/);
  });
});
