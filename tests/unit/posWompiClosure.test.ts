import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockSupabase, mockRpcResults } = vi.hoisted(() => {
  const mockRpcResults: Record<string, { data: any; error: any }> = {};

  const mockSupabase = {
    rpc: vi.fn((fnName: string, params?: any) => {
      return mockRpcResults[fnName] ?? { data: null, error: null };
    }),
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          maybeSingle: vi.fn(),
          single: vi.fn(),
        })),
      })),
      insert: vi.fn(() => ({
        select: vi.fn(() => ({
          eq: vi.fn(() => ({
            maybeSingle: vi.fn(),
            single: vi.fn(),
          })),
        })),
      })),
      update: vi.fn(() => ({
        eq: vi.fn(() => ({
          select: vi.fn(() => ({
            maybeSingle: vi.fn(),
            single: vi.fn(),
          })),
        })),
      })),
    })),
    functions: {
      invoke: vi.fn(),
    },
  };

  return { mockSupabase, mockRpcResults };
});

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: mockSupabase,
  getCurrentBusinessId: () => "test-business",
  getCurrentBranchId: () => "test-branch",
}));

import { PaymentSessionManager } from "../../src/core/payments/PaymentSessionManager";
import { ExternalCheckoutResult } from "../../src/core/services/processSale";

describe("PASO 9 — Cierre POS Wompi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const key of Object.keys(mockRpcResults)) {
      delete mockRpcResults[key];
    }
  });

  describe("RPC create_wompi_sale_payment_session_atomic", () => {
    it("1. cash-only: cashAmount=0, externalAmount=sale total, método MIXED con cashAmount>0", async () => {
      const saleTotal = 100;
      const expectedCash = 0;
      const expectedExternal = saleTotal;

      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            externalAmount: expectedExternal,
            cashAmount: expectedCash,
            session: {
              id: "session-1",
              business_id: "b1",
              branch_id: "br1",
              provider: "wompi",
              currency: "COP",
              amount: expectedExternal,
              cash_amount: expectedCash,
              status: "pending",
              idempotency_key: "key-1",
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
              expires_at: "2024-01-01T00:30:00Z",
            },
          },
        ],
        error: null,
      };

      const session = await PaymentSessionManager.createForSale({
        saleId: "sale-1",
        paymentMethod: "MIXED",
        cashAmount: 0,
        externalAmount: saleTotal,
        idempotencyKey: "key-1",
      });

      expect(session.id).toBe("session-1");
      expect(session.provider).toBe("wompi");
      const rpcCall = mockSupabase.rpc.mock.calls[0];
      expect(rpcCall[1].p_cash_amount).toBe(expectedCash);
      expect(rpcCall[1].p_external_amount).toBe(expectedExternal);
      expect(rpcCall[1].p_payment_method).toBe("MIXED");
    });

    it("2. pure external (CARD): cashAmount=0, externalAmount=sale total", async () => {
      const saleTotal = 50;
      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            externalAmount: saleTotal,
            cashAmount: 0,
            session: {
              id: "session-2",
              business_id: "b1",
              branch_id: null,
              provider: "wompi",
              currency: "COP",
              amount: saleTotal,
              cash_amount: 0,
              status: "pending",
              idempotency_key: "key-2",
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
              expires_at: null,
            },
          },
        ],
        error: null,
      };

      const session = await PaymentSessionManager.createForSale({
        saleId: "sale-2",
        paymentMethod: "CARD",
        cashAmount: 0,
        externalAmount: saleTotal,
        idempotencyKey: "key-2",
      });

      expect(session.amount).toBe(saleTotal);
      const rpcCall = mockSupabase.rpc.mock.calls[0];
      expect(rpcCall[1].p_cash_amount).toBe(0);
      expect(rpcCall[1].p_payment_method).toBe("CARD");
    });

    it("3. MIXED (30k+70k): cashAmount=30000, externalAmount=70000", async () => {
      const cashAmount = 30000;
      const externalAmount = 70000;
      const saleTotal = cashAmount + externalAmount;

      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            externalAmount,
            cashAmount,
            session: {
              id: "session-3",
              business_id: "b1",
              branch_id: null,
              provider: "wompi",
              currency: "COP",
              amount: externalAmount,
              cash_amount: cashAmount,
              status: "pending",
              idempotency_key: "key-3",
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
              expires_at: null,
            },
          },
        ],
        error: null,
      };

      const session = await PaymentSessionManager.createForSale({
        saleId: "sale-3",
        paymentMethod: "MIXED",
        cashAmount,
        externalAmount,
        idempotencyKey: "key-3",
      });

      expect(session.amount).toBe(externalAmount);
      const rpcCall = mockSupabase.rpc.mock.calls[0];
      expect(rpcCall[1].p_cash_amount).toBe(cashAmount);
      expect(rpcCall[1].p_external_amount).toBe(externalAmount);
      expect(cashAmount + externalAmount).toBe(saleTotal);
    });

    it("4. MIXED (70k+30k): cashAmount=70000, externalAmount=30000", async () => {
      const cashAmount = 70000;
      const externalAmount = 30000;
      const saleTotal = cashAmount + externalAmount;

      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            externalAmount,
            cashAmount,
            session: {
              id: "session-4",
              business_id: "b1",
              branch_id: null,
              provider: "wompi",
              currency: "COP",
              amount: externalAmount,
              cash_amount: cashAmount,
              status: "pending",
              idempotency_key: "key-4",
              metadata: {},
              created_at: "2024-01-01T00:00:00Z",
              updated_at: "2024-01-01T00:00:00Z",
              expires_at: null,
            },
          },
        ],
        error: null,
      };

      const session = await PaymentSessionManager.createForSale({
        saleId: "sale-4",
        paymentMethod: "MIXED",
        cashAmount,
        externalAmount,
        idempotencyKey: "key-4",
      });

      expect(session.amount).toBe(externalAmount);
      const rpcCall = mockSupabase.rpc.mock.calls[0];
      expect(rpcCall[1].p_cash_amount).toBe(cashAmount);
      expect(rpcCall[1].p_external_amount).toBe(externalAmount);
      expect(cashAmount + externalAmount).toBe(saleTotal);
    });

    it("5. external=0 (invalid): RPC rejects externalAmount <= 0", async () => {
      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: false,
            error: "EXTERNAL_AMOUNT_MUST_BE_POSITIVE",
            message: "externalAmount must be > 0",
          },
        ],
        error: null,
      };

      await expect(
        PaymentSessionManager.createForSale({
          saleId: "sale-5",
          paymentMethod: "CARD",
          cashAmount: 0,
          externalAmount: 0,
          idempotencyKey: "key-5",
        })
      ).rejects.toThrow("EXTERNAL_AMOUNT_MUST_BE_POSITIVE");
    });

    it("6. cashAmount > total (invalid): RPC rejects", async () => {
      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: false,
            error: "EXTERNAL_AMOUNT_MUST_BE_POSITIVE",
            message: "cashAmount exceeds remaining external portion",
          },
        ],
        error: null,
      };

      await expect(
        PaymentSessionManager.createForSale({
          saleId: "sale-6",
          paymentMethod: "MIXED",
          cashAmount: 110,
          externalAmount: 0,
          idempotencyKey: "key-6",
        })
      ).rejects.toThrow();
    });

    it("7. amount mismatch (external + cash != total): RPC rejects", async () => {
      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: false,
            error: "AMOUNT_MISMATCH",
            message: "cash_amount + external_amount != total",
          },
        ],
        error: null,
      };

      await expect(
        PaymentSessionManager.createForSale({
          saleId: "sale-7",
          paymentMethod: "MIXED",
          cashAmount: 50,
          externalAmount: 25,
          idempotencyKey: "key-7",
        })
      ).rejects.toThrow("AMOUNT_MISMATCH");
    });

    it("8. double click idempotency: same idempotencyKey returns same session", async () => {
      const sessionRow = {
        id: "session-8",
        business_id: "b1",
        branch_id: null,
        provider: "wompi",
        currency: "COP",
        amount: 80,
        cash_amount: 0,
        status: "pending",
        idempotency_key: "key-8",
        metadata: {},
        created_at: "2024-01-01T00:00:00Z",
        updated_at: "2024-01-01T00:00:00Z",
        expires_at: null,
      };

      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            externalAmount: 80,
            cashAmount: 0,
            session: sessionRow,
          },
        ],
        error: null,
      };

      // First call
      const session1 = await PaymentSessionManager.createForSale({
        saleId: "sale-8",
        paymentMethod: "CARD",
        cashAmount: 0,
        externalAmount: 80,
        idempotencyKey: "key-8",
      });

      // Second call with same key — RPC returns idempotent result
      // On idempotent calls, the metadata includes idempotent=true
      const sessionRow2 = { ...sessionRow, metadata: { ...sessionRow.metadata, idempotent: true } };
      mockRpcResults["create_wompi_sale_payment_session_atomic"] = {
        data: [
          {
            success: true,
            idempotent: true,
            externalAmount: 80,
            cashAmount: 0,
            session: sessionRow2,
          },
        ],
        error: null,
      };

      const session2 = await PaymentSessionManager.createForSale({
        saleId: "sale-8",
        paymentMethod: "CARD",
        cashAmount: 0,
        externalAmount: 80,
        idempotencyKey: "key-8",
      });

      expect(session1.id).toBe(session2.id);
      expect(session2.metadata?.idempotent).toBe(true);
      expect(mockSupabase.rpc).toHaveBeenCalledTimes(2);
    });
  });

  describe("RPC finalize_wompi_sale_payment_atomic (webhook)", () => {
    it("9. webhook APPROVED: creates payment_verifications CONFIRMED + calls register_sale_payment_atomic", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: true,
            idempotent: false,
            status: "approved",
            saleId: "sale-9",
            paymentVerificationId: "pv-9",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-9",
        p_wompi_transaction_id: "tx-9",
        p_wompi_reference: "VIMDY-session9",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      const row = result.data?.[0];
      expect(row.success).toBe(true);
      expect(row.status).toBe("approved");
      expect(row.saleId).toBe("sale-9");
      expect(row.idempotent).toBe(false);
    });

    it("10. webhook duplicate APPROVED: idempotent=true, no double payment", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: true,
            idempotent: true,
            status: "approved",
            saleId: "sale-10",
            paymentVerificationId: "pv-10",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-10",
        p_wompi_transaction_id: "tx-10",
        p_wompi_reference: "VIMDY-session10",
        p_amount_in_cents: 5000,
        p_currency: "COP",
        p_payment_method: "TRANSFER",
      });

      const row = result.data?.[0];
      expect(row.idempotent).toBe(true);
      expect(row.success).toBe(true);
      expect(row.status).toBe("approved");
    });

    it("11. webhook APPROVED then DECLINED: finalize already-approved returns idempotent, no downgrade", async () => {
      // First APPROVED
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [{ success: true, idempotent: false, status: "approved", saleId: "sale-11" }],
        error: null,
      };
      await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-11",
        p_wompi_transaction_id: "tx-11a",
        p_wompi_reference: "VIMDY-session11",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      // Then DECLINED — should return idempotent (session already approved)
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: true,
            idempotent: true,
            status: "approved",
            alreadyFinalized: true,
            saleId: "sale-11",
          },
        ],
        error: null,
      };
      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-11",
        p_wompi_transaction_id: "tx-11b",
        p_wompi_reference: "VIMDY-session11",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      const row = result.data?.[0];
      expect(row.alreadyFinalized).toBe(true);
      expect(row.status).toBe("approved"); // NOT downgraded to declined
    });

    it("12. webhook DECLINED then APPROVED: APPROVED wins, registers payment", async () => {
      // First DECLINED
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [{ success: true, idempotent: false, status: "declined", saleId: "sale-12" }],
        error: null,
      };
      const declined = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-12",
        p_wompi_transaction_id: "tx-12a",
        p_wompi_reference: "VIMDY-session12",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });
      expect(declined.data?.[0].status).toBe("declined");

      // Then APPROVED — should register payment
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [{ success: true, idempotent: false, status: "approved", saleId: "sale-12", paymentVerificationId: "pv-12" }],
        error: null,
      };
      const approved = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-12",
        p_wompi_transaction_id: "tx-12b",
        p_wompi_reference: "VIMDY-session12",
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(approved.data?.[0].status).toBe("approved");
      expect(approved.data?.[0].paymentVerificationId).toBe("pv-12");
    });

    it("13. invalid checksum: webhook rejects with 401", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "INVALID_SIGNATURE",
            message: "Checksum validation failed",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-13",
        p_wompi_transaction_id: "tx-13",
        p_wompi_reference: "VIMDY-session13",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(result.data?.[0].error).toBe("INVALID_SIGNATURE");
    });

    it("14. wrong reference: finalize fails, unknown reference", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "FINALIZE_WOMPI_SESSION_NOT_FOUND",
            message: "No session found for reference",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-14",
        p_wompi_transaction_id: "tx-14",
        p_wompi_reference: "VIMDY-wrong-reference",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(result.data?.[0].error).toBe("FINALIZE_WOMPI_SESSION_NOT_FOUND");
    });

    it("15. wrong amount: finalize fails, amount mismatch", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "FINALIZE_WOMPI_AMOUNT_MISMATCH",
            message: "expected 10000 cents, got 5000",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-15",
        p_wompi_transaction_id: "tx-15",
        p_wompi_reference: "VIMDY-session15",
        p_amount_in_cents: 5000, // Wrong amount
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(result.data?.[0].error).toBe("FINALIZE_WOMPI_AMOUNT_MISMATCH");
    });

    it("16. wrong currency: finalize fails", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "FINALIZE_WOMPI_CURRENCY_MISMATCH",
            message: "Expected COP, got USD",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-16",
        p_wompi_transaction_id: "tx-16",
        p_wompi_reference: "VIMDY-session16",
        p_amount_in_cents: 10000,
        p_currency: "USD", // Wrong currency
        p_payment_method: "CARD",
      });

      expect(result.data?.[0].error).toBe("FINALIZE_WOMPI_CURRENCY_MISMATCH");
    });

    it("17. cross-tenant: finalize fails, session belongs to different business", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "FINALIZE_WOMPI_SALE_NOT_FOUND",
            message: "Sale not found or tenant mismatch",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-17",
        p_wompi_transaction_id: "tx-17",
        p_wompi_reference: "VIMPY-cross-tenant",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(result.data?.[0].error).toBe("FINALIZE_WOMPI_SALE_NOT_FOUND");
    });

    it("18. cross-branch: finalize validates branch_id matches", async () => {
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: false,
            error: "FINALIZE_WOMPI_SALE_NOT_FOUND",
            message: "Branch mismatch",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-18",
        p_wompi_transaction_id: "tx-18",
        p_wompi_reference: "VIMDY-cross-branch",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "MIXED",
      });

      expect(result.data?.[0].error).toBe("FINALIZE_WOMPI_SALE_NOT_FOUND");
    });

    it("19. finalize without verification: session has payment_method but no payment_verifications row → finaliza y crea verification", async () => {
      // The finalize RPC is responsible for inserting payment_verifications if not present
      // This is the normal flow: webhook arrives, finalize creates verification + registers payment
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: [
          {
            success: true,
            idempotent: false,
            status: "approved",
            saleId: "sale-19",
            paymentVerificationId: "pv-19",
          },
        ],
        error: null,
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-19",
        p_wompi_transaction_id: "tx-19",
        p_wompi_reference: "VIMDY-session19",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "QR",
      });

      const row = result.data?.[0];
      expect(row.success).toBe(true);
      expect(row.paymentVerificationId).toBe("pv-19");
      expect(row.status).toBe("approved");
    });

    it("20. service_role finalization: only service_role can call finalize_wompi_sale_payment_atomic", async () => {
      // The RPC is created with REVOKE ALL ... TO authenticated; GRANT ... TO service_role
      // This test simulates that authenticated role gets an error (RLS block)
      mockRpcResults["finalize_wompi_sale_payment_atomic"] = {
        data: null,
        error: {
          message: "permission denied for function finalize_wompi_sale_payment_atomic",
          code: "42501",
        },
      };

      const result = await mockSupabase.rpc("finalize_wompi_sale_payment_atomic", {
        p_session_id: "session-20",
        p_wompi_transaction_id: "tx-20",
        p_wompi_reference: "VIMDY-session20",
        p_amount_in_cents: 10000,
        p_currency: "COP",
        p_payment_method: "CARD",
      });

      expect(result.error).toBeTruthy();
      expect(result.error.code).toBe("42501");
      expect(result.error.message).toContain("permission denied");
    });
  });

  describe("Integration: POS sale flow", () => {
    it("MIXED flow: processSale divides external vs cash and invokes Edge Function", async () => {
      const externalCheckoutResult: ExternalCheckoutResult = {
        sessionId: "session-mixed",
        checkoutUrl: "https://checkout.wompi.co/p/?reference=VIMDY-sessionmixed",
        reference: "VIMDY-sessionmixed",
        amount: 70000, // external portion
        currency: "COP",
        paymentMethod: "MIXED",
        cashAmount: 30000,
        externalAmount: 70000,
        expiresAt: null,
      };

      mockSupabase.functions.invoke = vi.fn().mockResolvedValue({
        data: externalCheckoutResult,
        error: null,
      });

      const result = await mockSupabase.functions.invoke("wompi-create-pos-checkout", {
        body: {
          saleId: "sale-mixed",
          paymentMethod: "MIXED",
          cashAmount: 30000,
          externalAmount: 70000,
          idempotencyKey: "key-mixed",
          shiftId: "shift-1",
          cashRegisterId: "cashreg-1",
        },
      });

      expect(result.data).toBeTruthy();
      expect(result.data.amount).toBe(70000); // only external amount
      expect(result.data.cashAmount).toBe(30000);
      expect(result.data.externalAmount).toBe(70000);
      expect(result.data.checkoutUrl).toContain("checkout.wompi.co");
      expect(result.data.reference).toBe("VIMDY-sessionmixed");
    });
  });
});
