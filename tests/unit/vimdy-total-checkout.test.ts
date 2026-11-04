import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const invokeMock = vi.hoisted(() => vi.fn());

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { functions: { invoke: invokeMock } }
}));

import { getEditionPlanPrice } from "../../src/core/entities/SubscriptionTypes";
import { GlobalPaymentRouter } from "../../src/core/payments/GlobalPaymentRouter";
import { PaymentValidator } from "../../src/core/payments/PaymentValidator";
import type { PaymentRequest } from "../../src/core/payments/models/PaymentModels";
import { WompiProvider } from "../../src/core/payments/providers/wompi/WompiProvider";
import { MercadoPagoProvider } from "../../src/core/payments/providers/mercadopago/MercadoPagoProvider";
import { PayPalProvider } from "../../src/core/payments/providers/paypal/PayPalProvider";
import { LEGAL_INFO } from "../../src/marketing/legal/legalInfo";
import { TERMS_EDITIONS_BODY, TERMS_PRICING_BODY } from "../../src/marketing/pricingCopy";

const readSource = (...segments: string[]): string =>
  readFileSync(join(process.cwd(), ...segments), "utf-8");

const baseInput = {
  businessId: "biz-1",
  country: "CO",
  businessType: "suscripcion_vimdy"
} as const;

describe("VIMDY Total — el Router cobra el precio canónico de la edición", () => {
  it("1 sede: $99.000 mensual y $990.000 anual", () => {
    const monthly = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", edition: "total" });
    const yearly = GlobalPaymentRouter.route({ ...baseInput, plan: "yearly", edition: "total" });
    expect(monthly.request.amount).toBe(99000);
    expect(yearly.request.amount).toBe(990000);
    expect(monthly.request.edition).toBe("total");
    expect(monthly.provider).toBe("wompi");
  });

  it("multi-sucursal: $149.000 mensual y $1.490.000 anual", () => {
    const monthly = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", tier: "multi", edition: "total" });
    const yearly = GlobalPaymentRouter.route({ ...baseInput, plan: "yearly", tier: "multi", edition: "total" });
    expect(monthly.request.amount).toBe(149000);
    expect(yearly.request.amount).toBe(1490000);
  });

  it("sin edición se comporta igual que antes: Plan Operativo", () => {
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly" });
    expect(request.amount).toBe(59900);
    expect(request.edition).toBe("operativo");
  });

  it("rechaza un monto del navegador que no corresponde a VIMDY Total", () => {
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", edition: "total", amount: 59900 })
    ).toThrow(/monto no autorizado/);
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", edition: "total", amount: 99000 })
    ).not.toThrow();
  });

  it("VIMDY Total no tiene precio fuera de Colombia (no se inventa)", () => {
    expect(() =>
      GlobalPaymentRouter.route({ ...baseInput, country: "MX", plan: "monthly", edition: "total" })
    ).toThrow(/precio canónico válido/);
  });

  it("PaymentValidator rechaza una edición desconocida", () => {
    expect(() =>
      PaymentValidator.validateRoutingInput({
        ...baseInput,
        plan: "monthly",
        edition: "premium" as unknown as "total"
      })
    ).toThrow(/edición del producto/);
  });
});

describe("VIMDY Total — WompiProvider", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  it("manda edition=total al servidor (sin enviar monto) y deja pasar la URL si el servidor la confirma", async () => {
    invokeMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.wompi.co/p/?x=1", reference: "wompi_ref_total", edition: "total" },
      error: null
    });
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "yearly", tier: "multi", edition: "total" });
    const result = await new WompiProvider().createPayment(request);

    const [functionName, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(functionName).toBe("wompi-create-checkout");
    expect(options.body).toEqual({ businessId: "biz-1", plan: "yearly", tier: "multi", edition: "total" });
    expect(result.checkoutUrl).toBe("https://checkout.wompi.co/p/?x=1");
  });

  it("falla cerrado si piden VIMDY Total y el servidor no lo confirma (función desplegada sin actualizar)", async () => {
    invokeMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.wompi.co/p/?x=1", reference: "wompi_ref_viejo" },
      error: null
    });
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly", edition: "total" });
    await expect(new WompiProvider().createPayment(request)).rejects.toThrow(/WOMPI_EDITION_NOT_CONFIRMED/);
  });

  it("el Plan Operativo viaja igual que siempre: sin campo edition", async () => {
    invokeMock.mockResolvedValue({
      data: { checkoutUrl: "https://checkout.wompi.co/p/?x=1", reference: "wompi_ref" },
      error: null
    });
    const { request } = GlobalPaymentRouter.route({ ...baseInput, plan: "monthly" });
    await new WompiProvider().createPayment(request);

    const [, options] = invokeMock.mock.calls[0] as [string, { body: Record<string, unknown> }];
    expect(options.body).toEqual({ businessId: "biz-1", plan: "monthly", tier: "single" });
  });
});

describe("VIMDY Total — Mercado Pago y PayPal no lo cobran", () => {
  beforeEach(() => {
    invokeMock.mockReset();
  });

  const mercadoPagoRequest: PaymentRequest = {
    id: "pay-1",
    provider: "mercadopago",
    businessId: "biz-1",
    country: "MX",
    currency: "MXN",
    amount: 1499,
    businessType: "suscripcion_vimdy",
    plan: "monthly",
    tier: "single",
    edition: "total"
  };

  const payPalRequest: PaymentRequest = {
    ...mercadoPagoRequest,
    provider: "paypal",
    country: "US",
    currency: "USD",
    amount: 89
  };

  it("MercadoPagoProvider rechaza VIMDY Total y multi-sucursal sin llamar al servidor", async () => {
    await expect(new MercadoPagoProvider().createPayment(mercadoPagoRequest)).rejects.toThrow(
      /MERCADOPAGO_EDITION_NOT_SUPPORTED/
    );
    await expect(
      new MercadoPagoProvider().createPayment({ ...mercadoPagoRequest, edition: "operativo", tier: "multi" })
    ).rejects.toThrow(/MERCADOPAGO_EDITION_NOT_SUPPORTED/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("PayPalProvider rechaza VIMDY Total y multi-sucursal sin llamar al servidor", async () => {
    await expect(new PayPalProvider().createPayment(payPalRequest)).rejects.toThrow(/PAYPAL_EDITION_NOT_SUPPORTED/);
    await expect(
      new PayPalProvider().createPayment({ ...payPalRequest, edition: "operativo", tier: "multi" })
    ).rejects.toThrow(/PAYPAL_EDITION_NOT_SUPPORTED/);
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it("las Edge Functions de Mercado Pago y PayPal también lo rechazan en el servidor", () => {
    for (const name of ["mercadopago-checkout", "paypal-checkout"]) {
      const source = readSource("supabase", "functions", name, "index.ts");
      expect(source).toContain('payload.edition === "total" || payload.tier === "multi"');
      expect(source).toContain("PRICING_NOT_CONFIGURED");
    }
  });
});

describe("VIMDY Total — wompi-create-checkout (servidor)", () => {
  const edgeFunction = readSource("supabase", "functions", "wompi-create-checkout", "index.ts");

  it("las tablas de precios del servidor de VIMDY Total coinciden con el catálogo del cliente", () => {
    const block = /const TOTAL_PRICE_BY_COUNTRY[\s\S]*?\n\};/.exec(edgeFunction);
    expect(block).not.toBeNull();
    const single = /single: \{ monthly: (\d+), yearly: (\d+) \}/.exec(block![0]);
    const multi = /multi: \{ monthly: (\d+), yearly: (\d+) \}/.exec(block![0]);
    expect(single).not.toBeNull();
    expect(multi).not.toBeNull();
    expect(Number(single![1])).toBe(getEditionPlanPrice("total", "monthly", "CO", "single"));
    expect(Number(single![2])).toBe(getEditionPlanPrice("total", "yearly", "CO", "single"));
    expect(Number(multi![1])).toBe(getEditionPlanPrice("total", "monthly", "CO", "multi"));
    expect(Number(multi![2])).toBe(getEditionPlanPrice("total", "yearly", "CO", "multi"));
  });

  it("valida la edición, toma el precio de la tabla del servidor y guarda edición y nivel en el pago", () => {
    expect(edgeFunction).toContain("INVALID_EDITION");
    expect(edgeFunction).toContain("const pricing = PRICE_TABLE_BY_EDITION[edition][country];");
    expect(edgeFunction).not.toMatch(/payload\.amount|body\.amount/);
    const insertBlock = /from\("subscription_payments"\)\.insert\(\{[\s\S]*?\}\);/.exec(edgeFunction);
    expect(insertBlock).not.toBeNull();
    expect(insertBlock![0]).toContain("edition,");
    expect(insertBlock![0]).toContain("tier,");
  });

  it("no cobra un pago que la activación ignoraría (período ya cubierto más largo)", () => {
    expect(edgeFunction).toContain("PLAN_PERIOD_ALREADY_COVERED");
    expect(edgeFunction).toContain("const PLAN_PERIOD_DAYS: Record<Plan, number> = { monthly: 30, yearly: 365 };");
  });
});

describe("VIMDY Total — migración de base de datos", () => {
  const migration = readSource("supabase", "migrations", "20261124000000_vimdy_total_edition_payments.sql");

  it("agrega la edición al negocio y al pago, con valores válidos", () => {
    expect(migration).toContain("ADD COLUMN IF NOT EXISTS plan_edition text NOT NULL DEFAULT 'operativo'");
    expect(migration).toContain("CHECK (plan_edition IN ('operativo', 'total'))");
    expect(migration).toContain("ALTER TABLE public.subscription_payments");
    expect(migration).toContain("CHECK (edition IN ('operativo', 'total'))");
    expect(migration).toContain("CHECK (tier IN ('single', 'multi'))");
  });

  it("la activación copia edición y nivel del PAGO y conserva las protecciones anteriores", () => {
    expect(migration).toContain("plan_edition = v_edition");
    expect(migration).toContain("plan_tier = v_tier");
    expect(migration).toContain("PERFORM pg_advisory_xact_lock(v_lock_key);");
    expect(migration).toContain("'obsolete_payment'");
    expect(migration).toContain("PERFORM public.mark_trial_used(p_business_id);");
    expect(migration).toContain("IF v_payment.status = 'approved' THEN");
  });

  it("no abre la activación al navegador (solo service_role, como antes)", () => {
    expect(migration).not.toMatch(/GRANT\s+EXECUTE/i);
    expect(migration).not.toMatch(/GRANT\s+(INSERT|UPDATE)[^;]*businesses/i);
  });
});

describe("VIMDY Total — Términos y Condiciones", () => {
  it("listan los planes y precios de VIMDY Total junto a los del Plan Operativo", () => {
    for (const price of ["$59.900", "$599.000", "$110.900", "$1.109.000"]) {
      expect(TERMS_PRICING_BODY).toContain(price);
    }
    for (const price of ["$99.000", "$990.000", "$149.000", "$1.490.000"]) {
      expect(TERMS_PRICING_BODY).toContain(price);
    }
    expect(TERMS_PRICING_BODY).toContain("VIMDY Total");
    expect(TERMS_PRICING_BODY).toContain("12 meses de acceso por el precio de 10");
  });

  it("explican qué incluye VIMDY Total y que el módulo contable no es asesoría contable", () => {
    expect(TERMS_EDITIONS_BODY).toContain("VIMDY Total");
    expect(TERMS_EDITIONS_BODY).toContain("Utilidad Neta Real");
    expect(TERMS_EDITIONS_BODY).toContain("no reemplaza a tu contador");
    expect(TERMS_EDITIONS_BODY).toContain("Wompi");
  });

  it("la página de Términos incluye la cláusula de ediciones, la prueba de 14 días y su propia fecha", () => {
    const page = readSource("src", "marketing", "pages", "TermsPage.tsx");
    expect(page).toContain("TERMS_PRICING_BODY");
    expect(page).toContain("TERMS_EDITIONS_BODY");
    expect(page).toContain("14 días de prueba");
    expect(page).toContain("Plan Operativo o VIMDY Total");
    expect(page).toContain("LEGAL_INFO.terminosUltimaActualizacion");
    expect(LEGAL_INFO.terminosUltimaActualizacion).toBe("3 de noviembre de 2026");
  });
});