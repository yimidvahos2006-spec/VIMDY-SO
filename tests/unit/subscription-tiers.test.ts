import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { functions: { invoke: invokeMock } }
}));

import {
  BRANCH_MANAGEMENT_HINT,
  BRANCH_MANAGEMENT_PATH,
  BUSINESS_TIERS,
  SUBSCRIPTION_PLANS,
  SUBSCRIPTION_PLANS_BY_TIER,
  TIER_DEFINITIONS,
  getPlanPrice,
  isBusinessTier,
  isTierAvailable
} from "../../src/core/entities/SubscriptionTypes";
import { GlobalPaymentRouter } from "../../src/core/payments/GlobalPaymentRouter";
import { PaymentValidator } from "../../src/core/payments/PaymentValidator";
import { WompiProvider } from "../../src/core/payments/providers/wompi/WompiProvider";

const readSource = (...segments: string[]): string =>
  readFileSync(join(process.cwd(), ...segments), "utf-8");

const baseInput = {
  businessId: "biz-1",
  country: "CO",
  businessType: "suscripcion_vimdy"
} as const;

describe("precios por nivel de negocio", () => {
  it("1 sede en Colombia: $59.900 mensual y $599.000 anual", () => {
    expect(getPlanPrice("monthly", "CO", "single")).toBe(59900);
    expect(getPlanPrice("yearly", "CO", "single")).toBe(599000);
  });

  it("multi-sucursal en Colombia: $110.900 mensual y $1.109.000 anual", () => {
    expect(getPlanPrice("monthly", "CO", "multi")).toBe(110900);
    expect(getPlanPrice("yearly", "CO", "multi")).toBe(1109000);
  });

  it("el plan anual de cada nivel equivale a pagar 10 meses y usar 12", () => {
    for (const tier of BUSINESS_TIERS) {
      expect(getPlanPrice("yearly", "CO", tier)).toBe(getPlanPrice("monthly", "CO", tier) * 10);
    }
  });

  it("multi-sucursal NO tiene precio fuera de Colombia (no se inventa)", () => {
    for (const country of ["US", "MX", "PE", "CL", "AR", "EC", "PA", "VE", "ES", "BR"]) {
      expect(isTierAvailable("multi", country)).toBe(false);
      expect(getPlanPrice("monthly", country, "multi")).toBe(0);
      expect(getPlanPrice("yearly", country, "multi")).toBe(0);
    }
    expect(isTierAvailable("multi", "CO")).toBe(true);
    expect(isTierAvailable("single", "US")).toBe(true);
  });

  it("los precios del catálogo coinciden con los precios canónicos de Colombia", () => {
    for (const tier of BUSINESS_TIERS) {
      for (const plan of SUBSCRIPTION_PLANS_BY_TIER[tier]) {
        expect(plan.tier).toBe(tier);
        expect(plan.currency).toBe("COP");
        expect(plan.price).toBe(getPlanPrice(plan.id, "CO", tier));
      }
    }
  });

  it("SUBSCRIPTION_PLANS sigue siendo el catálogo de 1 sede", () => {
    expect(SUBSCRIPTION_PLANS).toBe(SUBSCRIPTION_PLANS_BY_TIER.single);
  });

  it("isBusinessTier solo acepta los dos niveles", () => {
    expect(isBusinessTier("single")).toBe(true);
    expect(isBusinessTier("multi")).toBe(true);
    expect(isBusinessTier("enterprise")).toBe(false);
    expect(isBusinessTier(undefined)).toBe(false);
    expect(isBusinessTier(null)).toBe(false);
  });
});

describe("copy de los planes", () => {
  it("1 sede resalta POS ilimitado y control de inventario", () => {
    for (const plan of SUBSCRIPTION_PLANS_BY_TIER.single) {
      const text = plan.features.join(" ");
      expect(text).toContain("POS ilimitado");
      expect(text).toContain("inventario");
    }
  });

  it("multi-sucursal resalta reportes centralizados y sedes sincronizadas", () => {
    for (const plan of SUBSCRIPTION_PLANS_BY_TIER.multi) {
      const text = plan.features.join(" ");
      expect(text).toContain("Reportes centralizados");
      expect(text).toContain("sincronizadas");
    }
  });

  it("solo los planes anuales muestran el ahorro de 2 meses", () => {
    for (const tier of BUSINESS_TIERS) {
      const [monthly, yearly] = SUBSCRIPTION_PLANS_BY_TIER[tier];
      expect(monthly.id).toBe("monthly");
      expect(yearly.id).toBe("yearly");
      expect(monthly.savingsLabel).toBeUndefined();
      expect(yearly.savingsLabel).toBe("Ahorras 2 meses");
      expect(yearly.features.join(" ")).toContain("pagas 10 y usas 12");
      expect(monthly.features.join(" ")).not.toContain("pagas 10 y usas 12");
    }
  });

  it("indica que las sucursales se administran desde Configuración", () => {
    expect(BRANCH_MANAGEMENT_PATH).toContain("Configuración");
    expect(BRANCH_MANAGEMENT_HINT).toContain(BRANCH_MANAGEMENT_PATH);
    for (const plan of SUBSCRIPTION_PLANS_BY_TIER.multi) {
      expect(plan.features.join(" ")).toContain("Configuración");
    }
  });

  it("cada nivel tiene etiqueta y mensaje comercial", () => {
    expect(TIER_DEFINITIONS.single.label).toBe("Negocio de 1 sede");
    expect(TIER_DEFINITIONS.multi.label).toBe("Multi-Sucursal");
    expect(TIER_DEFINITIONS.multi.sublabel).toContain("2 o más sedes");
  });
});

describe("GlobalPaymentRouter — nivel de negocio", () => {
  it("sin tier cobra el precio de 1 sede", () => {
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly" });
    expect(request.tier).toBe("single");
    expect(request.amount).toBe(59900);
  });

  it("multi mensual cobra $110.900 y multi anual $1.109.000", () => {
    const monthly = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", tier: "multi" });
    const yearly = GlobalPaymentRouter.route({ ...baseInput, plan: "yearly", tier: "multi" });
    expect(monthly.request.tier).toBe("multi");
    expect(monthly.request.amount).toBe(110900);
    expect(yearly.request.amount).toBe(1109000);
    expect(monthly.provider).toBe("wompi");
  });

  it("rechaza un monto del navegador que no coincide con el precio del nivel", () => {
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", tier: "multi", amount: 59900 })
    ).toThrow(/monto no autorizado/);
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", tier: "multi", amount: 110900 })
    ).not.toThrow();
  });

  it("rechaza multi-sucursal donde no hay precio verificado", () => {
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, country: "MX", plan: "monthly", tier: "multi" })
    ).toThrow(/precio canónico válido/);
  });

  it("PaymentValidator rechaza un nivel desconocido", () => {
    expect(() =>
      PaymentValidator.validateRoutingInput({
        ...baseInput,
        plan: "monthly",
        tier: "enterprise" as unknown as "single"
      })
    ).toThrow(/nivel del negocio/);
  });
});

describe("WompiProvider — envía el nivel al servidor", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    invokeMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.wompi.co/p/?x=1", reference: "wompi_ref", existing: false },
      error: null
    });
  });

  it("manda tier=multi cuando el negocio eligió multi-sucursal (sin enviar monto)", async () => {
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "yearly", tier: "multi" });
    await new WompiProvider().createPayment(request);

    expect(invokeMock).toHaveBeenCalledTimes(1);
    const [functionName, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(functionName).toBe("wompi-create-checkout");
    expect(options.body).toEqual({ businessId: "biz-1", plan: "yearly", tier: "multi" });
  });

  it("manda tier=single por defecto", async () => {
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly" });
    await new WompiProvider().createPayment(request);

    const [, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({ businessId: "biz-1", plan: "monthly", tier: "single" });
  });
});

describe("wompi-create-checkout — el servidor decide el monto por nivel", () => {
  const edgeFunction = readSource("supabase", "functions", "wompi-create-checkout", "index.ts");

  it("define los precios de ambos niveles para Colombia", () => {
    expect(edgeFunction).toContain("single: { monthly: 59900, yearly: 599000 }");
    expect(edgeFunction).toContain("multi: { monthly: 110900, yearly: 1109000 }");
  });

  it("valida el nivel y toma el monto de la tabla del servidor", () => {
    expect(edgeFunction).toContain('INVALID_TIER');
    expect(edgeFunction).toContain("const tierPricing = pricing[tier];");
    expect(edgeFunction).toContain("const amount = tierPricing[plan];");
  });

  it("los precios del servidor coinciden con los del cliente", () => {
    const serverPrices = {
      singleMonthly: /single: \{ monthly: (\d+), yearly: (\d+) \}/.exec(edgeFunction),
      multi: /multi: \{ monthly: (\d+), yearly: (\d+) \}/.exec(edgeFunction)
    };
    expect(serverPrices.singleMonthly).not.toBeNull();
    expect(serverPrices.multi).not.toBeNull();
    expect(Number(serverPrices.singleMonthly![1])).toBe(getPlanPrice("monthly", "CO", "single"));
    expect(Number(serverPrices.singleMonthly![2])).toBe(getPlanPrice("yearly", "CO", "single"));
    expect(Number(serverPrices.multi![1])).toBe(getPlanPrice("monthly", "CO", "multi"));
    expect(Number(serverPrices.multi![2])).toBe(getPlanPrice("yearly", "CO", "multi"));
  });
});

describe("UI de planes", () => {
  it("UpgradeModal ofrece el selector solo donde hay multi-sucursal y manda el nivel al pago", () => {
    const modal = readSource("src", "presentation", "components", "subscription", "UpgradeModal.tsx");
    expect(modal).toContain("<BusinessTierSelector");
    expect(modal).toContain('isTierAvailable("multi", country)');
    expect(modal).toContain("tier: plan.tier,");
    expect(modal).toContain("BRANCH_MANAGEMENT_HINT");
  });

  it("la tarjeta de Suscripción menciona dónde se administran las sucursales", () => {
    const card = readSource("src", "presentation", "components", "subscription", "SubscriptionSettingsSection.tsx");
    expect(card).toContain("Sedes y sucursales");
    expect(card).toContain("BRANCH_MANAGEMENT_HINT");
  });
});