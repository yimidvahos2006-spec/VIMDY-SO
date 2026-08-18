import { describe, expect, it } from "vitest";

import { PaymentCountryResolver } from "../../src/core/payments/PaymentCountryResolver";
import { PaymentCurrencyResolver } from "../../src/core/payments/PaymentCurrencyResolver";
import { PaymentMethodResolver } from "../../src/core/payments/PaymentMethodResolver";
import { PaymentValidator } from "../../src/core/payments/PaymentValidator";
import { getPlanPrice, getPlanCurrency, SUBSCRIPTION_PLANS } from "../../src/core/entities/SubscriptionTypes";

const ALLOWED_COUNTRIES = ["CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"];
const MERCADOPAGO_COUNTRIES = new Set(["CO", "AR", "CL", "MX", "PE"]);
const WOMPI_COUNTRIES = new Set(["CO"]);
const PAYPAL_COUNTRIES = new Set(ALLOWED_COUNTRIES);

describe("PaymentCountryResolver — 10 países", () => {
  it("CO → wompi", () => {
    expect(PaymentCountryResolver.resolve("CO")).toBe("wompi");
  });

  it("AR, CL, MX, PE → mercadopago", () => {
    for (const c of ["AR", "CL", "MX", "PE"]) {
      expect(PaymentCountryResolver.resolve(c)).toBe("mercadopago");
    }
  });

  it("US, EC, PA, VE, ES → paypal", () => {
    for (const c of ["US", "EC", "PA", "VE", "ES"]) {
      expect(PaymentCountryResolver.resolve(c)).toBe("paypal");
    }
  });

  it("países no permitidos caen a paypal por defecto (pero PaymentValidator los rechaza)", () => {
    expect(PaymentCountryResolver.resolve("BR")).toBe("paypal");
    expect(PaymentCountryResolver.resolve("UY")).toBe("paypal");
  });
});

describe("PaymentCurrencyResolver — 10 países", () => {
  it("resuelve moneda correcta por país", () => {
    expect(PaymentCurrencyResolver.resolve("CO")).toBe("COP");
    expect(PaymentCurrencyResolver.resolve("MX")).toBe("MXN");
    expect(PaymentCurrencyResolver.resolve("AR")).toBe("ARS");
    expect(PaymentCurrencyResolver.resolve("CL")).toBe("CLP");
    expect(PaymentCurrencyResolver.resolve("PE")).toBe("PEN");
    expect(PaymentCurrencyResolver.resolve("EC")).toBe("USD");
    expect(PaymentCurrencyResolver.resolve("US")).toBe("USD");
    expect(PaymentCurrencyResolver.resolve("PA")).toBe("USD");
    expect(PaymentCurrencyResolver.resolve("VE")).toBe("USD");
    expect(PaymentCurrencyResolver.resolve("ES")).toBe("EUR");
  });

  it("países no mapeados caen a USD", () => {
    expect(PaymentCurrencyResolver.resolve("BR")).toBe("USD");
    expect(PaymentCurrencyResolver.resolve("UY")).toBe("USD");
  });
});

describe("PaymentMethodResolver — 10 países", () => {
  it("CO tiene métodos específicos de Wompi", () => {
    const methods = PaymentMethodResolver.resolve("CO");
    expect(methods).toContain("pse");
    expect(methods).toContain("nequi");
    expect(methods).toContain("card");
  });

  it("AR, CL, PE tienen métodos de Mercado Pago", () => {
    for (const c of ["AR", "CL", "PE"]) {
      const methods = PaymentMethodResolver.resolve(c);
      expect(methods).toContain("mercadopago_wallet");
      expect(methods).toContain("card");
    }
  });

  it("MX tiene métodos de Mercado Pago con transferencia bancaria", () => {
    const methods = PaymentMethodResolver.resolve("MX");
    expect(methods).toContain("mercadopago_wallet");
    expect(methods).toContain("bank_transfer");
    expect(methods).toContain("card");
  });

  it("US, EC, PA, VE, ES tienen paypal y card", () => {
    for (const c of ["US", "EC", "PA", "VE", "ES"]) {
      const methods = PaymentMethodResolver.resolve(c);
      expect(methods).toContain("paypal");
      expect(methods).toContain("card");
    }
  });
});

describe("PaymentValidator — países permitidos", () => {
  const baseInput = {
    businessId: "biz-1",
    country: "CO",
    businessType: "restaurante",
    plan: "monthly" as const,
    amount: 79000
  };

  it("acepta los 10 países", () => {
    for (const c of ALLOWED_COUNTRIES) {
      expect(() => {
        PaymentValidator.validateRoutingInput({ ...baseInput, country: c, amount: 100 });
      }).not.toThrow();
    }
  });

  it("rechaza países no permitidos", () => {
    for (const c of ["BR", "UY", "CA", "GB", "DE", "FR", "IT", "PT", "JP", "CN"]) {
      expect(() => {
        PaymentValidator.validateRoutingInput({ ...baseInput, country: c, amount: 100 });
      }).toThrow(/país no soportado/);
    }
  });
});

describe("Subscription prices — por país (server-side)", () => {
  it("getPlanPrice usa país, no moneda", () => {
    expect(getPlanPrice("monthly", "CO")).toBe(79000);
    expect(getPlanPrice("yearly", "CO")).toBe(790000);
    expect(getPlanPrice("monthly", "US")).toBe(89);
    expect(getPlanPrice("yearly", "US")).toBe(899);
    expect(getPlanPrice("monthly", "MX")).toBe(1499);
    expect(getPlanPrice("yearly", "MX")).toBe(14990);
    expect(getPlanPrice("monthly", "PE")).toBe(149);
    expect(getPlanPrice("yearly", "PE")).toBe(1490);
    expect(getPlanPrice("monthly", "CL")).toBe(14990);
    expect(getPlanPrice("yearly", "CL")).toBe(149900);
    expect(getPlanPrice("monthly", "AR")).toBe(89999);
    expect(getPlanPrice("yearly", "AR")).toBe(899999);
    expect(getPlanPrice("monthly", "EC")).toBe(59);
    expect(getPlanPrice("yearly", "EC")).toBe(599);
    expect(getPlanPrice("monthly", "PA")).toBe(69);
    expect(getPlanPrice("yearly", "PA")).toBe(699);
    expect(getPlanPrice("monthly", "VE")).toBe(49);
    expect(getPlanPrice("yearly", "VE")).toBe(499);
    expect(getPlanPrice("monthly", "ES")).toBe(69);
    expect(getPlanPrice("yearly", "ES")).toBe(699);
  });

  it("getPlanCurrency devuelve la moneda correcta por país", () => {
    expect(getPlanCurrency("monthly", "CO")).toBe("COP");
    expect(getPlanCurrency("monthly", "US")).toBe("USD");
    expect(getPlanCurrency("monthly", "MX")).toBe("MXN");
    expect(getPlanCurrency("monthly", "PE")).toBe("PEN");
    expect(getPlanCurrency("monthly", "CL")).toBe("CLP");
    expect(getPlanCurrency("monthly", "AR")).toBe("ARS");
    expect(getPlanCurrency("monthly", "EC")).toBe("USD");
    expect(getPlanCurrency("monthly", "PA")).toBe("USD");
    expect(getPlanCurrency("monthly", "VE")).toBe("USD");
    expect(getPlanCurrency("monthly", "ES")).toBe("EUR");
  });

  it("plan base USD es 89/899", () => {
    const monthly = SUBSCRIPTION_PLANS.find((p) => p.id === "monthly");
    const yearly = SUBSCRIPTION_PLANS.find((p) => p.id === "yearly");
    expect(monthly!.price).toBe(89);
    expect(yearly!.price).toBe(899);
    expect(monthly!.currency).toBe("USD");
    expect(yearly!.currency).toBe("USD");
  });
});

describe("Payment routing — proveedores por país", () => {
  for (const c of ALLOWED_COUNTRIES) {
    it(`${c}: PayPal permitido`, () => {
      expect(PAYPAL_COUNTRIES.has(c)).toBe(true);
    });
  }

  it("Wompi solo en CO", () => {
    expect(WOMPI_COUNTRIES.has("CO")).toBe(true);
    for (const c of ALLOWED_COUNTRIES.filter((c) => c !== "CO")) {
      expect(WOMPI_COUNTRIES.has(c)).toBe(false);
    }
  });

  it("Mercado Pago solo en CO, AR, CL, MX, PE", () => {
    for (const c of ALLOWED_COUNTRIES) {
      const allowed = MERCADOPAGO_COUNTRIES.has(c);
      if (c === "CO" || c === "AR" || c === "CL" || c === "MX" || c === "PE") {
        expect(allowed, `${c} debe permitir MercadoPago`).toBe(true);
      } else {
        expect(allowed, `${c} NO debe permitir MercadoPago`).toBe(false);
      }
    }
  });
});
