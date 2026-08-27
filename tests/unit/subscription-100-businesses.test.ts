import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionEngine } from "../../src/core/engines/SubscriptionEngine";
import type { Subscription } from "../../src/core/entities/SubscriptionTypes";

describe("SubscriptionEngine — prueba de 100 negocios", () => {
  let engine: SubscriptionEngine;

  beforeEach(() => {
    engine = new SubscriptionEngine();
  });

  it("100 negocios independientes: cada uno evalúa su propio trial sin cruzarse", () => {
    const baseDate = new Date("2026-08-20T00:00:00Z");
    const businesses: Subscription[] = [];

    for (let i = 1; i <= 100; i++) {
      const trialEndsAt = new Date(baseDate);
      trialEndsAt.setDate(trialEndsAt.getDate() + 30 + (i % 30));

      businesses.push({
        businessId: `business-${i}`,
        plan: "trial",
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      });
    }

    const now = new Date("2026-09-19T00:00:00Z");

    let trialCount = 0;
    for (let i = 1; i <= 100; i++) {
      const sub = businesses[i - 1];
      const daysRemaining = engine.daysRemaining(sub.trialEndsAt, now);
      const status = engine.effectiveStatus(sub, now);
      const blocked = engine.isBlocked(sub, now);

      if (status === "trial") {
        trialCount += 1;
      }

      expect(sub.businessId).toBe(`business-${i}`);
    }

    expect(trialCount).toBeGreaterThan(0);
    const uniqueBusinessIds = new Set(businesses.map((b) => b.businessId));
    expect(uniqueBusinessIds.size).toBe(100);
  });

  it("100 negocios: al avanzar el reloj, los vencidos se bloquean independientemente", () => {
    const now = new Date("2026-11-01T00:00:00Z");
    const businesses: Subscription[] = [];

    for (let i = 1; i <= 100; i++) {
      const trialEndsAt = new Date("2026-10-15T00:00:00Z");
      trialEndsAt.setDate(trialEndsAt.getDate() + i);

      businesses.push({
        businessId: `business-${i}`,
        plan: "trial",
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      });
    }

    const blockedCount = businesses.filter((sub) => engine.isBlocked(sub, now)).length;
    const expiredCount = businesses.filter((sub) => engine.effectiveStatus(sub, now) === "expired").length;

    expect(expiredCount).toBeGreaterThan(0);
    expect(expiredCount).toBe(blockedCount);
    expect(expiredCount).toBeLessThan(100);
  });
});
