import { getCurrencyDecimalDigits, roundMoney } from "../config/globalization";
import { companyConfigStore } from "../store/companyConfigStore";

/**
 * formatMoney
 * ---------------------------------------------------------------------------
 * Única fuente de verdad para formatear cifras de dinero en la IA de VIMDY
 * (Copiloto, QuestionRouter, Dashboard). Antes cada archivo tenía su propia
 * copia de `Math.round(value).toLocaleString("es-CO")` fija — bastaba con
 * que el negocio no fuera colombiano para que el símbolo y el separador
 * salieran mal.
 *
 * Usa Intl.NumberFormat con el idioma activo de VIMDY (companyConfigStore,
 * por defecto — o el que se pase explícito) y los decimales reales de la
 * moneda (src/core/config/globalization.ts: 0 para COP/CLP/JPY..., 2 para
 * el resto), así un negocio en México ve "$1,250.50 MXN" (sí lleva
 * centavos) y uno en Colombia ve "$1.250" (sin centavos) — el idioma
 * decide separadores y orden, la moneda decide símbolo y decimales.
 */
export function formatMoney(value: number, currency: string, language?: string): string {
  const lang = resolveLocale(language ?? companyConfigStore.get().language);
  const normalizedCurrency = (currency || "").trim().toUpperCase();
  const digits = getCurrencyDecimalDigits(normalizedCurrency);
  const rounded = roundMoney(value, normalizedCurrency);

  try {
    // narrowSymbol: "$" en vez de "COP" / "US$", y sin espacio entre símbolo y cifra
    // ("$36.000", no "$ 36.000" ni "36.000 COP"), igual que el resto de pantallas.
    const parts = new Intl.NumberFormat(lang, {
      style: "currency",
      currency: normalizedCurrency,
      currencyDisplay: "narrowSymbol",
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).formatToParts(rounded);
    const text = parts.map((part) => part.value).join("");
    const symbolFirst = parts.findIndex((p) => p.type === "currency") < parts.findIndex((p) => p.type === "integer");
    return symbolFirst ? text.replace(/(\p{Sc}|[A-Za-z]+)[\s\u00a0\u202f]+(?=[-\d])/u, "$1") : text;
  } catch {
    const formatted = new Intl.NumberFormat(lang, {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(rounded);
    return `${formatted} ${normalizedCurrency}`;
  }
}

/**
 * "es" a secas hace que Intl escriba "36.000 COP" (formato de España). Con el
 * país del negocio ("es-CO") sale "$36.000", que es lo que espera quien vende.
 */
function resolveLocale(language: string): string {
  if (language.includes("-")) return language;
  const country = companyConfigStore.get().country;
  const candidate = country ? `${language}-${country}` : language;
  try {
    return Intl.NumberFormat.supportedLocalesOf([candidate]).length > 0 ? candidate : language;
  } catch {
    return language;
  }
}