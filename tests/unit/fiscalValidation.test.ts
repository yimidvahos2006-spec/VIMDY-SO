import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { result: any } = { result: { data: [{ id: "b1" }], error: null } };
const calls: any[] = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: any) => {
        calls.push({ kind: "update", table, row });
        return {
          eq: (_c: string, id: string) => {
            calls[calls.length - 1].id = id;
            return { select: async () => state.result };
          }
        };
      },
      select: (cols: string) => {
        calls.push({ kind: "select", table, cols });
        return { eq: () => ({ maybeSingle: async () => state.result }) };
      }
    })
  }
}));

import {
  computeNitVerificationDigit,
  normalizeFiscalIdentity,
  validateFiscalIdentity
} from "../../src/core/invoicing/fiscalValidation";
import {
  EMPTY_BUSINESS_FISCAL_IDENTITY,
  fiscalIdentityFromRow,
  fiscalIdentityToUpdate,
  type BusinessFiscalIdentity
} from "../../src/core/invoicing/types/fiscal.types";
import {
  fetchBusinessFiscalIdentity,
  saveBusinessFiscalIdentity
} from "../../src/infrastructure/supabase/businessFiscalRepository";

const valid: BusinessFiscalIdentity = {
  nit: "800197268",
  verificationDigit: "4",
  legalName: "Dirección de Impuestos y Aduanas",
  organizationType: "PERSONA_JURIDICA",
  address: "Cra 8 # 6C-38",
  city: "Bogotá",
  department: "Bogotá D.C.",
  phone: "3001112233",
  email: "facturas@negocio.co",
  invoicePrefix: "SETP"
};

beforeEach(() => {
  calls.length = 0;
  state.result = { data: [{ id: "b1" }], error: null };
});

describe("dígito de verificación (módulo 11 DIAN)", () => {
  it("calcula el DV de NIT conocidos", () => {
    expect(computeNitVerificationDigit("800197268")).toBe("4"); // DIAN
  });
  it("rechaza lo que no son dígitos", () => {
    expect(computeNitVerificationDigit("80a")).toBeNull();
    expect(computeNitVerificationDigit("")).toBeNull();
  });
});

describe("normalizeFiscalIdentity", () => {
  it("separa el DV de '900.123.456-7' y limpia espacios, mayúsculas y minúsculas", () => {
    const n = normalizeFiscalIdentity({
      ...EMPTY_BUSINESS_FISCAL_IDENTITY,
      nit: " 900.123.456-7 ",
      legalName: "  Mi   Restaurante  SAS ",
      email: " Facturas@Negocio.CO ",
      invoicePrefix: " setp "
    });
    expect(n.nit).toBe("900123456");
    expect(n.verificationDigit).toBe("7");
    expect(n.legalName).toBe("Mi Restaurante SAS");
    expect(n.email).toBe("facturas@negocio.co");
    expect(n.invoicePrefix).toBe("SETP");
  });
  it("un DV escrito aparte no es pisado por el del NIT", () => {
    expect(normalizeFiscalIdentity({ ...valid, nit: "800197268-9", verificationDigit: "4" }).verificationDigit).toBe("4");
  });
});

describe("validateFiscalIdentity", () => {
  it("acepta datos completos y correctos", () => {
    expect(validateFiscalIdentity(valid)).toEqual({});
  });
  it("un formulario vacío marca los obligatorios y no el opcional", () => {
    const e = validateFiscalIdentity(EMPTY_BUSINESS_FISCAL_IDENTITY);
    expect(Object.keys(e).sort()).toEqual(
      ["address", "city", "department", "email", "legalName", "nit", "organizationType", "verificationDigit"].sort()
    );
  });
  it("el DV que no coincide dice cuál debería ser", () => {
    expect(validateFiscalIdentity({ ...valid, verificationDigit: "9" }).verificationDigit).toMatch(/debería ser 4/);
  });
  it("rechaza NIT con letras o muy corto, correo malo, prefijo inválido y teléfono corto", () => {
    expect(validateFiscalIdentity({ ...valid, nit: "12" }).nit).toBeTruthy();
    expect(validateFiscalIdentity({ ...valid, email: "no-es-correo" }).email).toBeTruthy();
    expect(validateFiscalIdentity({ ...valid, invoicePrefix: "SE TP" }).invoicePrefix).toBeTruthy();
    expect(validateFiscalIdentity({ ...valid, phone: "123" }).phone).toBeTruthy();
  });
  it("prefijo y teléfono vacíos son válidos", () => {
    expect(validateFiscalIdentity({ ...valid, invoicePrefix: "", phone: "" })).toEqual({});
  });
});

describe("mapeo fila <-> formulario", () => {
  it("ida y vuelta, y vacío => NULL", () => {
    const patch = fiscalIdentityToUpdate({ ...valid, phone: "", invoicePrefix: "" });
    expect(patch.fiscal_phone).toBeNull();
    expect(patch.invoice_prefix).toBeNull();
    expect(patch.tax_identification_number).toBe("800197268");
    expect(fiscalIdentityFromRow(patch).legalName).toBe(valid.legalName);
    expect(fiscalIdentityFromRow(null)).toEqual(EMPTY_BUSINESS_FISCAL_IDENTITY);
  });
  it("el parche NO contiene el switch, el proveedor, el consecutivo ni columnas dian_*", () => {
    const keys = Object.keys(fiscalIdentityToUpdate(valid));
    expect(keys.some((k) => /electronic_invoicing|consecutive|^dian_/.test(k))).toBe(false);
  });
});

describe("repositorio fiscal", () => {
  it("lee solo columnas fiscales (sin dian_* ni consecutivo)", async () => {
    state.result = { data: { tax_identification_number: "800197268", fiscal_legal_name: "X SAS" }, error: null };
    const got = await fetchBusinessFiscalIdentity("b1");
    expect(got.nit).toBe("800197268");
    expect(calls[0].cols).not.toMatch(/dian_|consecutive|electronic_invoicing/);
  });
  it("lectura con error o negocio inexistente lanza", async () => {
    state.result = { data: null, error: { message: "boom" } };
    await expect(fetchBusinessFiscalIdentity("b1")).rejects.toThrow(/boom/);
    state.result = { data: null, error: null };
    await expect(fetchBusinessFiscalIdentity("b1")).rejects.toThrow(/permiso/);
  });
  it("guarda normalizado, sobre el negocio correcto y devuelve lo guardado", async () => {
    const saved = await saveBusinessFiscalIdentity("b1", { ...valid, nit: "800.197.268", email: "FACTURAS@negocio.co" });
    expect(calls[0]).toMatchObject({ kind: "update", table: "businesses", id: "b1" });
    expect(calls[0].row.tax_identification_number).toBe("800197268");
    expect(calls[0].row.fiscal_email).toBe("facturas@negocio.co");
    expect(saved.nit).toBe("800197268");
  });
  it("no escribe nada si los datos son inválidos", async () => {
    await expect(saveBusinessFiscalIdentity("b1", { ...valid, verificationDigit: "9" })).rejects.toThrow(/debería ser/);
    expect(calls.length).toBe(0);
  });
  it("0 filas actualizadas (no es admin / plan vencido) es un error, no 'guardado'", async () => {
    state.result = { data: [], error: null };
    await expect(saveBusinessFiscalIdentity("b1", valid)).rejects.toThrow(/administrador/i);
  });
});