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
  const lang = language ?? companyConfigStore.get().language;
  const digits = getCurrencyDecimalDigits(currency);

  try {
    return new Intl.NumberFormat(lang, {
      style: "currency",
      currency,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits
    }).format(roundMoney(value, currency));
  } catch {
    // Código de moneda o idioma no reconocido por Intl — evita que la app se rompa.
    return `${roundMoney(value, currency).toLocaleString("es-CO")} ${currency}`;
  }
}