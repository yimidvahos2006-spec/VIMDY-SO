import { describe, expect, it } from "vitest";
import { InvoiceFactory } from "../../../src/core/invoicing/InvoiceFactory";
import { DianProvider } from "../../../src/core/invoicing/providers/dian/DianProvider";
import { FactusProvider } from "../../../src/core/invoicing/providers/factus/FactusProvider";

describe("InvoiceFactory — DIAN provider", () => {
  it("resuelve DianProvider para negocio colombiano con provider 'dian'", () => {
    const provider = InvoiceFactory.resolve(
      { enabled: true, provider: "dian" },
      "CO"
    );

    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("dian");
    expect(provider).toBeInstanceOf(DianProvider);
  });

  it("resuelve FactusProvider para negocio colombiano con provider 'factus'", () => {
    const provider = InvoiceFactory.resolve(
      { enabled: true, provider: "factus" },
      "CO"
    );

    expect(provider).not.toBeNull();
    expect(provider?.name).toBe("factus");
    expect(provider).toBeInstanceOf(FactusProvider);
  });

  it("devuelve null si provider es 'dian' pero país no es CO", () => {
    const provider = InvoiceFactory.resolve(
      { enabled: true, provider: "dian" },
      "MX"
    );

    expect(provider).toBeNull();
  });

  it("DianProvider soporta únicamente Colombia", () => {
    const provider = new DianProvider();

    expect(provider.supportsCountry("CO")).toBe(true);
    expect(provider.supportsCountry("MX")).toBe(false);
    expect(provider.supportsCountry("PE")).toBe(false);
  });

  it("DianProvider y FactusProvider son instancias distintas", () => {
    const dian = InvoiceFactory.create("dian");
    const factus = InvoiceFactory.create("factus");

    expect(dian).not.toBe(factus);
    expect(dian.name).toBe("dian");
    expect(factus.name).toBe("factus");
  });

  it("DianProvider validateResponse rechaza payloads inválidos", () => {
    const provider = new DianProvider();

    expect(provider.validateResponse(null)).toBe(false);
    expect(provider.validateResponse(undefined)).toBe(false);
    expect(
      provider.validateResponse({ status: "invalid" })
    ).toBe(false);
  });

  it("DianProvider validateResponse acepta estados válidos", () => {
    const provider = new DianProvider();

    expect(provider.validateResponse({ status: "accepted" })).toBe(true);
    expect(provider.validateResponse({ status: "pending" })).toBe(true);
  });
});
