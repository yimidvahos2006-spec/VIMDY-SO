// src/core/domain/customers/phone.ts
/* ===========================================================================
   Normalización de teléfonos de clientes — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   Por qué existe: hoy la unicidad de clientes en Postgres se calcula con
   regexp_replace(phone, '[^0-9A-Za-z]', '') — "+57 300 123 4567" y
   "300 123 4567" quedan como números DISTINTOS y el mismo cliente se
   duplica. Aquí hay UNA sola regla de normalización: todo teléfono se guarda
   en formato E.164 ("+573001234567"), que es lo que luego valida el CHECK de
   la columna customers_v2.phone_e164 y lo que usa WhatsApp.

   Alcance honesto: valida FORMA (prefijo de país, largo, primer dígito),
   no que la línea exista ni a qué operador pertenece. Los países soportados
   en modo nacional (sin "+") son los 9 con impuesto verificado; el resto de
   países solo entra en formato internacional (+código).
=========================================================================== */

export type PhoneCountry = "CO" | "MX" | "PE" | "CL" | "AR" | "ES" | "EC" | "PA" | "US";

export type PhoneRejection =
  | "EMPTY"
  | "INVALID_CHARACTERS"
  | "TOO_SHORT"
  | "TOO_LONG"
  | "INVALID_FORMAT"
  | "MISSING_AREA_CODE"
  | "NATIONAL_FORMAT_UNSUPPORTED";

export type NormalizedPhone =
  | {
      readonly ok: true;
      /** Formato E.164 con "+" — es también la llave de unicidad. */
      readonly e164: string;
      /** Código de país sin "+" (ej. "57"). */
      readonly callingCode: string;
      /** País si el prefijo es uno de los soportados; null si es otro país. */
      readonly country: PhoneCountry | null;
    }
  | { readonly ok: false; readonly reason: PhoneRejection };

interface CountrySpec {
  readonly country: PhoneCountry;
  readonly callingCode: string;
  /** Largos válidos del número nacional (sin prefijo de país ni "0" troncal). */
  readonly nationalLengths: readonly number[];
  readonly pattern: RegExp;
  /** Prefijo troncal "0" que se marca localmente y NO forma parte del E.164. */
  readonly trunkZero: boolean;
  /** false = solo se acepta en formato internacional (no se adivina el formato local). */
  readonly allowNational: boolean;
}

// Orden importa: códigos más largos primero para que +593 no se confunda con otro.
const COUNTRY_SPECS: readonly CountrySpec[] = [
  { country: "EC", callingCode: "593", nationalLengths: [9], pattern: /^9\d{8}$/, trunkZero: true, allowNational: true },
  { country: "PA", callingCode: "507", nationalLengths: [7, 8], pattern: /^(6\d{7}|[2-5]\d{6})$/, trunkZero: false, allowNational: true },
  { country: "CO", callingCode: "57", nationalLengths: [10], pattern: /^(3\d{9}|60[1-8]\d{7})$/, trunkZero: false, allowNational: true },
  { country: "MX", callingCode: "52", nationalLengths: [10], pattern: /^[2-9]\d{9}$/, trunkZero: false, allowNational: true },
  { country: "PE", callingCode: "51", nationalLengths: [9], pattern: /^9\d{8}$/, trunkZero: false, allowNational: true },
  { country: "CL", callingCode: "56", nationalLengths: [9], pattern: /^[2-9]\d{8}$/, trunkZero: false, allowNational: true },
  { country: "AR", callingCode: "54", nationalLengths: [10, 11], pattern: /^(9\d{10}|[1-8]\d{9})$/, trunkZero: false, allowNational: false },
  { country: "ES", callingCode: "34", nationalLengths: [9], pattern: /^[6-9]\d{8}$/, trunkZero: false, allowNational: true },
  { country: "US", callingCode: "1", nationalLengths: [10], pattern: /^[2-9]\d{2}[2-9]\d{6}$/, trunkZero: false, allowNational: true }
];

const ALLOWED_CHARS = /^\+?[\d\s().\-\u00A0]+$/;
const E164_MIN_DIGITS = 8;
const E164_MAX_DIGITS = 15;

function specByCountry(country: PhoneCountry): CountrySpec {
  const spec = COUNTRY_SPECS.find((s) => s.country === country);
  if (!spec) throw new Error(`PHONE_COUNTRY_UNSUPPORTED:${country}`);
  return spec;
}

function validateNational(spec: CountrySpec, national: string): PhoneRejection | null {
  if (!spec.nationalLengths.includes(national.length)) {
    const min = Math.min(...spec.nationalLengths);
    const max = Math.max(...spec.nationalLengths);
    if (national.length < min) {
      // En Colombia un número de 7 dígitos es línea fija sin indicativo de ciudad.
      return spec.country === "CO" && national.length === 7 ? "MISSING_AREA_CODE" : "TOO_SHORT";
    }
    return national.length > max ? "TOO_LONG" : "INVALID_FORMAT";
  }
  return spec.pattern.test(national) ? null : "INVALID_FORMAT";
}

function fromInternationalDigits(digits: string): NormalizedPhone {
  if (digits.length < E164_MIN_DIGITS) return { ok: false, reason: "TOO_SHORT" };
  if (digits.length > E164_MAX_DIGITS) return { ok: false, reason: "TOO_LONG" };
  if (digits.startsWith("0")) return { ok: false, reason: "INVALID_FORMAT" };

  const spec = COUNTRY_SPECS.find((s) => digits.startsWith(s.callingCode));
  if (!spec) {
    // País fuera de la lista: se acepta con las reglas generales de E.164.
    return { ok: true, e164: `+${digits}`, callingCode: "", country: null };
  }

  let national = digits.slice(spec.callingCode.length);
  // México usó "+52 1 ..." para celulares hasta 2019; hoy el 1 ya no va.
  if (spec.country === "MX" && national.length === 11 && national.startsWith("1")) {
    national = national.slice(1);
  }

  const rejection = validateNational(spec, national);
  if (rejection) return { ok: false, reason: rejection };
  return {
    ok: true,
    e164: `+${spec.callingCode}${national}`,
    callingCode: spec.callingCode,
    country: spec.country
  };
}

/**
 * Normaliza un teléfono escrito por una persona a E.164.
 *
 * - Con "+" o "00" al inicio se interpreta como internacional.
 * - Sin eso, se interpreta con las reglas de `defaultCountry`. Si el número
 *   ya trae el código de país sin "+" (ej. "57 300 123 4567") se reconoce
 *   solo cuando el largo total no puede ser un número nacional válido, para
 *   no confundir un número local que casualmente empiece igual.
 */
export function normalizePhone(raw: string | null | undefined, defaultCountry: PhoneCountry): NormalizedPhone {
  const text = (raw ?? "").trim();
  if (text === "") return { ok: false, reason: "EMPTY" };
  if (!ALLOWED_CHARS.test(text)) return { ok: false, reason: "INVALID_CHARACTERS" };
  if (text.indexOf("+") > 0) return { ok: false, reason: "INVALID_CHARACTERS" };

  const digits = text.replace(/\D/g, "");
  if (digits === "") return { ok: false, reason: "EMPTY" };

  if (text.startsWith("+")) return fromInternationalDigits(digits);
  if (digits.startsWith("00")) return fromInternationalDigits(digits.slice(2));

  const spec = specByCountry(defaultCountry);

  // Número nacional que trae el código de país sin "+".
  const withCountryCodeLengths = spec.nationalLengths.map((n) => n + spec.callingCode.length);
  if (
    digits.startsWith(spec.callingCode) &&
    withCountryCodeLengths.includes(digits.length) &&
    !spec.nationalLengths.includes(digits.length)
  ) {
    return fromInternationalDigits(digits);
  }

  if (!spec.allowNational) return { ok: false, reason: "NATIONAL_FORMAT_UNSUPPORTED" };

  let national = digits;
  if (spec.trunkZero && national.startsWith("0")) national = national.slice(1);

  const rejection = validateNational(spec, national);
  if (rejection) return { ok: false, reason: rejection };
  return {
    ok: true,
    e164: `+${spec.callingCode}${national}`,
    callingCode: spec.callingCode,
    country: spec.country
  };
}

/** Misma forma que exige el CHECK de customers_v2.phone_e164 en Postgres. */
export const E164_PATTERN = /^\+[1-9][0-9]{7,14}$/;

export function isE164(value: string): boolean {
  return E164_PATTERN.test(value);
}