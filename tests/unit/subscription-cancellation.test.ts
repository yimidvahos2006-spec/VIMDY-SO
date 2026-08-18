import { describe, expect, it, vi, beforeEach } from "vitest";

const rpcMock = vi.fn();

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    rpc: (...args: unknown[]) => rpcMock(...args),
    from: vi.fn(() => ({
      insert: vi.fn().mockResolvedValue({ error: null })
    }))
  }
}));

import { SubscriptionEngine } from "../../src/core/engines/SubscriptionEngine";
import { SubscriptionService } from "../../src/infrastructure/supabase/subscriptionService";

const engine = new SubscriptionEngine();

describe("SubscriptionEngine - cancelación", () => {
  it("días restantes de trial cancelado es 0", () => {
    const now = new Date("2026-08-16T00:00:00Z");
    const trialEndsAt = new Date("2026-08-10T00:00:00Z");
    expect(engine.daysRemaining(trialEndsAt, now)).toBe(0);
  });

  it("effectiveStatus devuelve suspended para trial vencido", () => {
    const sub = {
      plan: "trial" as const,
      trialEndsAt: new Date("2026-08-10T00:00:00Z"),
      paymentStatus: "approved" as const
    };
    const now = new Date("2026-08-16T00:00:00Z");
    expect(engine.effectiveStatus(sub as any, now)).toBe("suspended");
  });

  it("isBlocked devuelve true para suspended", () => {
    const sub = {
      plan: "monthly" as const,
      paymentStatus: "past_due" as const
    };
    expect(engine.isBlocked(sub as any)).toBe(true);
  });

  it("isPaymentAlreadyProcessed detecta approved y declined", () => {
    expect(engine.isPaymentAlreadyProcessed("approved")).toBe(true);
    expect(engine.isPaymentAlreadyProcessed("declined")).toBe(true);
    expect(engine.isPaymentAlreadyProcessed("pending")).toBe(false);
  });

  it("isTotalRefund detecta reembolso total y parcial", () => {
    expect(engine.isTotalRefund(100, 100)).toBe(true);
    expect(engine.isTotalRefund(50, 100)).toBe(false);
  });

  it("calculateRenewalDate suma 30 días para mensual", () => {
    const base = new Date("2026-08-16T00:00:00Z");
    const renewal = engine.calculateRenewalDate(base, "monthly");
    expect(renewal.toISOString()).toBe("2026-09-15T00:00:00.000Z");
  });

  it("calculateRenewalDate suma 420 días para anual", () => {
    const base = new Date("2026-08-16T00:00:00Z");
    const renewal = engine.calculateRenewalDate(base, "yearly");
    expect(renewal.toISOString()).toBe("2027-10-10T00:00:00.000Z");
  });

  it("createAuditEntry genera id y fechas correctas", () => {
    const entry = engine.createAuditEntry(
      "biz-1",
      "SUBSCRIPTION_CANCELLED",
      "user",
      "user-1",
      { cancelledAt: "2026-08-16T00:00:00Z" },
      new Date("2026-08-16T00:00:00Z")
    );

    expect(entry.id).toBeTruthy();
    expect(entry.action).toBe("SUBSCRIPTION_CANCELLED");
    expect(entry.actorType).toBe("user");
    expect(entry.businessId).toBe("biz-1");
  });
});

describe("SubscriptionService - cancelación", () => {
  beforeEach(() => {
    rpcMock.mockReset();
  });

  it("cancela suscripción mensual correctamente", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, already_cancelled: false, audit_id: "audit-1" },
      error: null
    });

    const service = new SubscriptionService();
    const result = await service.cancelSubscription("biz-1", "user-1");

    expect(result.ok).toBe(true);
    expect(result.alreadyCancelled).toBe(false);
    expect(rpcMock).toHaveBeenCalledWith("cancel_subscription_server_side", {
      p_business_id: "biz-1"
    });
  });

  it("es idempotente si ya está cancelada", async () => {
    rpcMock.mockResolvedValue({
      data: { ok: true, already_cancelled: true },
      error: null
    });

    const service = new SubscriptionService();
    const result = await service.cancelSubscription("biz-1", "user-1");

    expect(result.ok).toBe(true);
    expect(result.alreadyCancelled).toBe(true);
  });

  it("propaga error si el RPC falla", async () => {
    rpcMock.mockResolvedValue({
      data: null,
      error: { message: "NOT_A_MEMBER" }
    });

    const service = new SubscriptionService();
    const result = await service.cancelSubscription("biz-1", "user-1");

    expect(result.ok).toBe(false);
    expect(result.error).toBe("NOT_A_MEMBER");
  });
});
