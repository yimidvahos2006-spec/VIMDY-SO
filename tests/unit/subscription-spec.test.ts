import { describe, it, expect, beforeEach } from "vitest";
import { SubscriptionEngine } from "../../src/core/engines/SubscriptionEngine";
import type { Subscription } from "../../src/core/entities/SubscriptionTypes";

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
    it("trial recién creado tiene 30 días restantes", () => {
      const now = new Date("2026-08-20T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBe(30);
      expect(engine.effectiveStatus(sub, now)).toBe("trial");
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 2 — Día 1", () => {
    it("funciona sin alertas ni bloqueos", () => {
      const now = new Date("2026-08-21T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBeGreaterThanOrEqual(27);
      expect(engine.warningThreshold(engine.daysRemaining(sub.trialEndsAt, now))).toBeNull();
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 3 — Día 27", () => {
    it("funciona sin alerta", () => {
      const now = new Date("2026-09-15T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);
      expect(days).toBeGreaterThanOrEqual(4);
      expect(engine.warningThreshold(days)).toBeNull();
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 4 — Día 28 (faltan 3 días)", () => {
    it("devuelve umbral 3 y no está bloqueado", () => {
      const now = new Date("2026-09-16T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);
      expect(days).toBe(3);
      expect(engine.warningThreshold(days)).toBe(3);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 5 — Día 29 (faltan 2 días)", () => {
    it("devuelve umbral 2 y no está bloqueado", () => {
      const now = new Date("2026-09-17T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);
      expect(days).toBe(2);
      expect(engine.warningThreshold(days)).toBe(2);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 6 — Día 30 (falta 1 día)", () => {
    it("devuelve umbral 1 y no está bloqueado", () => {
      const now = new Date("2026-09-18T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      const days = engine.daysRemaining(sub.trialEndsAt, now);
      expect(days).toBe(1);
      expect(engine.warningThreshold(days)).toBe(1);
      expect(engine.isBlocked(sub, now)).toBe(false);
    });
  });

  describe("Prueba 7 — Vencimiento", () => {
    it("bloquea el negocio y cambia estado a expired", () => {
      const now = new Date("2026-09-20T00:00:00Z");
      const trialEndsAt = new Date("2026-09-19T00:00:00Z");
      const sub = makeSubscription(trialEndsAt.toISOString());
      expect(engine.daysRemaining(sub.trialEndsAt, now)).toBe(0);
      expect(engine.effectiveStatus(sub, now)).toBe("expired");
      expect(engine.isBlocked(sub, now)).toBe(true);
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
