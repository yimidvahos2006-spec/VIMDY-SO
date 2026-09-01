import { describe, expect, it } from "vitest";
import { InvoiceFactory } from "../../src/core/invoicing/InvoiceFactory";

describe("InvoiceFactory.resolve", () => {
  it("devuelve el proveedor Factus para un negocio colombiano con facturación activada", () => {
    const provider = InvoiceFactory.resolve({ enabled: true, provider: "factus" }, "CO");
    expect(provider).not.toBeNull();
  });

  it("devuelve null si electronicInvoicing.enabled es false, sin importar el país", () => {
    const provider = InvoiceFactory.resolve({ enabled: false, provider: "factus" }, "CO");
    expect(provider).toBeNull();
  });

  it("devuelve null si el provider es 'none'", () => {
    const provider = InvoiceFactory.resolve({ enabled: true, provider: "none" }, "CO");
    expect(provider).toBeNull();
  });

  it("NUNCA factura con Factus fuera de Colombia, aunque enabled quede en true por un registro viejo", () => {
    const paises = ["MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"] as const;
    for (const country of paises) {
      const provider = InvoiceFactory.resolve({ enabled: true, provider: "factus" }, country);
      expect(provider, `país ${country} no debería poder facturar con Factus`).toBeNull();
    }
  });
});
