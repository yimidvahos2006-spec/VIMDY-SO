// src/core/domain/customers/document.ts
/* ===========================================================================
   Normalización de documentos de clientes (CC, CE, NIT, pasaporte, otro).
   ---------------------------------------------------------------------------
   Dominio puro (sin I/O). Produce la "llave" que luego usa Postgres para la
   unicidad por negocio (customers_v2.document_key) y el valor canónico que
   se muestra y se manda a facturación electrónica.

   NIT colombiano: se valida el dígito de verificación (DV) con el algoritmo
   oficial de la DIAN (módulo 11 con primos). La llave de unicidad es la BASE
   (sin DV), así "900.123.456-7", "900123456-7" y "900123456" son el mismo
   cliente. Sin guion NO se intenta adivinar si el último dígito es DV: un
   número de 10 dígitos puede ser un NIT de persona natural (cédula) sin DV.

   Alcance honesto: valida forma y DV, no que el documento exista en el RUES
   ni en la Registraduría.
=========================================================================== */

export type DocumentType = "CC" | "CE" | "NIT" | "PASSPORT" | "OTHER";

export type DocumentRejection =
  | "EMPTY"
  | "INVALID_CHARACTERS"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "CHECK_DIGIT_MISMATCH"
  | "FINAL_CONSUMER_PLACEHOLDER";

export type NormalizedDocument =
  | {
      readonly ok: true;
      readonly type: DocumentType;
      /** Número en su forma canónica (para NIT: "base-dv"). */
      readonly number: string;
      /** Llave de unicidad: para NIT es la base sin DV. */
      readonly key: string;
      /** Solo NIT: dígito de verificación (el recibido, ya verificado, o el calculado). */
      readonly checkDigit?: number;
    }
  | { readonly ok: false; readonly reason: DocumentRejection };

/** Identificación genérica que la DIAN usa para "consumidor final". No identifica a nadie. */
export const FINAL_CONSUMER_DOCUMENT = "222222222222";

// Pesos oficiales DIAN, aplicados de derecha a izquierda sobre la base del NIT.
const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

const NIT_BASE_MIN = 6;
const NIT_BASE_MAX = 10;

/** Dígito de verificación DIAN de una base de NIT (solo dígitos, 1 a 15). */
export function computeNitCheckDigit(base: string): number {
  if (!/^\d{1,15}$/.test(base)) throw new Error("NIT_BASE_INVALID");
  let sum = 0;
  for (let i = 0; i < base.length; i += 1) {
    const digit = Number(base[base.length - 1 - i]);
    sum += digit * NIT_WEIGHTS[i];
  }
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

function normalizeNit(raw: string): NormalizedDocument {
  // Los puntos y espacios son solo formato; el guion separa el DV.
  const cleaned = raw.replace(/[\s.]/g, "");
  if (!/^\d+(-\d)?$/.test(cleaned)) return { ok: false, reason: "INVALID_CHARACTERS" };

  const hasCheckDigit = cleaned.includes("-");
  const [base, givenDv] = cleaned.split("-");

  if (base.length < NIT_BASE_MIN) return { ok: false, reason: "TOO_SHORT" };
  if (base.length > NIT_BASE_MAX) return { ok: false, reason: "TOO_LONG" };

  const expected = computeNitCheckDigit(base);
  if (hasCheckDigit && Number(givenDv) !== expected) {
    return { ok: false, reason: "CHECK_DIGIT_MISMATCH" };
  }

  return { ok: true, type: "NIT", number: `${base}-${expected}`, key: base, checkDigit: expected };
}

function normalizeDigitsOnly(type: "CC" | "CE", raw: string, min: number, max: number): NormalizedDocument {
  const digits = raw.replace(/[\s.\-]/g, "");
  if (!/^\d+$/.test(digits)) return { ok: false, reason: "INVALID_CHARACTERS" };
  if (digits.length < min) return { ok: false, reason: "TOO_SHORT" };
  if (digits.length > max) return { ok: false, reason: "TOO_LONG" };
  return { ok: true, type, number: digits, key: digits };
}

function normalizeAlphanumeric(type: "PASSPORT" | "OTHER", raw: string): NormalizedDocument {
  const value = raw.replace(/[\s\-]/g, "").toUpperCase();
  if (!/^[A-Z0-9]+$/.test(value)) return { ok: false, reason: "INVALID_CHARACTERS" };
  if (value.length < 5) return { ok: false, reason: "TOO_SHORT" };
  if (value.length > 20) return { ok: false, reason: "TOO_LONG" };
  return { ok: true, type, number: value, key: value };
}

export function normalizeDocument(type: DocumentType, raw: string | null | undefined): NormalizedDocument {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, reason: "EMPTY" };

  if (text.replace(/[\s.\-]/g, "") === FINAL_CONSUMER_DOCUMENT) {
    return { ok: false, reason: "FINAL_CONSUMER_PLACEHOLDER" };
  }

  switch (type) {
    case "NIT":
      return normalizeNit(text);
    case "CC":
      return normalizeDigitsOnly("CC", text, 6, 10);
    case "CE":
      return normalizeDigitsOnly("CE", text, 5, 10);
    case "PASSPORT":
    case "OTHER":
      return normalizeAlphanumeric(type, text);
  }
}