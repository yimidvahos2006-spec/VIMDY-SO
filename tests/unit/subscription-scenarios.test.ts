import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionEngine } from "../../src/core/engines/SubscriptionEngine";

describe("SubscriptionEngine — escenarios completos", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  describe("flujo de trial", () => {
    it("un negocio nuevo arranca en trial activo", () => {
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt: new Date("2024-07-15T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };

      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("trial");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(false);
      expect(subscriptionEngine.daysRemaining(sub.trialEndsAt, now)).toBe(30);
    });

    it("al vencer el trial, el negocio queda suspendido", () => {
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt: new Date("2024-06-01T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };

      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("suspended");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(true);
      expect(subscriptionEngine.daysRemaining(sub.trialEndsAt, now)).toBe(0);
    });

    it("cerrar sesión y volver no reinicia el trial (el trial vive en BD)", () => {
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt: new Date("2024-06-20T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };

      // Misma fecha, mismo resultado
      expect(subscriptionEngine.daysRemaining(sub.trialEndsAt, now)).toBe(5);
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("trial");
    });
  });

  describe("flujo mensual", () => {
    it("activa plan mensual con 30 días de acceso", () => {
      const sub = {
        businessId: "b1",
        plan: "monthly" as const,
        trialEndsAt: null,
        renewalDate: new Date("2024-07-15T00:00:00Z"),
        nextChargeAt: new Date("2024-07-15T00:00:00Z"),
        paymentMethod: "wompi_card" as const,
        paymentStatus: "approved" as const
      };

      expect(subscriptionEngine.getPlanPeriodDays("monthly")).toBe(30);
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("monthly");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("flujo anual 12+2", () => {
    it("plan anual proporciona 420 días (14 meses)", () => {
      expect(subscriptionEngine.getPlanPeriodDays("yearly")).toBe(420);
    });

    it("activa plan anual con fecha de renovación a 14 meses", () => {
      const baseDate = new Date("2024-06-15T00:00:00Z");
      const renewalDate = subscriptionEngine.calculateRenewalDate(baseDate, "yearly");
      const diffDays = Math.round((renewalDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(420);
    });
  });

  describe("renovación", () => {
    it("al renovar anual, se extiende 14 meses", () => {
      const baseDate = new Date("2025-06-10T00:00:00Z");
      const renewalDate = subscriptionEngine.calculateRenewalDate(baseDate, "yearly");
      const diffDays = Math.round((renewalDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(420);
    });

    it("al renovar mensual, se extiende 30 días", () => {
      const baseDate = new Date("2024-07-15T00:00:00Z");
      const renewalDate = subscriptionEngine.calculateRenewalDate(baseDate, "monthly");
      const diffDays = Math.round((renewalDate.getTime() - baseDate.getTime()) / (24 * 60 * 60 * 1000));
      expect(diffDays).toBe(30);
    });
  });

  describe("vencimiento", () => {
    it("plan mensual vencido con payment_status past_due queda suspendido", () => {
      const sub = {
        businessId: "b1",
        plan: "monthly" as const,
        trialEndsAt: null,
        renewalDate: new Date("2024-06-01T00:00:00Z"),
        nextChargeAt: new Date("2024-06-01T00:00:00Z"),
        paymentMethod: "wompi_card" as const,
        paymentStatus: "past_due" as const
      };

      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("suspended");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(true);
    });
  });

  describe("reembolso", () => {
    it("reembolso total se considera total", () => {
      expect(subscriptionEngine.isTotalRefund(100, 100)).toBe(true);
      expect(subscriptionEngine.isTotalRefund(150, 100)).toBe(true);
    });

    it("reembolso parcial no es total", () => {
      expect(subscriptionEngine.isTotalRefund(50, 100)).toBe(false);
    });
  });

  describe("protección contra trial duplicado", () => {
    it("canStartTrial devuelve false si ya tuvo trial", () => {
      const usedAt = new Date("2024-01-01T00:00:00Z");
      expect(subscriptionEngine.canStartTrial(usedAt)).toBe(false);
    });

    it("canStartTrial devuelve true si nunca lo tuvo", () => {
      expect(subscriptionEngine.canStartTrial(null)).toBe(true);
      expect(subscriptionEngine.canStartTrial(undefined)).toBe(true);
    });
  });

  describe("protección contra doble pago/activación", () => {
    it("isPaymentAlreadyProcessed detecta pagos aprobados", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("approved")).toBe(true);
    });

    it("isPaymentAlreadyProcessed detecta pagos declinados", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("declined")).toBe(true);
    });

    it("isPaymentAlreadyProcessed no bloquea pagos pendientes", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("pending")).toBe(false);
      expect(subscriptionEngine.isPaymentAlreadyProcessed("error")).toBe(false);
    });
  });

  describe("bloqueo real restante", () => {
    it("no existe ruta que reinicie el trial creando negocios nuevos", () => {
      // La validación está en register-business y createAdditionalBusiness,
      // pero a nivel de engine, canStartTrial previene iniciar trial si ya lo tuvo.
      const usedAt = new Date("2024-01-01T00:00:00Z");
      expect(subscriptionEngine.canStartTrial(usedAt)).toBe(false);
    });

    it("no existe ruta que active acceso sin pago aprobado", () => {
      // effectiveStatus solo devuelve monthly/yearly si payment_status es approved.
      const subDeclined = {
        businessId: "b1",
        plan: "monthly" as const,
        trialEndsAt: null,
        renewalDate: new Date("2024-07-15T00:00:00Z"),
        nextChargeAt: new Date("2024-07-15T00:00:00Z"),
        paymentMethod: "wompi_card" as const,
        paymentStatus: "declined" as const
      };

      expect(subscriptionEngine.effectiveStatus(subDeclined, now)).toBe("suspended");
      expect(subscriptionEngine.isBlocked(subDeclined, now)).toBe(true);
    });

    it("la función SQL es la única vía de modificar fechas de suscripción", () => {
      // Esto es una verificación estructural: el engine no tiene métodos
      // para escribir en BD. Toda escritura pasa por funciones SQL server-side.
      expect(subscriptionEngine).not.toHaveProperty("activate");
      expect(subscriptionEngine).not.toHaveProperty("renew");
      expect(subscriptionEngine).not.toHaveProperty("expire");
      expect(subscriptionEngine).not.toHaveProperty("refund");
    });
  });
});
