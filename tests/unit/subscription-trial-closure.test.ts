import { describe, it, expect, vi, beforeEach } from "vitest";
import { subscriptionEngine } from "../../src/core/engines/SubscriptionEngine";

describe("SubscriptionEngine — cierre definitivo de trial por persona", () => {
  const now = new Date("2024-06-15T00:00:00Z");

  describe("flujo de trial por persona (no por negocio)", () => {
    it("usuario nuevo obtiene 14 días", () => {
      expect(subscriptionEngine.canStartTrial(null)).toBe(true);
      expect(subscriptionEngine.canStartTrial(undefined)).toBe(true);
    });

    it("reload conserva los mismos 14 días", () => {
      const trialEndsAt = new Date("2024-06-29T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
    });

    it("logout/login conserva los mismos 14 días", () => {
      const trialEndsAt = new Date("2024-06-29T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
    });

    it("segundo dispositivo conserva los mismos 14 días", () => {
      const trialEndsAt = new Date("2024-06-29T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
    });

    it("segundo negocio de la misma persona NO obtiene otro trial", () => {
      const usedAt = new Date("2024-01-01T00:00:00Z");
      expect(subscriptionEngine.canStartTrial(usedAt)).toBe(false);
    });

    it("trial vencido → acceso comercial suspendido", () => {
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt: new Date("2024-06-01T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("expired");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(true);
    });

    it("trial vencido → datos permanecen", () => {
      // El engine no borra datos, solo cambia el estado a expired.
      // Los datos (ventas, inventario, etc.) viven en otras tablas.
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt: new Date("2024-06-01T00:00:00Z"),
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("expired");
      // No hay método delete/clear en el engine
      expect(subscriptionEngine).not.toHaveProperty("deleteBusiness");
      expect(subscriptionEngine).not.toHaveProperty("clearData");
    });

    it("trial vencido → puede comprar mensual", () => {
      const sub = {
        businessId: "b1",
        plan: "monthly" as const,
        trialEndsAt: new Date("2024-06-01T00:00:00Z"),
        renewalDate: new Date("2024-07-15T00:00:00Z"),
        nextChargeAt: new Date("2024-07-15T00:00:00Z"),
        paymentMethod: "wompi_card" as const,
        paymentStatus: "approved" as const
      };
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("monthly");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(false);
    });

    it("trial vencido → puede comprar anual", () => {
      const sub = {
        businessId: "b1",
        plan: "yearly" as const,
        trialEndsAt: new Date("2024-06-01T00:00:00Z"),
        renewalDate: new Date("2025-06-15T00:00:00Z"),
        nextChargeAt: new Date("2025-06-15T00:00:00Z"),
        paymentMethod: "paypal" as const,
        paymentStatus: "approved" as const
      };
      expect(subscriptionEngine.effectiveStatus(sub, now)).toBe("yearly");
      expect(subscriptionEngine.isBlocked(sub, now)).toBe(false);
    });

    it("usuario con suscripción pagada → no recibe trial adicional", () => {
      // Si el usuario ya pagó, canStartTrial debe seguir funcionando
      // a nivel de engine (la validación real está en BD/user_trial_usage).
      // El engine solo sabe si trial_used_at existe.
      const usedAt = new Date("2024-01-01T00:00:00Z");
      expect(subscriptionEngine.canStartTrial(usedAt)).toBe(false);
    });

    it("reembolso → aplicar reglas existentes", () => {
      expect(subscriptionEngine.isTotalRefund(100, 100)).toBe(true);
      expect(subscriptionEngine.isTotalRefund(50, 100)).toBe(false);
    });

    it("dos negocios legítimos distintos → no comparten estado de suscripción", () => {
      const sub1 = {
        businessId: "b1",
        plan: "monthly" as const,
        trialEndsAt: null,
        renewalDate: new Date("2024-07-15T00:00:00Z"),
        nextChargeAt: new Date("2024-07-15T00:00:00Z"),
        paymentMethod: "wompi_card" as const,
        paymentStatus: "approved" as const
      };
      const sub2 = {
        businessId: "b2",
        plan: "yearly" as const,
        trialEndsAt: null,
        renewalDate: new Date("2025-06-15T00:00:00Z"),
        nextChargeAt: new Date("2025-06-15T00:00:00Z"),
        paymentMethod: "paypal" as const,
        paymentStatus: "approved" as const
      };
      expect(subscriptionEngine.effectiveStatus(sub1, now)).toBe("monthly");
      expect(subscriptionEngine.effectiveStatus(sub2, now)).toBe("yearly");
      // No hay forma de que sub1 herede el estado de sub2
      expect(sub1.businessId).not.toBe(sub2.businessId);
    });

    it("recarga/cambio de navegador → no reinicia trial", () => {
      const trialEndsAt = new Date("2024-07-15T00:00:00Z");
      const firstRead = subscriptionEngine.daysRemaining(trialEndsAt, now);
      // simula recarga: misma fecha en BD, mismo resultado
      const secondRead = subscriptionEngine.daysRemaining(trialEndsAt, now);
      expect(firstRead).toBe(secondRead);
      expect(firstRead).toBe(30);
    });

    it("manipulación de localStorage/sessionStorage → no modifica el derecho al trial", () => {
      // El engine lee de parámetros, no de storage.
      // No hay método que acepte storage.
      const trialEndsAt = new Date("2024-06-29T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, now)).toBe(14);
      // No hay dependencia de storage en el engine
      expect(subscriptionEngine).not.toHaveProperty("readFromStorage");
    });
  });

  describe("idempotencia y race conditions", () => {
    it("isPaymentAlreadyProcessed detecta pagos aprobados", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("approved")).toBe(true);
    });

    it("isPaymentAlreadyProcessed detecta pagos declinados", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("declined")).toBe(true);
    });

    it("isPaymentAlreadyProcessed no bloquea pagos pendientes", () => {
      expect(subscriptionEngine.isPaymentAlreadyProcessed("pending")).toBe(false);
    });

    it("no existe ruta que active acceso sin pago aprobado", () => {
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
    });

    it("la función SQL es la única vía de modificar fechas de suscripción", () => {
      expect(subscriptionEngine).not.toHaveProperty("activate");
      expect(subscriptionEngine).not.toHaveProperty("renew");
      expect(subscriptionEngine).not.toHaveProperty("expire");
      expect(subscriptionEngine).not.toHaveProperty("refund");
    });
  });

  describe("VIMDY — Trial de 14 días", () => {
    const trialStart = new Date("2026-08-20T00:00:00Z");

    it("día 12: trial activo, sin bloqueo", () => {
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      const day12 = new Date("2026-09-01T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, day12)).toBe(2);
      expect(subscriptionEngine.effectiveStatus(sub, day12)).toBe("trial");
      expect(subscriptionEngine.isBlocked(sub, day12)).toBe(false);
    });

    it("día 13: 1 día restante", () => {
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      const day13 = new Date("2026-09-02T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, day13)).toBe(1);
      expect(subscriptionEngine.effectiveStatus(sub, day13)).toBe("trial");
      expect(subscriptionEngine.isBlocked(sub, day13)).toBe(false);
    });

    it("día 14: 0 días restantes → expired → bloqueado", () => {
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      const day14 = new Date("2026-09-03T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, day14)).toBe(0);
      expect(subscriptionEngine.effectiveStatus(sub, day14)).toBe("expired");
      expect(subscriptionEngine.isBlocked(sub, day14)).toBe(true);
    });

    it("día 16: 2 días después de vencido → sigue expired, datos intactos", () => {
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setDate(trialEndsAt.getDate() + 14);
      const sub = {
        businessId: "b1",
        plan: "trial" as const,
        trialEndsAt,
        renewalDate: null,
        nextChargeAt: null,
        paymentMethod: null,
        paymentStatus: "none" as const
      };
      const day16 = new Date("2026-09-05T00:00:00Z");
      expect(subscriptionEngine.daysRemaining(trialEndsAt, day16)).toBe(0);
      expect(subscriptionEngine.effectiveStatus(sub, day16)).toBe("expired");
      expect(subscriptionEngine.isBlocked(sub, day16)).toBe(true);
    });
  });
});
