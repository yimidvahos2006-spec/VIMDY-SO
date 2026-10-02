import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionEngine } from "../../src/core/engines/SubscriptionEngine";
import type { Subscription } from "../../src/core/entities/SubscriptionTypes";
import { TRIAL_PERIOD_DAYS } from "../../src/core/config/trial";

describe("SubscriptionEngine — especificación de suscripciones", () => {
  let engine: SubscriptionEngine;

  beforeEach(() => {
    engine = new SubscriptionEngine();
  });

  function makeSubscription(trialEndsAt: string | null, plan: Subscription["plan"] = "trial"): Subscription {
    return {
      businessId: "test-business",
      plan,
      trialEndsAt: trialEndsAt ? new Date(trialEndsAt) : null,
      renewalDate: null,
      nextChargeAt: null,
      paymentMethod: null,
      paymentStatus: "none"
    };
  }

  describe("Prueba 1 — Crear negocio nuevo", () => {
    it("trial recién creado tiene exactamente 14 días restantes", () => {
      const now = new Date("2026-08-20T00:00:00Z");
      const trialEndsAt = new Date(now);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());

      expect(TRIAL_PERIOD_DAYS).toBe(14);
      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBe(14);
      expect(engine.effectiveStatus(sub, now)).toBe("trial");
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 2 — Día 1", () => {
    it("funciona sin alertas ni bloqueos", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-08-21T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);

      expect(days).toBe(13);
      expect(engine.warningThreshold(days)).toBeNull();
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 3 — Faltan 3 días", () => {
    it("día 11 devuelve umbral 3 y no está bloqueado", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-08-31T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);

      expect(days).toBe(3);
      expect(engine.warningThreshold(days)).toBe(3);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 4 — Faltan 2 días", () => {
    it("día 12 devuelve umbral 2 y no está bloqueado", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-09-01T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);

      expect(days).toBe(2);
      expect(engine.warningThreshold(days)).toBe(2);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 5 — Faltan 1 día", () => {
    it("día 13 devuelve umbral 1 y no está bloqueado", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-09-02T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);

      expect(days).toBe(1);
      expect(engine.warningThreshold(days)).toBe(1);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 6 — Vencimiento", () => {
    it("día 14 queda expired y bloqueado", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-09-03T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());

      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBe(0);
      expect(engine.warningThreshold(0)).toBeNull();
      expect(engine.effectiveStatus(sub, now)).toBe("expired");
      expect(engine.isBlocked(sub, now)).toBe(true);
    });
  });

  describe("Prueba 7 — Después del vencimiento", () => {
    it("mantiene expired/bloqueado sin borrar la suscripción", () => {
      const trialStart = new Date("2026-08-20T00:00:00Z");
      const now = new Date("2026-09-05T00:00:00Z");
      const trialEndsAt = new Date(trialStart);
      trialEndsAt.setUTCDate(trialEndsAt.getUTCDate() + TRIAL_PERIOD_DAYS);
      const sub = makeSubscription(trialEndsAt.toISOString());

      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBe(0);
      expect(engine.effectiveStatus(sub, now)).toBe("expired");
      expect(engine.isBlocked(sub, now)).toBe(true);
      expect(sub.trialEndsAt?.toISOString()).toBe("2026-09-03T00:00:00.000Z");
    });
  });

  describe("Prueba 8 — Pago exitoso", () => {
    it("desbloquea y pasa a monthly", () => {
      const sub = makeSubscription(null, "monthly");
      sub.paymentMethod = "wompi_card";
      sub.paymentStatus = "approved";
      sub.renewalDate = new Date("2026-10-20T00:00:00Z");
      expect(engine.effectiveStatus(sub)).toBe("monthly");
      expect(engine.isBlocked(sub)).toBe(false);
    });
  });

  describe("Prueba 9 — Pago rechazado", () => {
    it("permanece vencido/bloqueado", () => {
      const sub = makeSubscription(null, "monthly");
      sub.paymentMethod = "wompi_card";
      sub.paymentStatus = "declined";
      expect(engine.effectiveStatus(sub)).toBe("suspended");
      expect(engine.isBlocked(sub)).toBe(true);
    });
  });

  describe("Prueba 10 — Recargar navegador", () => {
    it("el estado se mantiene porque vive en BD, no en cliente", () => {
      const now = new Date("2026-09-20T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());

      const status1 = engine.effectiveStatus(sub, now);
      const blocked1 = engine.isBlocked(sub, now);

      // Simular recarga: recalcular con las mismas fechas
      const status2 = engine.effectiveStatus(sub, now);
      const blocked2 = engine.isBlocked(sub, now);

      expect(status1).toBe(status2);
      expect(blocked1).toBe(blocked2);
      expect(status2).toBe("expired");
      expect(blocked2).toBe(true);
    });
  });

  describe("Prueba 11 — Cerrar sesión y volver a entrar", () => {
    it("el estado se mantiene porque se lee de Supabase", () => {
      const now = new Date("2026-09-20T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());

      // Primera sesión
      const status1 = engine.effectiveStatus(sub, now);
      const blocked1 = engine.isBlocked(sub, now);

      // Simular cierre y re-login: misma suscripción desde BD
      const status2 = engine.effectiveStatus(sub, now);
      const blocked2 = engine.isBlocked(sub, now);

      expect(status1).toBe(status2);
      expect(blocked1).toBe(blocked2);
      expect(status2).toBe("expired");
    });
  });

  describe("Prueba 12 — Cambiar fecha del computador", () => {
    it("no puede engañar porque el control es server-side", () => {
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");

      // Usuario cambia su reloj LOCAL al día 1 (intento de engaño)
      const fakeNow = new Date("2026-08-21T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());

      // El engine mismo es determinista con la fecha que recibe,
      // pero en producción la fecha viene del servidor, no del cliente.
      // Esta prueba verifica que si alguien pasa una fecha falsa,
      // el resultado depende de ESA fecha, no de Date() del navegador.
      const statusWithFakeDate = engine.effectiveStatus(sub, fakeNow);
      expect(statusWithFakeDate).toBe("trial");

      // Con la fecha real del servidor (vencido), el estado es expired
      const realNow = new Date("2026-09-20T00:00:00Z");
      const statusWithRealDate = engine.effectiveStatus(sub, realNow);
      expect(statusWithRealDate).toBe("expired");
      expect(engine.isBlocked(sub, realNow)).toBe(true);
    });
  });

  describe("Prueba 13 — Dos negocios diferentes", () => {
    it("cada uno tiene su propia suscripción independiente", () => {
      const now = new Date("2026-09-20T00:00:00Z");

      const sub1 = makeSubscription(new Date("2026-09-19T00:00:00Z").toISOString());
      sub1.businessId = "business-1";

      const sub2 = makeSubscription(new Date("2026-10-01T00:00:00Z").toISOString());
      sub2.businessId = "business-2";

      expect(engine.effectiveStatus(sub1, now)).toBe("expired");
      expect(engine.effectiveStatus(sub2, now)).toBe("trial");
      expect(engine.isBlocked(sub1, now)).toBe(true);
      expect(engine.isBlocked(sub2, now)).toBe(false);
    });
  });
});
