import { describe, expect, it } from "vitest";
import { DianXmlBuilder } from "../../../supabase/functions/dian-invoice/XmlBuilder";
import type { DianInvoiceRequest, DianBusinessConfig, DianCustomer } from "../../../supabase/functions/dian-invoice/XmlBuilder";

function makeBaseRequest(): DianInvoiceRequest {
  const business: DianBusinessConfig = {
    nit: "900123456",
    verificationDigit: "8",
    legalName: "VIMDY SAS",
    commercialName: "VIMDY",
    address: "Calle 100 #50-30",
    city: "Bogotá",
    department: "Cundinamarca",
    phone: "6011234567",
    email: "factura@vimdy.co",
    country: "CO",
    organizationType: "PERSONA_JURIDICA",
    taxRegime: "COMUN",
    taxResponsibilities: ["01"],
    claveTecnica: "abc123def456",
    environment: "sandbox",
    invoicePrefix: "FV",
    invoiceConsecutiveFrom: 1,
    invoiceConsecutiveTo: 999999999,
    invoiceConsecutiveCurrent: 0,
  };

  const customer: DianCustomer = {
    documentType: "CC",
    documentNumber: "123456789",
    fullName: "Juan Pérez",
    email: "juan@example.com",
    address: "Calle 50 #20-10",
    city: "Bogotá",
    department: "Cundinamarca",
    taxResponsibilities: ["01"],
  };

  return {
    saleId: "sale_test",
    businessId: "biz_test",
    business,
    documentType: "INVOICE",
    customer,
    items: [
      {
        productId: "PROD001",
        productName: "Hamburguesa",
        quantity: 2,
        price: 25000,
        subtotal: 50000,
        taxRate: 19,
        taxAmount: 9500,
        total: 59500,
        unitCode: "94",
      },
    ],
    subtotal: 50000,
    tax: 9500,
    total: 59500,
    currency: "COP",
    country: "CO",
    paymentMethod: "CASH",
  };
}

describe("DianXmlBuilder — Consecutivo atómico y idempotencia", () => {
  const builder = new DianXmlBuilder();

  it("id: misma venta produce mismo CUFE (determinista)", async () => {
    const request = makeBaseRequest();

    const result1 = await builder.build(request, "uuid-test");
    const result2 = await builder.build(request, "uuid-test");

    expect(result1.cufe).toBe(result2.cufe);
  });

  it("id: diferente clave técnica produce CUFE diferente", async () => {
    const request1 = makeBaseRequest();
    const request2 = {
      ...makeBaseRequest(),
      business: {
        ...makeBaseRequest().business,
        claveTecnica: "diferente_clave",
      },
    };

    const result1 = await builder.build(request1, "uuid-test-1");
    const result2 = await builder.build(request2, "uuid-test-2");

    expect(result1.cufe).not.toBe(result2.cufe);
  });

  it("id: diferente NIT emisor produce CUFE diferente", async () => {
    const request1 = makeBaseRequest();
    const request2 = {
      ...makeBaseRequest(),
      business: {
        ...makeBaseRequest().business,
        nit: "900987654",
      },
    };

    const result1 = await builder.build(request1, "uuid-test-3");
    const result2 = await builder.build(request2, "uuid-test-4");

    expect(result1.cufe).not.toBe(result2.cufe);
  });

  it("id: diferente número de documento adquiriente produce CUFE diferente", async () => {
    const request1 = makeBaseRequest();
    const request2 = {
      ...makeBaseRequest(),
      customer: {
        ...makeBaseRequest().customer,
        documentNumber: "987654321",
      },
    };

    const result1 = await builder.build(request1, "uuid-test-5");
    const result2 = await builder.build(request2, "uuid-test-6");

    expect(result1.cufe).not.toBe(result2.cufe);
  });

  it("id: diferente total produce CUFE diferente", async () => {
    const request1 = makeBaseRequest();
    const request2 = {
      ...makeBaseRequest(),
      total: 100000,
      tax: 19000,
      subtotal: 81000,
      items: [
        {
          productId: "PROD001",
          productName: "Hamburguesa",
          quantity: 2,
          price: 40500,
          subtotal: 81000,
          taxRate: 19,
          taxAmount: 15390,
          total: 96390,
          unitCode: "94",
        },
      ],
    };

    const result1 = await builder.build(request1, "uuid-test-7");
    const result2 = await builder.build(request2, "uuid-test-8");

    expect(result1.cufe).not.toBe(result2.cufe);
    expect(result1.cufe).toHaveLength(96);
    expect(result2.cufe).toHaveLength(96);
  });

  it("id: nota crédito produce XML con documentType 02", async () => {
    const request = {
      ...makeBaseRequest(),
      documentType: "CREDIT_NOTE" as const,
    };

    const result = await builder.build(request, "uuid-credit");

    expect(result.xml).toContain("02");
    expect(result.cufe).toHaveLength(96);
  });

  it("id: nota débito produce XML con documentType 03", async () => {
    const request = {
      ...makeBaseRequest(),
      documentType: "DEBIT_NOTE" as const,
    };

    const result = await builder.build(request, "uuid-debit");

    expect(result.xml).toContain("03");
    expect(result.cufe).toHaveLength(96);
  });

  it("id: el CUFE incluye el prefijo completo en la numeración", async () => {
    const request = {
      ...makeBaseRequest(),
      business: {
        ...makeBaseRequest().business,
        invoicePrefix: "AB",
      },
    };

    const result = await builder.build(request, "uuid-prefix");

    expect(result.number).toMatch(/^AB\d{8}$/);
  });
});
