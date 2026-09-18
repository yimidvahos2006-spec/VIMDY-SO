import { describe, expect, it } from "vitest";
import { DianXmlBuilder } from "../../../supabase/functions/dian-invoice/XmlBuilder";
import type { DianInvoiceRequest, DianBusinessConfig, DianCustomer } from "../../../supabase/functions/dian-invoice/XmlBuilder";

function makeTestRequest(overrides: Partial<DianInvoiceRequest> = {}): DianInvoiceRequest {
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
    saleId: "sale_test_001",
    businessId: "biz_test_001",
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
    ...overrides,
  };
}

describe("DianXmlBuilder", () => {
  const builder = new DianXmlBuilder();

  it("genera XML bien formado con estructura UBL 2.1", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-123");

    expect(result.xml).toContain('xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"');
    expect(result.xml).toContain("<?xml version=\"1.0\" encoding=\"utf-8\"?>");
    expect(result.number).toMatch(/^FV\d{8}$/);
  });

  it("el CUFE generado es único por invoice y tiene 96 caracteres", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-123");

    expect(result.cufe).toHaveLength(96);
    expect(result.cufe).toMatch(/^[0-9a-f]{96}$/);
  });

  it("el número de factura incluye el prefijo configurado", async () => {
    const request = makeTestRequest({
      business: {
        ...makeTestRequest().business,
        invoicePrefix: "TEST",
        invoiceConsecutiveCurrent: 5,
      },
    });

    const result = await builder.build(request, "test-uuid-456");

    expect(result.number).toBe("TEST00000006");
  });

  it("el XML incluye UUID con el CUFE y schemeName CUFE-SHA384", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-789");

    expect(result.xml).toContain(`schemeName="CUFE-SHA384"`);
    expect(result.xml).toContain(result.cufe);
  });

  it("el XML incluye el NIT del emisor", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-1");

    expect(result.xml).toContain("900123456");
  });

  it("el XML incluye datos del cliente (documento, nombre)", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-2");

    expect(result.xml).toContain("123456789");
    expect(result.xml).toContain("Juan Pérez");
  });

  it("el XML incluye líneas de factura con productos", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-3");

    expect(result.xml).toContain("PROD001");
    expect(result.xml).toContain("Hamburguesa");
    expect(result.xml).toContain("50000.00");
  });

  it("el XML incluye totales correctos (subtotal, tax, total)", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-4");

    expect(result.xml).toContain("50000.00");
    expect(result.xml).toContain("9500.00");
    expect(result.xml).toContain("59500.00");
  });

  it("el XML incluye InvoiceTypeCode correcto para notas de crédito", async () => {
    const request = makeTestRequest({ documentType: "CREDIT_NOTE" });
    const result = await builder.build(request, "test-uuid-5");

    expect(result.xml).toContain("02");
  });

  it("el XML incluye InvoiceTypeCode correcto para notas débito", async () => {
    const request = makeTestRequest({ documentType: "DEBIT_NOTE" });
    const result = await builder.build(request, "test-uuid-6");

    expect(result.xml).toContain("03");
  });

  it("el XML incluye moneda COP", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-7");

    expect(result.xml).toContain('currencyID="COP"');
  });

  it("el XML incluye fecha y hora de emisión", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-8");

    const today = new Date();
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;

    expect(result.xml).toContain(`<cbc:IssueDate>${dateStr}</cbc:IssueDate>`);
    expect(result.xml).toContain("<cbc:IssueTime>");
  });

  it("el XML incluye descuentos cuando apply", async () => {
    const request = makeTestRequest({ discount: 5000 });
    const result = await builder.build(request, "test-uuid-9");

    expect(result.xml).toContain("AllowanceCharge");
    expect(result.xml).toContain("5000.00");
  });

  it("el XML NO incluye descuentos cuando es 0 o undefined", async () => {
    const request = makeTestRequest({ discount: 0 });
    const result = await builder.build(request, "test-uuid-10");

    expect(result.xml).not.toContain("AllowanceCharge");
  });

  it("el XML incluye PaymentMeans con código de método de pago", async () => {
    const request = makeTestRequest({ paymentMethod: "CASH" });
    const result = await builder.build(request, "test-uuid-11");

    expect(result.xml).toContain("PaymentMeans");
    expect(result.xml).toContain("Efectivo");
  });

  it("el XML incluye firma con Id del CUFE en cac:Signature", async () => {
    const request = makeTestRequest();
    const result = await builder.build(request, "test-uuid-12");

    expect(result.xml).toContain("<cac:Signature>");
    expect(result.xml).toContain(result.cufe);
  });

  it("el número de factura se incrementa correctamente", async () => {
    const request1 = makeTestRequest();
    const result1 = await builder.build(request1, "uuid1");

    const request2 = makeTestRequest({
      business: {
        ...makeTestRequest().business,
        invoiceConsecutiveCurrent: 1,
      },
    });
    const result2 = await builder.build(request2, "uuid2");

    const num1 = parseInt(result1.number.replace("FV", ""));
    const num2 = parseInt(result2.number.replace("FV", ""));

    expect(num2).toBe(num1 + 1);
  });

  it("lanza error si el rango de numeración está agotado", async () => {
    const request = makeTestRequest({
      business: {
        ...makeTestRequest().business,
        invoiceConsecutiveFrom: 1,
        invoiceConsecutiveTo: 1,
        invoiceConsecutiveCurrent: 1,
      },
    });

    await expect(builder.build(request, "test-uuid-13")).rejects.toThrow(
      "NUMERATION_EXHAUSTED"
    );
  });
});
