import { describe, it, expect, vi, beforeEach } from "vitest";
import { SubscriptionEngine, WARNING_THRESHOLDS } from "../../src/core/engines/SubscriptionEngine";
import type { Subscription, SubscriptionAuditDetails } from "../../src/core/entities/SubscriptionTypes";

describe("SubscriptionEngine", () => {
  let engine: SubscriptionEngine;

  beforeEach(() => {
    engine = new SubscriptionEngine();
  });

  describe("daysRemaining", () => {
    it("returns days remaining rounded up", () => {
      const now = new Date("2024-01-01T00:00:00Z");
      const trialEnds = new Date("2024-01-05T23:59:59Z");
      expect(engine.daysRemaining(trialEnds, now)).toBe(5);
    });

    it("returns 0 if trial ended", () => {
      const now = new Date("2024-01-10T00:00:00Z");
      const trialEnds = new Date("2024-01-05T00:00:00Z");
      expect(engine.daysRemaining(trialEnds, now)).toBe(0);
    });

    it("returns 0 if trialEndsAt is null", () => {
      expect(engine.daysRemaining(null)).toBe(0);
    });

    it("returns 1 if less than 24h remain", () => {
      const now = new Date("2024-01-05T00:00:00Z");
      const trialEnds = new Date("2024-01-05T12:00:00Z");
      expect(engine.daysRemaining(trialEnds, now)).toBe(1);
    });
  });

  describe("warningThreshold", () => {
    it("returns 7 when days remaining is 7", () => {
      expect(engine.warningThreshold(7)).toBe(7);
    });

    it("returns 3 when days remaining is 5", () => {
      expect(engine.warningThreshold(5)).toBe(3);
    });

    it("returns 1 when days remaining is 2", () => {
      expect(engine.warningThreshold(2)).toBe(1);
    });

    it("returns 1 when days remaining is 1", () => {
      expect(engine.warningThreshold(1)).toBe(1);
    });

    it("returns null when days remaining is 0", () => {
      expect(engine.warningThreshold(0)).toBeNull();
    });

    it("returns null when days remaining is greater than 7", () => {
      expect(engine.warningThreshold(10)).toBeNull();
    });
  });

  describe("effectiveStatus", () => {
    it("returns trial when trial is active", () => {
      const now = new Date("2024-01-01T00:00:00Z");
      const sub: Subscription = {
        businessId: "b1",
        plan: "trial",
        trialEndsAt: new Date("2024-01-10T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      };
      expect(engine.effectiveStatus(sub, now)).toBe("trial");
    });

    it("returns suspended when trial expired", () => {
      const now = new Date("2024-01-15T00:00:00Z");
      const sub: Subscription = {
        businessId: "b1",
        plan: "trial",
        trialEndsAt: new Date("2024-01-10T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      };
      expect(engine.effectiveStatus(sub, now)).toBe("suspended");
    });

    it("returns monthly when plan is monthly and payment approved", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "monthly",
        trialEndsAt: null,
        renewalDate: new Date("2024-02-01T00:00:00Z"),
        nextChargeAt: new Date("2024-02-01T00:00:00Z"),
        paymentMethod: "wompi_card",
        paymentStatus: "approved"
      };
      expect(engine.effectiveStatus(sub)).toBe("monthly");
    });

    it("returns yearly when plan is yearly and payment approved", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "yearly",
        trialEndsAt: null,
        renewalDate: new Date("2025-01-01T00:00:00Z"),
        nextChargeAt: new Date("2025-01-01T00:00:00Z"),
        paymentMethod: "paypal",
        paymentStatus: "approved"
      };
      expect(engine.effectiveStatus(sub)).toBe("yearly");
    });

    it("returns suspended when payment declined", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "monthly",
        trialEndsAt: null,
        renewalDate: new Date("2024-02-01T00:00:00Z"),
        nextChargeAt: new Date("2024-02-01T00:00:00Z"),
        paymentMethod: "wompi_card",
        paymentStatus: "declined"
      };
      expect(engine.effectiveStatus(sub)).toBe("suspended");
    });

    it("returns suspended when payment past_due", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "yearly",
        trialEndsAt: null,
        renewalDate: new Date("2025-01-01T00:00:00Z"),
        nextChargeAt: new Date("2025-01-01T00:00:00Z"),
        paymentMethod: "paypal",
        paymentStatus: "past_due"
      };
      expect(engine.effectiveStatus(sub)).toBe("suspended");
    });
  });

  describe("isBlocked", () => {
    it("blocks when suspended", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "trial",
        trialEndsAt: new Date("2024-01-01T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      };
      expect(engine.isBlocked(sub, new Date("2024-01-15T00:00:00Z"))).toBe(true);
    });

    it("does not block when trial is active", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "trial",
        trialEndsAt: new Date("2024-01-10T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none"
      };
      expect(engine.isBlocked(sub, new Date("2024-01-05T00:00:00Z"))).toBe(false);
    });

    it("does not block when paid and approved", () => {
      const sub: Subscription = {
        businessId: "b1",
        plan: "monthly",
        trialEndsAt: null,
        renewalDate: new Date("2024-02-01T00:00:00Z"),
        nextChargeAt: new Date("2024-02-01T00:00:00Z"),
        paymentMethod: "wompi_card",
        paymentStatus: "approved"
      };
      expect(engine.isBlocked(sub)).toBe(false);
    });
  });

  describe("countdownLabel", () => {
    it("returns finalizado for 0 days", () => {
      expect(engine.countdownLabel(0)).toBe("Tu prueba ha finalizado");
    });

    it("returns 1 dia for 1 day", () => {
      expect(engine.countdownLabel(1)).toBe("Te queda 1 día");
    });

    it("returns plural for multiple days", () => {
      expect(engine.countdownLabel(5)).toBe("Te quedan 5 días");
    });
  });

  describe("getPlanPeriodDays", () => {
    it("returns 30 for monthly", () => {
      expect(engine.getPlanPeriodDays("monthly")).toBe(30);
    });

    it("returns 420 for yearly (14 months)", () => {
      expect(engine.getPlanPeriodDays("yearly")).toBe(420);
    });
  });

  describe("canStartTrial", () => {
    it("returns true when trial never used", () => {
      expect(engine.canStartTrial(null)).toBe(true);
      expect(engine.canStartTrial(undefined)).toBe(true);
    });

    it("returns false when trial already used", () => {
      const used = new Date("2024-01-01T00:00:00Z");
      expect(engine.canStartTrial(used)).toBe(false);
    });
  });

  describe("isPaymentAlreadyProcessed", () => {
    it("returns true for approved", () => {
      expect(engine.isPaymentAlreadyProcessed("approved")).toBe(true);
    });

    it("returns true for declined", () => {
      expect(engine.isPaymentAlreadyProcessed("declined")).toBe(true);
    });

    it("returns false for pending", () => {
      expect(engine.isPaymentAlreadyProcessed("pending")).toBe(false);
    });

    it("returns false for error", () => {
      expect(engine.isPaymentAlreadyProcessed("error")).toBe(false);
    });
  });

  describe("isTotalRefund", () => {
    it("returns true for exact match", () => {
      expect(engine.isTotalRefund(100, 100)).toBe(true);
    });

    it("returns true for over-refund", () => {
      expect(engine.isTotalRefund(150, 100)).toBe(true);
    });

    it("returns false for partial refund", () => {
      expect(engine.isTotalRefund(50, 100)).toBe(false);
    });
  });

  describe("calculateRenewalDate", () => {
    it("adds 30 days for monthly", () => {
      const base = new Date(Date.UTC(2024, 0, 15)); // Jan 15, 2024
      const result = engine.calculateRenewalDate(base, "monthly");
      expect(result.getUTCDate()).toBe(14);
      expect(result.getUTCMonth()).toBe(1); // February
    });

    it("adds 420 days for yearly", () => {
      const base = new Date(Date.UTC(2024, 0, 15)); // Jan 15, 2024
      const result = engine.calculateRenewalDate(base, "yearly");
      expect(result.getUTCMonth()).toBe(2); // March
      expect(result.getUTCDate()).toBe(10);
    });
  });

  describe("createAuditEntry", () => {
    it("creates a valid audit entry", () => {
      const entry = engine.createAuditEntry(
        "b1",
        "SUBSCRIPTION_ACTIVATED",
        "payment_provider",
        "user123",
        { plan: "monthly", paymentId: "p1" },
        new Date("2024-01-15T00:00:00Z")
      );

      expect(entry.id).toBeTruthy();
      expect(entry.businessId).toBe("b1");
      expect(entry.action).toBe("SUBSCRIPTION_ACTIVATED");
      expect(entry.actorType).toBe("payment_provider");
      expect(entry.actorId).toBe("user123");
      expect(entry.details).toEqual({ plan: "monthly", paymentId: "p1" });
      expect(entry.createdAt).toEqual(new Date("2024-01-15T00:00:00Z"));
    });
  });
});
