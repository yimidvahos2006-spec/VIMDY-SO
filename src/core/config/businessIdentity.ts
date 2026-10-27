import {
  AVAILABLE_COUNTRIES,
  getCurrency,
  getCurrencyName,
  type CurrencyCode
} from "./globalization";

/**
 * Identidad del negocio (Paso "Tu negocio" del onboarding).
 *
 * Este archivo es PURO: no usa React, ni Supabase, ni localStorage. Solo
 * limpia lo que el dueño escribe y dice si es válido. Así se puede probar
 * sin navegador y se reutiliza en Configuración si algún día hace falta.
 */

export interface BusinessIdentity {
  /** Nombre del establecimiento tal como sale en tiquetes (ej. "Asados Doña Inés"). */
  name: string;
  /** NIT o cédula, normalizado: solo dígitos y, si lo escribió, "-DV" (ej. "900123456-7"). */
  taxId: string;
  /** Código de moneda (ej. "COP"). */
  currency: CurrencyCode;
  /** Ciudad o ubicación, texto libre (puede quedar vacío). */
  city: string;
}

export type BusinessIdentityField = keyof BusinessIdentity;
export type BusinessIdentityErrors = Partial<Record<BusinessIdentityField, string>>;

export const BUSINESS_NAME_MIN = 2;
export const BUSINESS_NAME_MAX = 120;
export const CITY_MAX = 80;
/** Mismo tope que usa buildBusinessSettingsUpdate para el NIT. */
export const TAX_ID_MAX = 40;

export const DEFAULT_CURRENCY: CurrencyCode = "COP";

/** Nombre que usa businessStore antes de cargar el negocio real: nunca es un nombre de verdad. */
const PLACEHOLDER_BUSINESS_NAMES = new Set(["vimdy demo"]);

export function isPlaceholderBusinessName(name: string): boolean {
  return PLACEHOLDER_BUSINESS_NAMES.has(name.trim().toLowerCase());
}

/** Ciudades de acceso rápido (solo se muestran si el negocio es de Colombia). */
export const COLOMBIA_CITY_SHORTCUTS: readonly string[] = [
  "Medellín",
  "Bogotá",
  "Cali",
  "Barranquilla",
  "Cartagena",
  "Bucaramanga"
];

/**
 * Monedas que se ofrecen en el asistente: las de los países que VIMDY ya
 * tiene disponibles, sin repetir. COP siempre va primero (es el valor por defecto).
 */
export const ONBOARDING_CURRENCY_CODES: readonly CurrencyCode[] = (() => {
  const codes = new Set<CurrencyCode>([DEFAULT_CURRENCY]);
  for (const country of AVAILABLE_COUNTRIES) codes.add(country.currency);
  return Array.from(codes);
})();

export interface CurrencyOption {
  code: CurrencyCode;
  /** Texto para el desplegable, ej. "$ · COP — peso colombiano". */
  label: string;
}

export function getOnboardingCurrencyOptions(): CurrencyOption[] {
  return ONBOARDING_CURRENCY_CODES.map((code) => {
    const symbol = getCurrency(code)?.symbol ?? code;
    return { code, label: `${symbol} · ${code} — ${getCurrencyName(code, "es")}` };
  });
}

export function isOnboardingCurrency(value: unknown): value is CurrencyCode {
  return typeof value === "string" && (ONBOARDING_CURRENCY_CODES as readonly string[]).includes(value);
}

/* ---------------------------------------------------------------------------
   Limpieza de texto
--------------------------------------------------------------------------- */

/** Quita espacios de los bordes y junta espacios repetidos. */
export function normalizeBusinessName(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, BUSINESS_NAME_MAX);
}

export function normalizeCity(value: string): string {
  return value.replace(/\s+/g, " ").trim().slice(0, CITY_MAX);
}

/**
 * Deja el NIT/cédula en su forma canónica: sin puntos ni espacios, y con el
 * guion solo si hay dígito de verificación. "900.123.456 - 7" → "900123456-7".
 * Cualquier letra o símbolo se descarta (no existen en un NIT colombiano).
 */
export function normalizeTaxId(value: string): string {
  const compact = value.replace(/[^\d-]/g, "");
  const [base = "", ...rest] = compact.split("-");
  const verifier = rest.join("").slice(0, 1);
  const hasDash = compact.includes("-");
  const normalized = hasDash ? `${base}-${verifier}` : base;
  return normalized.slice(0, TAX_ID_MAX);
}

/**
 * Para MOSTRAR en el campo mientras se escribe: solo permite dígitos, puntos,
 * espacios y un guion. No reformatea para no mover el cursor del usuario.
 */
export function sanitizeTaxIdTyping(value: string): string {
  return value.replace(/[^\d.\-\s]/g, "").slice(0, TAX_ID_MAX);
}

/* ---------------------------------------------------------------------------
   Dígito de verificación del NIT (algoritmo oficial de la DIAN)
--------------------------------------------------------------------------- */

const NIT_WEIGHTS = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71] as const;

/** Calcula el dígito de verificación de un NIT (solo la parte numérica, sin guion). */
export function computeNitVerifier(base: string): number {
  const digits = base.split("").reverse();
  let sum = 0;
  digits.forEach((char, index) => {
    sum += Number(char) * (NIT_WEIGHTS[index] ?? 0);
  });
  const remainder = sum % 11;
  return remainder > 1 ? 11 - remainder : remainder;
}

/* ---------------------------------------------------------------------------
   Validación
--------------------------------------------------------------------------- */

export function validateBusinessName(raw: string): string | null {
  const name = normalizeBusinessName(raw);
  if (!name) return "Escribe el nombre de tu establecimiento.";
  if (name.length < BUSINESS_NAME_MIN) return "El nombre es muy corto.";
  if (!/[\p{L}\p{N}]/u.test(name)) return "El nombre debe tener letras o números.";
  return null;
}

/**
 * Acepta cédula o NIT: 5 a 12 dígitos, con dígito de verificación opcional
 * ("900123456-7"). Si el usuario escribe el dígito de verificación, se
 * comprueba: un número mal digitado saldría mal en los tiquetes y en la
 * facturación electrónica.
 */
export function validateTaxId(raw: string): string | null {
  const taxId = normalizeTaxId(raw);
  if (!taxId) return "Escribe el NIT o la cédula del negocio.";

  const match = /^(\d+)(?:-(\d?))?$/.exec(taxId);
  if (!match) return "Usa solo números. Ejemplo: 900.123.456-7";

  const base = match[1] ?? "";
  const verifier = match[2];

  if (base.length < 5) return "El NIT o la cédula es muy corto.";
  if (base.length > 12) return "El NIT o la cédula es muy largo.";
  if (/^0+$/.test(base)) return "El NIT o la cédula no es válido.";

  if (taxId.includes("-")) {
    if (verifier === undefined || verifier === "") {
      return "Falta el dígito de verificación después del guion.";
    }
    if (computeNitVerifier(base) !== Number(verifier)) {
      return "El dígito de verificación no coincide. Revisa el NIT (el número después del guion).";
    }
  }

  return null;
}

export function validateBusinessIdentity(
  input: Pick<BusinessIdentity, "name" | "taxId" | "city"> & { currency: string }
): BusinessIdentityErrors {
  const errors: BusinessIdentityErrors = {};

  const nameError = validateBusinessName(input.name);
  if (nameError) errors.name = nameError;

  const taxIdError = validateTaxId(input.taxId);
  if (taxIdError) errors.taxId = taxIdError;

  if (!isOnboardingCurrency(input.currency)) errors.currency = "Elige una moneda de la lista.";

  return errors;
}

export function hasIdentityErrors(errors: BusinessIdentityErrors): boolean {
  return Object.keys(errors).length > 0;
}

/**
 * Valida y devuelve la identidad lista para guardar. Lanza un Error con el
 * primer mensaje en español si algo obligatorio falta o es inválido.
 */
export function buildBusinessIdentity(input: {
  name: string;
  taxId: string;
  currency: string;
  city: string;
}): BusinessIdentity {
  const errors = validateBusinessIdentity(input);
  const firstError = errors.name ?? errors.taxId ?? errors.currency;
  if (firstError) throw new Error(firstError);

  return {
    name: normalizeBusinessName(input.name),
    taxId: normalizeTaxId(input.taxId),
    currency: input.currency as CurrencyCode,
    city: normalizeCity(input.city)
  };
}