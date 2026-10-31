import { describe, it, expect } from "vitest";
import {
  SUBSCRIPTION_STATUS_PRESENTATION,
  buildSubscriptionCardModel,
  formatSubscriptionDate
} from "../../src/core/settings/subscriptionCardModel";
import { subscriptionEngine } from "../../src/core/engines/SubscriptionEngine";
import type { Subscription, SubscriptionStatus } from "../../src/core/entities/SubscriptionTypes";

const ALL_STATUSES: SubscriptionStatus[] = ["trial", "monthly", "yearly", "expired", "suspended"];

const NOW = new Date("2026-10-30T15:00:00Z");

function subscription(overrides: Partial<Subscription>): Subscription {
  return {
    businessId: "b1",
    plan: "trial",
    trialEndsAt: null,
    renewalDate: null,
    nextChargeAt: null,
    paymentMethod: null,
    paymentStatus: "none",
    ...overrides
  };
}

/** Arma el modelo igual que useSubscription: estado efectivo + días del motor. */
function modelFor(sub: Subscription) {
  const status = subscriptionEngine.effectiveStatus(sub, NOW);
  const relevantDate = sub.plan === "trial" ? sub.trialEndsAt : sub.renewalDate;
  return buildSubscriptionCardModel({
    status,
    daysRemaining: subscriptionEngine.daysRemaining(relevantDate, NOW),
    trialEndsAt: sub.trialEndsAt,
    renewalDate: sub.renewalDate,
    nextChargeAt: sub.nextChargeAt
  });
}

describe("tarjeta Suscripción — textos por estado", () => {
  it("los 5 estados efectivos tienen texto y color (antes 'expired' no tenía y el contador fallaba)", () => {
    for (const status of ALL_STATUSES) {
      const presentation = SUBSCRIPTION_STATUS_PRESENTATION[status];
      expect(presentation, status).toBeDefined();
      expect(presentation.planLabel.length).toBeGreaterThan(0);
      expect(presentation.eyebrow.length).toBeGreaterThan(0);
      expect(["warning", "accent", "danger"]).toContain(presentation.tone);
    }
  });

  it("solo la prueba gratuita usa la cuenta regresiva del motor en el contador", () => {
    expect(SUBSCRIPTION_STATUS_PRESENTATION.trial.badgeLabel).toBeNull();
    for (const status of ALL_STATUSES.filter((s) => s !== "trial")) {
      expect(SUBSCRIPTION_STATUS_PRESENTATION[status].badgeLabel).not.toBeNull();
    }
  });
});

describe("tarjeta Suscripción — plan, vencimiento y días", () => {
  it("sin suscripción cargada muestra guiones y ningún aviso", () => {
    const model = buildSubscriptionCardModel({
      status: null,
      daysRemaining: 0,
      trialEndsAt: null,
      renewalDate: null,
      nextChargeAt: null
    });
    expect(model.planLabel).toBe("—");
    expect(model.tone).toBeNull();
    expect(model.expirationDate).toBeNull();
    expect(model.daysLabel).toBe("—");
    expect(model.notice).toBeNull();
  });

  it("prueba gratuita con 14 días: plan, fecha de vencimiento y días restantes", () => {
    const trialEndsAt = new Date("2026-11-13T15:00:00Z");
    const model = modelFor(subscription({ plan: "trial", trialEndsAt }));
    expect(model.planLabel).toBe("🟢 Prueba Gratuita");
    expect(model.expirationLabel).toBe("Vence");
    expect(model.expirationDate).toEqual(trialEndsAt);
    expect(model.daysLabel).toBe("14 días");
    expect(model.notice).toBeNull();
  });

  it("prueba con 1 día usa el singular", () => {
    const model = modelFor(subscription({ plan: "trial", trialEndsAt: new Date("2026-10-31T15:00:00Z") }));
    expect(model.daysLabel).toBe("1 día");
  });

  it("prueba vencida: 'Prueba finalizada', 0 días y aviso para activar un plan", () => {
    const trialEndsAt = new Date("2026-10-30T02:00:00Z");
    const model = modelFor(subscription({ plan: "trial", trialEndsAt }));
    expect(model.planLabel).toBe("🟠 Prueba finalizada");
    expect(model.tone).toBe("danger");
    expect(model.expirationLabel).toBe("Venció");
    expect(model.expirationDate).toEqual(trialEndsAt);
    expect(model.daysLabel).toBe("0 días");
    expect(model.notice).toMatch(/activa un plan/i);
  });

  it("plan mensual activo: muestra los días reales hasta la próxima renovación (antes decía solo 'Plan activo')", () => {
    const renewalDate = new Date("2026-11-29T15:00:00Z");
    const model = modelFor(
      subscription({ plan: "monthly", renewalDate, paymentMethod: "wompi_card", paymentStatus: "approved" })
    );
    expect(model.planLabel).toBe("🔵 Plan Mensual");
    expect(model.expirationLabel).toBe("Próxima renovación");
    expect(model.expirationDate).toEqual(renewalDate);
    expect(model.daysLabel).toBe("30 días");
  });

  it("plan anual activo usa la renovación y, si falta, la fecha del próximo cobro", () => {
    const nextChargeAt = new Date("2027-10-30T15:00:00Z");
    const model = buildSubscriptionCardModel({
      status: "yearly",
      daysRemaining: 365,
      trialEndsAt: null,
      renewalDate: null,
      nextChargeAt
    });
    expect(model.planLabel).toBe("🟣 Plan Anual");
    expect(model.expirationDate).toEqual(nextChargeAt);
    expect(model.daysLabel).toBe("365 días");
  });

  it("plan pagado sin ninguna fecha no inventa días", () => {
    const model = buildSubscriptionCardModel({
      status: "monthly",
      daysRemaining: 0,
      trialEndsAt: null,
      renewalDate: null,
      nextChargeAt: null
    });
    expect(model.expirationDate).toBeNull();
    expect(model.daysLabel).toBe("—");
  });

  it("pago rechazado: 'Suspendido', 'Pago pendiente' y aviso de reactivación", () => {
    const renewalDate = new Date("2026-10-20T15:00:00Z");
    const model = modelFor(
      subscription({ plan: "monthly", renewalDate, paymentStatus: "past_due", paymentMethod: "wompi_card" })
    );
    expect(model.planLabel).toBe("🔴 Suspendido");
    expect(model.tone).toBe("danger");
    expect(model.expirationLabel).toBe("Venció");
    expect(model.expirationDate).toEqual(renewalDate);
    expect(model.daysLabel).toBe("Pago pendiente");
    expect(model.notice).toMatch(/reactivar/i);
  });

  it("fechas inválidas se tratan como ausentes", () => {
    const model = buildSubscriptionCardModel({
      status: "trial",
      daysRemaining: 5,
      trialEndsAt: new Date("no es una fecha"),
      renewalDate: null,
      nextChargeAt: null
    });
    expect(model.expirationDate).toBeNull();
    expect(model.daysLabel).toBe("—");
  });
});

describe("formatSubscriptionDate", () => {
  it("usa la zona horaria del negocio (01:30 UTC del 14 sigue siendo el 13 en Bogotá)", () => {
    const date = new Date("2026-11-14T01:30:00Z");
    expect(formatSubscriptionDate(date, "America/Bogota")).toBe("13 de noviembre de 2026");
    expect(formatSubscriptionDate(date, "UTC")).toBe("14 de noviembre de 2026");
  });

  it("devuelve guion si no hay fecha o es inválida", () => {
    expect(formatSubscriptionDate(null, "America/Bogota")).toBe("—");
    expect(formatSubscriptionDate(new Date("x"), "America/Bogota")).toBe("—");
  });

  it("una zona horaria inválida no rompe la pantalla", () => {
    const date = new Date("2026-11-14T12:00:00Z");
    expect(() => formatSubscriptionDate(date, "Mundo/Inexistente")).not.toThrow();
    expect(formatSubscriptionDate(date, "Mundo/Inexistente")).toMatch(/2026/);
  });
});