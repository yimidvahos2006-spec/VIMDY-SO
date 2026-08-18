import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => {
  const mockSupabase = {
    from: vi.fn(() => mockSupabase),
    select: vi.fn(() => mockSupabase),
    eq: vi.fn(() => mockSupabase),
    maybeSingle: vi.fn(),
    single: vi.fn(),
    insert: vi.fn(() => mockSupabase),
    update: vi.fn(() => mockSupabase),
    rpc: vi.fn(() => mockSupabase)
  };
  return { supabase: mockSupabase };
});

import { SubscriptionService } from "../../src/infrastructure/supabase/subscriptionService";

describe("SubscriptionService — blindaje anti-doble-activación", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  async function mockPaymentRow(payment: Record<string, unknown>) {
    const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
    (supabase as any).from.mockReturnValueOnce({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: payment, error: null })
        })
      })
    });
  }

  async function mockRpcResponse(response: Record<string, unknown>) {
    const { supabase } = await import("../../src/infrastructure/supabase/supabaseClient");
    (supabase as any).rpc.mockResolvedValueOnce({ data: response, error: null });
  }

  describe("activateSubscription", () => {
    it("activa suscripción cuando el pago es nuevo", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", plan: "monthly", amount: 89, currency: "USD", status: "pending", renewal_number: 0 });
      await mockRpcResponse({ ok: true, alreadyActivated: false, renewalNumber: 1, renewal_date: "2024-07-15T00:00:00Z" });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b1", "monthly", "p1");

      expect(result.ok).toBe(true);
      expect(result.alreadyActivated).toBe(false);
      expect(result.renewalNumber).toBe(1);
    });

    it("detecta pago obsoleto cuando renewal_date actual es posterior", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", plan: "monthly", amount: 89, currency: "USD", status: "pending", renewal_number: 0 });
      await mockRpcResponse({ ok: true, alreadyActivated: true, renewalNumber: 2, reason: "obsolete_payment" });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b1", "monthly", "p1");

      expect(result.ok).toBe(true);
      expect(result.alreadyActivated).toBe(true);
      expect(result.renewalNumber).toBe(2);
    });

    it("no activa un pago ya aprobado (webhook duplicado)", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", status: "approved", renewal_number: 1 });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b1", "monthly", "p1");

      expect(result.ok).toBe(true);
      expect(result.alreadyActivated).toBe(true);
      expect(result.renewalNumber).toBe(1);
    });

    it("rechaza pago declinado", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", status: "declined", renewal_number: 0 });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b1", "monthly", "p1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("PAGO_DECLINADO");
    });

    it("no permite activar pago de otro negocio", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b2", status: "pending", renewal_number: 0 });

      const service = new SubscriptionService();
      const result = await service.activateSubscription("b1", "monthly", "p1");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("PAGO_NO_PERTENECE");
    });
  });

  describe("renewSubscription", () => {
    it("renueva cuando el pago es nuevo", async () => {
      await mockPaymentRow({ id: "p2", business_id: "b1", plan: "yearly", amount: 899, currency: "USD", status: "pending", renewal_number: 0 });
      await mockRpcResponse({ ok: true, alreadyRenewed: false, renewalNumber: 1, renewal_date: "2025-06-15T00:00:00Z" });

      const service = new SubscriptionService();
      const result = await service.renewSubscription("b1", "yearly", "p2");

      expect(result.ok).toBe(true);
      expect(result.alreadyRenewed).toBe(false);
      expect(result.renewalNumber).toBe(1);
    });

    it("detecta renovación obsoleta cuando renewal_date actual es posterior", async () => {
      await mockPaymentRow({ id: "p2", business_id: "b1", plan: "yearly", amount: 899, currency: "USD", status: "pending", renewal_number: 0 });
      await mockRpcResponse({ ok: true, alreadyRenewed: true, renewalNumber: 2, reason: "obsolete_payment" });

      const service = new SubscriptionService();
      const result = await service.renewSubscription("b1", "yearly", "p2");

      expect(result.ok).toBe(true);
      expect(result.alreadyRenewed).toBe(true);
      expect(result.renewalNumber).toBe(2);
    });
  });

  describe("expireSubscription", () => {
    it("marca suscripción como vencida", async () => {
      await mockRpcResponse({ ok: true, already_expired: false });

      const service = new SubscriptionService();
      const result = await service.expireSubscription("b1");

      expect(result.ok).toBe(true);
      expect(result.alreadyExpired).toBe(false);
    });

    it("devuelve alreadyExpired si ya estaba vencida", async () => {
      await mockRpcResponse({ ok: true, already_expired: true });

      const service = new SubscriptionService();
      const result = await service.expireSubscription("b1");

      expect(result.ok).toBe(true);
      expect(result.alreadyExpired).toBe(true);
    });
  });

  describe("refundSubscriptionPayment", () => {
    it("procesa reembolso total y marca suscripción como declinada", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", amount: 89, currency: "USD", status: "approved" });
      await mockRpcResponse({ ok: true, is_total_refund: true, new_payment_status: "declined" });

      const service = new SubscriptionService();
      const result = await service.refundSubscriptionPayment("p1", 89, "refund-123");

      expect(result.ok).toBe(true);
      expect(result.isTotalRefund).toBe(true);
      expect(result.newPaymentStatus).toBe("declined");
    });

    it("procesa reembolso parcial y mantiene suscripción activa", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", amount: 89, currency: "USD", status: "approved" });
      await mockRpcResponse({ ok: true, is_total_refund: false, new_payment_status: "approved" });

      const service = new SubscriptionService();
      const result = await service.refundSubscriptionPayment("p1", 44.5, "refund-456");

      expect(result.ok).toBe(true);
      expect(result.isTotalRefund).toBe(false);
      expect(result.newPaymentStatus).toBe("approved");
    });

    it("rechaza reembolso de pago no aprobado", async () => {
      await mockPaymentRow({ id: "p1", business_id: "b1", status: "pending", amount: 89, currency: "USD" });

      const service = new SubscriptionService();
      const result = await service.refundSubscriptionPayment("p1", 89, "refund-123");

      expect(result.ok).toBe(false);
      expect(result.error).toBe("PAGO_NO_APROBADO");
    });
  });
});
