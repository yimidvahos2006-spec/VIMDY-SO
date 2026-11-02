import { describe, expect, it } from "vitest";
import {
  BUSINESS_INVOICING_SELECT_COLUMNS,
  businessInvoicingFromRow,
  businessInvoicingToUpdate,
  type BusinessInvoicingRow
} from "../../src/core/invoicing/types/fiscal.types";

const baseRow: BusinessInvoicingRow = {
  tax_identification_number: " 900123456 ",
  tax_verification_digit: "7",
  fiscal_legal_name: "Restaurante Demo SAS",
  fiscal_address: "Calle 10 # 5-20",
  fiscal_city: "Medellín",
  fiscal_department: "Antioquia",
  fiscal_phone: null,
  fiscal_email: "facturas@demo.co",
  fiscal_tax_regime: null,
  fiscal_organization_type: "PERSONA_JURIDICA",
  electronic_invoicing_enabled: true,
  electronic_invoicing_provider: "factus",
  invoice_prefix: "SETP",
  invoice_consecutive_from: 1,
  invoice_consecutive_to: 1000,
  invoice_consecutive_current: 12
};

describe("fiscal.types — configuración del negocio", () => {
  it("nunca pide columnas secretas dian_* ni el consecutivo como escribible", () => {
    expect(BUSINESS_INVOICING_SELECT_COLUMNS).not.toMatch(/dian_/);
    expect(BUSINESS_INVOICING_SELECT_COLUMNS).toContain("electronic_invoicing_enabled");
  });

  it("mapea fila → config y normaliza espacios y nulos", () => {
    const cfg = businessInvoicingFromRow(baseRow);
    expect(cfg.enabled).toBe(true);
    expect(cfg.provider).toBe("factus");
    expect(cfg.nit).toBe("900123456");
    expect(cfg.phone).toBe("");
    expect(cfg.organizationType).toBe("PERSONA_JURIDICA");
    expect(cfg.consecutiveCurrent).toBe(12);
  });

  it("proveedor desconocido o facturación apagada ⇒ 'none'", () => {
    expect(
      businessInvoicingFromRow({ ...baseRow, electronic_invoicing_provider: "otro" }).provider
    ).toBe("none");
    expect(
      businessInvoicingFromRow({ ...baseRow, electronic_invoicing_enabled: false }).provider
    ).toBe("none");
  });

  it("el parche de UPDATE no incluye consecutivo actual y respeta enabled=false ⇒ none", () => {
    const cfg = businessInvoicingFromRow(baseRow);
    const patch = businessInvoicingToUpdate({ ...cfg, enabled: false });
    expect(patch.electronic_invoicing_provider).toBe("none");
    expect("invoice_consecutive_current" in patch).toBe(false);
    expect(patch.fiscal_phone).toBeNull();
  });
});