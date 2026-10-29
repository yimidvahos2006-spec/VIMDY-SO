// tests/unit/customerQuickCreate.test.ts
/* Alta ultrarrápida de clientes: SOLO nombre y teléfono son obligatorios. */

import { describe, it, expect } from "vitest";

import {
  buildNewCustomer,
  normalizeCustomerFields,
  validateCustomerRequired
} from "../../src/core/domain/customers/quickCreate";

const META = { id: "c-1", createdAt: new Date("2026-10-28T12:00:00Z") };

describe("validateCustomerRequired — lo único obligatorio es nombre y teléfono", () => {
  it("nombre + teléfono es suficiente", () => {
    expect(validateCustomerRequired({ name: "Ana", phone: "300 123 4567" })).toEqual({ ok: true });
  });

  it("acepta teléfonos con formato (+, espacios, guiones, paréntesis)", () => {
    expect(validateCustomerRequired({ name: "Ana", phone: "+57 (300) 123-4567" })).toEqual({ ok: true });
  });

  it("sin nombre falla y el cursor va al nombre", () => {
    expect(validateCustomerRequired({ name: "", phone: "3001234567" })).toEqual({
      ok: false,
      field: "name",
      error: "NAME_REQUIRED"
    });
    expect(validateCustomerRequired({ name: "   ", phone: "3001234567" })).toMatchObject({ error: "NAME_REQUIRED" });
  });

  it("un nombre de 1 letra no cuenta", () => {
    expect(validateCustomerRequired({ name: "A", phone: "3001234567" })).toMatchObject({ error: "NAME_REQUIRED" });
  });

  it("sin teléfono falla y el cursor va al teléfono", () => {
    expect(validateCustomerRequired({ name: "Ana" })).toEqual({
      ok: false,
      field: "phone",
      error: "PHONE_REQUIRED"
    });
    expect(validateCustomerRequired({ name: "Ana", phone: "  " })).toMatchObject({ error: "PHONE_REQUIRED" });
  });

  it("teléfono con menos de 7 dígitos falla", () => {
    expect(validateCustomerRequired({ name: "Ana", phone: "313" })).toEqual({
      ok: false,
      field: "phone",
      error: "PHONE_TOO_SHORT"
    });
    expect(validateCustomerRequired({ name: "Ana", phone: "abc-123" })).toMatchObject({ error: "PHONE_TOO_SHORT" });
  });

  it("si el nombre y el teléfono fallan, se reporta primero el nombre", () => {
    expect(validateCustomerRequired({ name: "", phone: "" })).toMatchObject({ field: "name" });
  });

  describe("requirePhone: false (editar un cliente antiguo que nunca tuvo teléfono)", () => {
    it("permite guardar sin teléfono", () => {
      expect(validateCustomerRequired({ name: "Ana", phone: "" }, { requirePhone: false })).toEqual({ ok: true });
    });

    it("pero si escribe uno, tiene que ser un teléfono", () => {
      expect(validateCustomerRequired({ name: "Ana", phone: "12" }, { requirePhone: false })).toMatchObject({
        error: "PHONE_TOO_SHORT"
      });
    });

    it("el nombre sigue siendo obligatorio", () => {
      expect(validateCustomerRequired({ name: "", phone: "" }, { requirePhone: false })).toMatchObject({
        error: "NAME_REQUIRED"
      });
    });
  });
});

describe("normalizeCustomerFields — correo, documento, dirección y notas son 100% opcionales", () => {
  it("solo nombre y teléfono: todo lo demás queda sin definir", () => {
    const fields = normalizeCustomerFields({ name: "Ana", phone: "3001234567" });
    expect(fields).toEqual({
      name: "Ana",
      phone: "3001234567",
      email: undefined,
      documentType: undefined,
      documentNumber: undefined,
      address: undefined,
      notes: undefined
    });
  });

  it("campos opcionales vacíos o con solo espacios no se guardan", () => {
    const fields = normalizeCustomerFields({
      name: " Ana ",
      phone: " 3001234567 ",
      email: "  ",
      documentNumber: "",
      address: "   ",
      notes: ""
    });
    expect(fields.name).toBe("Ana");
    expect(fields.phone).toBe("3001234567");
    expect(fields.email).toBeUndefined();
    expect(fields.documentNumber).toBeUndefined();
    expect(fields.address).toBeUndefined();
    expect(fields.notes).toBeUndefined();
  });

  it("el tipo de documento preseleccionado (CC) NO se guarda si no hay número", () => {
    const fields = normalizeCustomerFields({ name: "Ana", phone: "3001234567", documentType: "NIT" });
    expect(fields.documentType).toBeUndefined();
    expect(fields.documentNumber).toBeUndefined();
  });

  it("con número fiscal se guarda el tipo elegido", () => {
    const fields = normalizeCustomerFields({
      name: "Empresa SAS",
      phone: "3001234567",
      documentType: "NIT",
      documentNumber: " 900123456-7 "
    });
    expect(fields.documentType).toBe("NIT");
    expect(fields.documentNumber).toBe("900123456-7");
  });

  it("con número pero sin tipo se asume CC", () => {
    expect(normalizeCustomerFields({ name: "Ana", phone: "3001234567", documentNumber: "123" }).documentType).toBe("CC");
  });

  it("guarda correo, dirección y notas/preferencias cuando se escriben", () => {
    const fields = normalizeCustomerFields({
      name: "Ana",
      phone: "3001234567",
      email: " ana@correo.com ",
      address: " Calle 10 # 5-20 ",
      notes: " Sin cebolla. Alérgica al maní. "
    });
    expect(fields.email).toBe("ana@correo.com");
    expect(fields.address).toBe("Calle 10 # 5-20");
    expect(fields.notes).toBe("Sin cebolla. Alérgica al maní.");
  });
});

describe("buildNewCustomer", () => {
  it("un alta mínima (nombre + teléfono) arma un Customer válido con 0 puntos", () => {
    const customer = buildNewCustomer({ name: "Ana", phone: "300 123 4567" }, META);
    expect(customer).toMatchObject({
      id: "c-1",
      name: "Ana",
      phone: "300 123 4567",
      points: 0,
      createdAt: META.createdAt
    });
  });

  it("no persiste cadenas vacías: el JSON guardado solo lleva lo que se escribió", () => {
    const customer = buildNewCustomer({ name: "Ana", phone: "3001234567", email: "", notes: "" }, META);
    const stored = JSON.parse(JSON.stringify(customer)) as Record<string, unknown>;
    expect(Object.keys(stored).sort()).toEqual(["createdAt", "id", "name", "phone", "points"]);
  });
});