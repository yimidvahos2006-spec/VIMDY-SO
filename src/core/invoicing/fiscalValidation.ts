/**
 * fiscalValidation.ts
 * ---------------------------------------------------------------------------
 * Normalización y validación (puras, sin red) de la identidad fiscal del
 * negocio. Las usa el formulario de Ajustes > Facturación y, otra vez, el
 * repositorio justo antes de escribir (defensa doble).
 */

import type { BusinessFiscalIdentity } from "./types/fiscal.types";

export type FiscalIdentityErrors = Partial<Record<keyof BusinessFiscalIdentity, string>>;

/** Pesos oficiales del módulo 11 de la DIAN, de derecha a izquierda. */
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];

/**
 * Dígito de verificación (DV) de un NIT/cédula colombiano (módulo 11 DIAN).
 * Devuelve null si `nit` no son entre 1 y 15 dígitos.
 */
export function computeNitVerificationDigit(nit: string): string | null {
  if (!/^\d{1,15}$/.test(nit)) return null;
  let sum = 0;
  for (let i = 0; i < nit.length; i++) {
    sum += Number(nit[nit.length - 1 - i]) * NIT_WEIGHTS[i];
  }
  const remainder = sum % 11;
  return String(remainder > 1 ? 11 - remainder : remainder);
}

/**
 * Limpia lo escrito: quita espacios, deja el NIT solo en dígitos (acepta
 * "900.123.456-7": separa el DV si el campo DV estaba vacío), prefijo en
 * MAYÚSCULAS y correo en minúsculas.
 */
export function normalizeFiscalIdentity(input: BusinessFiscalIdentity): BusinessFiscalIdentity {
  let nitRaw = input.nit.trim();
  let dv = input.verificationDigit.trim();

  const withDv = nitRaw.match(/^([\d.\s]+)-\s*(\d)$/);
  if (withDv) {
    nitRaw = withDv[1];
    if (dv === "") dv = withDv[2];
  }

  return {
    nit: nitRaw.replace(/\D/g, ""),
    verificationDigit: dv,
    legalName: input.legalName.trim().replace(/\s+/g, " "),
    organizationType: input.organizationType,
    address: input.address.trim().replace(/\s+/g, " "),
    city: input.city.trim().replace(/\s+/g, " "),
    department: input.department.trim().replace(/\s+/g, " "),
    phone: input.phone.trim(),
    email: input.email.trim().toLowerCase(),
    invoicePrefix: input.invoicePrefix.trim().toUpperCase()
  };
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Valida una identidad YA normalizada. Devuelve un objeto vacío si todo está
 * bien; si no, un mensaje en español por campo.
 */
export function validateFiscalIdentity(i: BusinessFiscalIdentity): FiscalIdentityErrors {
  const errors: FiscalIdentityErrors = {};

  if (!/^\d{5,10}$/.test(i.nit)) {
    errors.nit = "Escribe el NIT o cédula con 5 a 10 dígitos, sin puntos ni dígito de verificación.";
  }

  if (!/^\d$/.test(i.verificationDigit)) {
    errors.verificationDigit = "Escribe el dígito de verificación (un solo número).";
  } else if (!errors.nit) {
    const expected = computeNitVerificationDigit(i.nit);
    if (expected !== null && expected !== i.verificationDigit) {
      errors.verificationDigit = `No coincide con el NIT: debería ser ${expected}.`;
    }
  }

  if (i.legalName.length < 3 || i.legalName.length > 200) {
    errors.legalName = "Escribe la razón social tal como aparece en el RUT (3 a 200 caracteres).";
  }

  if (i.organizationType === "") {
    errors.organizationType = "Elige si eres persona natural o jurídica.";
  }

  if (i.address.length < 5 || i.address.length > 200) {
    errors.address = "Escribe la dirección fiscal completa (5 a 200 caracteres).";
  }

  if (i.city.length < 2 || i.city.length > 80) {
    errors.city = "Escribe la ciudad o municipio.";
  }

  if (i.department.length < 2 || i.department.length > 80) {
    errors.department = "Escribe el departamento.";
  }

  if (i.phone !== "") {
    const digits = i.phone.replace(/\D/g, "");
    if (digits.length < 7 || digits.length > 15 || !/^[\d\s+()-]+$/.test(i.phone)) {
      errors.phone = "Escribe un teléfono válido (7 a 15 dígitos) o déjalo vacío.";
    }
  }

  if (!EMAIL_RE.test(i.email) || i.email.length > 120) {
    errors.email = "Escribe un correo válido, por ejemplo facturas@minegocio.co.";
  }

  if (i.invoicePrefix !== "" && !/^[A-Z0-9]{1,10}$/.test(i.invoicePrefix)) {
    errors.invoicePrefix = "El prefijo usa solo letras y números (hasta 10), por ejemplo SETP o FV.";
  }

  return errors;
}

/** Atajo: normaliza y valida; devuelve ambos. */
export function prepareFiscalIdentity(input: BusinessFiscalIdentity): {
  identity: BusinessFiscalIdentity;
  errors: FiscalIdentityErrors;
} {
  const identity = normalizeFiscalIdentity(input);
  return { identity, errors: validateFiscalIdentity(identity) };
}