import {
  AVAILABLE_COUNTRY_CODES,
  TIMEZONES,
  getCountryDefaults,
  type CountryCode,
  type LanguageCode
} from "../config/globalization";
import type { CompanyConfig } from "../store/companyConfigStore";

/**
 * regionalSettings
 * ---------------------------------------------------------------------------
 * Lógica PURA de la tarjeta "País, idioma y hora" de Configuración.
 *
 * Al elegir un país se sugieren moneda, idioma y zona horaria (más el IVA
 * del país cuando está verificado). El dueño puede cambiar cualquiera de
 * los tres a mano después: este módulo solo calcula la sugerencia, nunca
 * bloquea un ajuste manual.
 */

export type RegionalFields = Pick<CompanyConfig, "country" | "currency" | "language" | "timezone">;

export type CountryChangePatch = RegionalFields &
  Partial<Pick<CompanyConfig, "tax" | "electronicInvoicing">>;

/**
 * Valores sugeridos para un país. Devuelve null si el país no está entre los
 * disponibles (en ese caso la pantalla no cambia nada).
 *
 * - El IVA solo se sugiere cuando el país tiene una tasa verificada (> 0).
 *   Para los países con tasa 0 (sin verificar) se respeta el IVA que el
 *   dueño ya tenía, en vez de borrarlo en silencio.
 * - La facturación electrónica DIAN solo existe en Colombia, así que al
 *   cambiar a otro país se apaga.
 */
export function buildCountryChangePatch(countryCode: string): CountryChangePatch | null {
  const country = AVAILABLE_COUNTRY_CODES.find((code) => code === countryCode);
  if (!country) return null;

  const defaults = getCountryDefaults(country);
  if (!defaults) return null;

  const patch: CountryChangePatch = {
    country,
    currency: defaults.currency,
    language: defaults.language,
    timezone: defaults.timezone
  };

  if (defaults.taxRate > 0) {
    patch.tax = defaults.taxRate;
  }

  if (country !== "CO") {
    patch.electronicInvoicing = { enabled: false, provider: "none" };
  }

  return patch;
}

/** Zonas horarias para el desplegable. Incluye la actual aunque no esté en el catálogo. */
export function getTimezoneOptions(current: string): string[] {
  const trimmed = current.trim();
  if (trimmed === "" || TIMEZONES.includes(trimmed)) return TIMEZONES;
  return [...TIMEZONES, trimmed].sort();
}

/** true si el dueño ajustó a mano moneda, idioma o zona respecto a lo sugerido para su país. */
export function differsFromCountryDefaults(regional: RegionalFields): boolean {
  const defaults = getCountryDefaults(regional.country);
  if (!defaults) return false;
  return (
    defaults.currency !== regional.currency ||
    defaults.language !== regional.language ||
    defaults.timezone !== regional.timezone
  );
}

export function isValidTimeZone(timeZone: string): boolean {
  if (typeof timeZone !== "string" || timeZone.trim() === "") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Configuración regional para formatear números y fechas según el idioma de VIMDY. */
export function localeForLanguage(language: LanguageCode): string {
  switch (language) {
    case "en":
      return "en-US";
    case "pt":
      return "pt-BR";
    case "es":
      return "es-CO";
  }
}