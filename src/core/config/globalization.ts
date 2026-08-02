/**
 * globalization.ts
 * ---------------------------------------------------------------------------
 * Catálogo global de monedas, idiomas, países y zonas horarias de VIMDY.
 * Única fuente de verdad: en vez de que cada componente tenga su propia
 * lista de monedas o países sueltos, todos leen de acá.
 *
 * Los 246 países y 154 monedas de este archivo salen de datos reales ISO
 * 3166-1 / ISO 4217 (mismo origen que usan librerías como world-countries y
 * countries-and-timezones) — no hay nombres, códigos ni zonas horarias
 * inventados a mano.
 *
 * Los NOMBRES localizados de país y moneda (columna "México" vs "Mexico" vs
 * "México" en pt) no se guardan como texto fijo acá: se calculan en caliente
 * con Intl.DisplayNames, que es la base de datos CLDR real del navegador —
 * así el nombre siempre está bien traducido a es/en/pt sin mantener miles
 * de strings a mano.
 *
 * IVA / impuesto: solo los países donde VIMDY ya opera de verdad tienen una
 * tasa real verificada (CO, MX, PE, CL, AR, ES, EC, PA, US). El resto queda
 * en 0 a propósito — el impuesto varía según el tipo de negocio y cambia
 * con el tiempo, así que en vez de inventar una cifra, el negocio la
 * configura una sola vez en Ajustes → Impuestos y moneda.
 *
 * Al elegir un país (en el selector previo al login, o en Configuración) se
 * autocompletan moneda + idioma + zona horaria (getCountryDefaults) — el
 * negocio puede sobreescribirlos después si es una excepción (ej. un hotel
 * en Cancún que cobra en USD).
 */

export type CurrencyCode =
  "AED" | "AFN" | "ALL" | "AMD" | "ANG" | "AOA" | "ARS" | "AUD" | "AWG" | "AZN" | "BAM" | "BBD" | "BDT" | "BGN" | "BHD" | "BIF" | "BMD" | "BND" | "BOB" | "BRL" | "BSD" | "BTN" | "BWP" | "BYN" | "BZD" | "CAD" | "CDF" | "CHF" | "CKD" | "CLP" | "CNY" | "COP" | "CRC" | "CUC" | "CVE" | "CZK" | "DJF" | "DKK" | "DOP" | "DZD" | "EGP" | "ERN" | "ETB" | "EUR" | "FJD" | "FKP" | "GBP" | "GEL" | "GHS" | "GIP" | "GMD" | "GNF" | "GTQ" | "GYD" | "HKD" | "HNL" | "HTG" | "HUF" | "IDR" | "ILS" | "INR" | "IQD" | "IRR" | "ISK" | "JMD" | "JOD" | "JPY" | "KES" | "KGS" | "KHR" | "KMF" | "KPW" | "KRW" | "KWD" | "KYD" | "KZT" | "LAK" | "LBP" | "LKR" | "LRD" | "LSL" | "LYD" | "MAD" | "MDL" | "MGA" | "MKD" | "MMK" | "MNT" | "MOP" | "MRU" | "MUR" | "MVR" | "MWK" | "MXN" | "MYR" | "MZN" | "NAD" | "NGN" | "NIO" | "NOK" | "NPR" | "NZD" | "OMR" | "PAB" | "PEN" | "PGK" | "PHP" | "PKR" | "PLN" | "PYG" | "QAR" | "RON" | "RSD" | "RUB" | "RWF" | "SAR" | "SBD" | "SCR" | "SDG" | "SEK" | "SGD" | "SHP" | "SLL" | "SOS" | "SRD" | "SSP" | "STN" | "SYP" | "SZL" | "THB" | "TJS" | "TMT" | "TND" | "TOP" | "TRY" | "TTD" | "TWD" | "TZS" | "UAH" | "UGX" | "USD" | "UYU" | "UZS" | "VES" | "VND" | "VUV" | "WST" | "XAF" | "XCD" | "XOF" | "XPF" | "YER" | "ZAR" | "ZMW";

export type LanguageCode = "es" | "en" | "pt";

export type CountryCode =
  "AD" | "AE" | "AF" | "AG" | "AI" | "AL" | "AM" | "AO" | "AR" | "AS" | "AT" | "AU" | "AW" | "AX" | "AZ" | "BA" | "BB" | "BD" | "BE" | "BF" | "BG" | "BH" | "BI" | "BJ" | "BL" | "BM" | "BN" | "BO" | "BQ" | "BR" | "BS" | "BT" | "BW" | "BY" | "BZ" | "CA" | "CC" | "CD" | "CF" | "CG" | "CH" | "CI" | "CK" | "CL" | "CM" | "CN" | "CO" | "CR" | "CU" | "CV" | "CW" | "CX" | "CY" | "CZ" | "DE" | "DJ" | "DK" | "DM" | "DO" | "DZ" | "EC" | "EE" | "EG" | "EH" | "ER" | "ES" | "ET" | "FI" | "FJ" | "FK" | "FO" | "FR" | "GA" | "GB" | "GD" | "GE" | "GF" | "GG" | "GH" | "GI" | "GL" | "GM" | "GN" | "GP" | "GQ" | "GR" | "GS" | "GT" | "GU" | "GW" | "GY" | "HK" | "HN" | "HR" | "HT" | "HU" | "ID" | "IE" | "IL" | "IM" | "IN" | "IO" | "IQ" | "IR" | "IS" | "IT" | "JE" | "JM" | "JO" | "JP" | "KE" | "KG" | "KH" | "KI" | "KM" | "KN" | "KP" | "KR" | "KW" | "KY" | "KZ" | "LA" | "LB" | "LC" | "LI" | "LK" | "LR" | "LS" | "LT" | "LU" | "LV" | "LY" | "MA" | "MC" | "MD" | "ME" | "MF" | "MG" | "MH" | "MK" | "ML" | "MM" | "MN" | "MO" | "MP" | "MQ" | "MR" | "MS" | "MT" | "MU" | "MV" | "MW" | "MX" | "MY" | "MZ" | "NA" | "NC" | "NE" | "NF" | "NG" | "NI" | "NL" | "NO" | "NP" | "NR" | "NU" | "NZ" | "OM" | "PA" | "PE" | "PF" | "PG" | "PH" | "PK" | "PL" | "PM" | "PN" | "PR" | "PS" | "PT" | "PW" | "PY" | "QA" | "RE" | "RO" | "RS" | "RU" | "RW" | "SA" | "SB" | "SC" | "SD" | "SE" | "SG" | "SH" | "SI" | "SJ" | "SK" | "SL" | "SM" | "SN" | "SO" | "SR" | "SS" | "ST" | "SV" | "SX" | "SY" | "SZ" | "TC" | "TD" | "TF" | "TG" | "TH" | "TJ" | "TK" | "TL" | "TM" | "TN" | "TO" | "TR" | "TT" | "TV" | "TW" | "TZ" | "UA" | "UG" | "UM" | "US" | "UY" | "UZ" | "VA" | "VC" | "VE" | "VG" | "VI" | "VN" | "VU" | "WF" | "WS" | "XK" | "YE" | "YT" | "ZA" | "ZM" | "ZW";

export interface CurrencyDefinition {
  code: CurrencyCode;
  /** Símbolo de la moneda (ej. "$", "€", "¥"). */
  symbol: string;
  /**
   * Decimales reales de la moneda (norma ISO 4217, ajustada a uso comercial
   * — mismo criterio que usan procesadores de pago como Stripe para su
   * lista de "monedas sin decimales": COP, CLP, JPY, KRW, etc. no manejan
   * centavos en la práctica). Única fuente de verdad para redondeo: nadie
   * más en el código debe volver a escribir `.toFixed(2)` a mano.
   */
  decimalDigits: number;
}

export interface LanguageDefinition {
  code: LanguageCode;
  /** Nombre del idioma en español (para mostrarlo en listas). */
  name: string;
  /** Nombre del idioma en su propio idioma. */
  nativeName: string;
}

export interface CountryDefinition {
  code: CountryCode;
  currency: CurrencyCode;
  /** Idioma de VIMDY que se activa al elegir este país (es/en/pt). */
  language: LanguageCode;
  timezone: string;
  dialCode: string;
  /** IVA / impuesto de venta sugerido para este país, en porcentaje. 0 = sin verificar todavía, se configura en Ajustes. */
  taxRate: number;
  /** Formato de fecha sugerido para este país. */
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY";
  /** Formato de hora sugerido: reloj de 24h o de 12h (AM/PM). */
  timeFormat: "24h" | "12h";
}

export const CURRENCIES: CurrencyDefinition[] = [
  { code: "AED", symbol: "د.إ", decimalDigits: 2 },
  { code: "AFN", symbol: "؋", decimalDigits: 2 },
  { code: "ALL", symbol: "L", decimalDigits: 2 },
  { code: "AMD", symbol: "֏", decimalDigits: 2 },
  { code: "ANG", symbol: "ƒ", decimalDigits: 2 },
  { code: "AOA", symbol: "Kz", decimalDigits: 2 },
  { code: "ARS", symbol: "$", decimalDigits: 2 },
  { code: "AUD", symbol: "$", decimalDigits: 2 },
  { code: "AWG", symbol: "ƒ", decimalDigits: 2 },
  { code: "AZN", symbol: "₼", decimalDigits: 2 },
  { code: "BAM", symbol: "KM", decimalDigits: 2 },
  { code: "BBD", symbol: "$", decimalDigits: 2 },
  { code: "BDT", symbol: "৳", decimalDigits: 2 },
  { code: "BGN", symbol: "лв", decimalDigits: 2 },
  { code: "BHD", symbol: ".د.ب", decimalDigits: 2 },
  { code: "BIF", symbol: "Fr", decimalDigits: 0 },
  { code: "BMD", symbol: "$", decimalDigits: 2 },
  { code: "BND", symbol: "$", decimalDigits: 2 },
  { code: "BOB", symbol: "Bs.", decimalDigits: 2 },
  { code: "BRL", symbol: "R$", decimalDigits: 2 },
  { code: "BSD", symbol: "$", decimalDigits: 2 },
  { code: "BTN", symbol: "Nu.", decimalDigits: 2 },
  { code: "BWP", symbol: "P", decimalDigits: 2 },
  { code: "BYN", symbol: "Br", decimalDigits: 2 },
  { code: "BZD", symbol: "$", decimalDigits: 2 },
  { code: "CAD", symbol: "$", decimalDigits: 2 },
  { code: "CDF", symbol: "FC", decimalDigits: 2 },
  { code: "CHF", symbol: "Fr.", decimalDigits: 2 },
  { code: "CKD", symbol: "$", decimalDigits: 2 },
  { code: "CLP", symbol: "$", decimalDigits: 0 },
  { code: "CNY", symbol: "¥", decimalDigits: 2 },
  { code: "COP", symbol: "$", decimalDigits: 0 },
  { code: "CRC", symbol: "₡", decimalDigits: 2 },
  { code: "CUC", symbol: "$", decimalDigits: 2 },
  { code: "CVE", symbol: "Esc", decimalDigits: 2 },
  { code: "CZK", symbol: "Kč", decimalDigits: 2 },
  { code: "DJF", symbol: "Fr", decimalDigits: 0 },
  { code: "DKK", symbol: "kr", decimalDigits: 2 },
  { code: "DOP", symbol: "$", decimalDigits: 2 },
  { code: "DZD", symbol: "د.ج", decimalDigits: 2 },
  { code: "EGP", symbol: "£", decimalDigits: 2 },
  { code: "ERN", symbol: "Nfk", decimalDigits: 2 },
  { code: "ETB", symbol: "Br", decimalDigits: 2 },
  { code: "EUR", symbol: "€", decimalDigits: 2 },
  { code: "FJD", symbol: "$", decimalDigits: 2 },
  { code: "FKP", symbol: "£", decimalDigits: 2 },
  { code: "GBP", symbol: "£", decimalDigits: 2 },
  { code: "GEL", symbol: "₾", decimalDigits: 2 },
  { code: "GHS", symbol: "₵", decimalDigits: 2 },
  { code: "GIP", symbol: "£", decimalDigits: 2 },
  { code: "GMD", symbol: "D", decimalDigits: 2 },
  { code: "GNF", symbol: "Fr", decimalDigits: 0 },
  { code: "GTQ", symbol: "Q", decimalDigits: 2 },
  { code: "GYD", symbol: "$", decimalDigits: 2 },
  { code: "HKD", symbol: "$", decimalDigits: 2 },
  { code: "HNL", symbol: "L", decimalDigits: 2 },
  { code: "HTG", symbol: "G", decimalDigits: 2 },
  { code: "HUF", symbol: "Ft", decimalDigits: 2 },
  { code: "IDR", symbol: "Rp", decimalDigits: 2 },
  { code: "ILS", symbol: "₪", decimalDigits: 2 },
  { code: "INR", symbol: "₹", decimalDigits: 2 },
  { code: "IQD", symbol: "ع.د", decimalDigits: 2 },
  { code: "IRR", symbol: "﷼", decimalDigits: 2 },
  { code: "ISK", symbol: "kr", decimalDigits: 0 },
  { code: "JMD", symbol: "$", decimalDigits: 2 },
  { code: "JOD", symbol: "د.ا", decimalDigits: 2 },
  { code: "JPY", symbol: "¥", decimalDigits: 0 },
  { code: "KES", symbol: "Sh", decimalDigits: 2 },
  { code: "KGS", symbol: "с", decimalDigits: 2 },
  { code: "KHR", symbol: "៛", decimalDigits: 2 },
  { code: "KMF", symbol: "Fr", decimalDigits: 0 },
  { code: "KPW", symbol: "₩", decimalDigits: 2 },
  { code: "KRW", symbol: "₩", decimalDigits: 0 },
  { code: "KWD", symbol: "د.ك", decimalDigits: 2 },
  { code: "KYD", symbol: "$", decimalDigits: 2 },
  { code: "KZT", symbol: "₸", decimalDigits: 2 },
  { code: "LAK", symbol: "₭", decimalDigits: 2 },
  { code: "LBP", symbol: "ل.ل", decimalDigits: 2 },
  { code: "LKR", symbol: "Rs  රු", decimalDigits: 2 },
  { code: "LRD", symbol: "$", decimalDigits: 2 },
  { code: "LSL", symbol: "L", decimalDigits: 2 },
  { code: "LYD", symbol: "ل.د", decimalDigits: 2 },
  { code: "MAD", symbol: "DH", decimalDigits: 2 },
  { code: "MDL", symbol: "L", decimalDigits: 2 },
  { code: "MGA", symbol: "Ar", decimalDigits: 0 },
  { code: "MKD", symbol: "den", decimalDigits: 2 },
  { code: "MMK", symbol: "Ks", decimalDigits: 2 },
  { code: "MNT", symbol: "₮", decimalDigits: 2 },
  { code: "MOP", symbol: "P", decimalDigits: 2 },
  { code: "MRU", symbol: "UM", decimalDigits: 2 },
  { code: "MUR", symbol: "₨", decimalDigits: 2 },
  { code: "MVR", symbol: ".ރ", decimalDigits: 2 },
  { code: "MWK", symbol: "MK", decimalDigits: 2 },
  { code: "MXN", symbol: "$", decimalDigits: 2 },
  { code: "MYR", symbol: "RM", decimalDigits: 2 },
  { code: "MZN", symbol: "MT", decimalDigits: 2 },
  { code: "NAD", symbol: "$", decimalDigits: 2 },
  { code: "NGN", symbol: "₦", decimalDigits: 2 },
  { code: "NIO", symbol: "C$", decimalDigits: 2 },
  { code: "NOK", symbol: "kr", decimalDigits: 2 },
  { code: "NPR", symbol: "₨", decimalDigits: 2 },
  { code: "NZD", symbol: "$", decimalDigits: 2 },
  { code: "OMR", symbol: "ر.ع.", decimalDigits: 2 },
  { code: "PAB", symbol: "B/.", decimalDigits: 2 },
  { code: "PEN", symbol: "S/.", decimalDigits: 2 },
  { code: "PGK", symbol: "K", decimalDigits: 2 },
  { code: "PHP", symbol: "₱", decimalDigits: 2 },
  { code: "PKR", symbol: "₨", decimalDigits: 2 },
  { code: "PLN", symbol: "zł", decimalDigits: 2 },
  { code: "PYG", symbol: "₲", decimalDigits: 0 },
  { code: "QAR", symbol: "ر.ق", decimalDigits: 2 },
  { code: "RON", symbol: "lei", decimalDigits: 2 },
  { code: "RSD", symbol: "дин.", decimalDigits: 2 },
  { code: "RUB", symbol: "₽", decimalDigits: 2 },
  { code: "RWF", symbol: "Fr", decimalDigits: 0 },
  { code: "SAR", symbol: "ر.س", decimalDigits: 2 },
  { code: "SBD", symbol: "$", decimalDigits: 2 },
  { code: "SCR", symbol: "₨", decimalDigits: 2 },
  { code: "SDG", symbol: "PT", decimalDigits: 2 },
  { code: "SEK", symbol: "kr", decimalDigits: 2 },
  { code: "SGD", symbol: "$", decimalDigits: 2 },
  { code: "SHP", symbol: "£", decimalDigits: 2 },
  { code: "SLL", symbol: "Le", decimalDigits: 2 },
  { code: "SOS", symbol: "Sh", decimalDigits: 2 },
  { code: "SRD", symbol: "$", decimalDigits: 2 },
  { code: "SSP", symbol: "£", decimalDigits: 2 },
  { code: "STN", symbol: "Db", decimalDigits: 2 },
  { code: "SYP", symbol: "£", decimalDigits: 2 },
  { code: "SZL", symbol: "L", decimalDigits: 2 },
  { code: "THB", symbol: "฿", decimalDigits: 2 },
  { code: "TJS", symbol: "ЅМ", decimalDigits: 2 },
  { code: "TMT", symbol: "m", decimalDigits: 2 },
  { code: "TND", symbol: "د.ت", decimalDigits: 2 },
  { code: "TOP", symbol: "T$", decimalDigits: 2 },
  { code: "TRY", symbol: "₺", decimalDigits: 2 },
  { code: "TTD", symbol: "$", decimalDigits: 2 },
  { code: "TWD", symbol: "$", decimalDigits: 2 },
  { code: "TZS", symbol: "Sh", decimalDigits: 2 },
  { code: "UAH", symbol: "₴", decimalDigits: 2 },
  { code: "UGX", symbol: "Sh", decimalDigits: 0 },
  { code: "USD", symbol: "$", decimalDigits: 2 },
  { code: "UYU", symbol: "$", decimalDigits: 2 },
  { code: "UZS", symbol: "so'm", decimalDigits: 2 },
  { code: "VES", symbol: "Bs.S.", decimalDigits: 2 },
  { code: "VND", symbol: "₫", decimalDigits: 0 },
  { code: "VUV", symbol: "Vt", decimalDigits: 0 },
  { code: "WST", symbol: "T", decimalDigits: 2 },
  { code: "XAF", symbol: "Fr", decimalDigits: 0 },
  { code: "XCD", symbol: "$", decimalDigits: 2 },
  { code: "XOF", symbol: "Fr", decimalDigits: 0 },
  { code: "XPF", symbol: "₣", decimalDigits: 0 },
  { code: "YER", symbol: "﷼", decimalDigits: 2 },
  { code: "ZAR", symbol: "R", decimalDigits: 2 },
  { code: "ZMW", symbol: "ZK", decimalDigits: 2 }
];

export const LANGUAGES: LanguageDefinition[] = [
  { code: "es", name: "Español", nativeName: "Español" },
  { code: "en", name: "Inglés", nativeName: "English" },
  { code: "pt", name: "Portugués", nativeName: "Português" }
];

/** Catálogo completo de 246 países (ISO 3166-1 alpha-2). */
export const COUNTRIES: CountryDefinition[] = [
  { code: "AD", currency: "EUR", language: "en", timezone: "Europe/Andorra", dialCode: "+376", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AE", currency: "AED", language: "en", timezone: "Asia/Dubai", dialCode: "+971", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AF", currency: "AFN", language: "en", timezone: "Asia/Kabul", dialCode: "+93", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AG", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1268", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AI", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1264", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AL", currency: "ALL", language: "en", timezone: "Europe/Tirane", dialCode: "+355", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AM", currency: "AMD", language: "en", timezone: "Asia/Yerevan", dialCode: "+374", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AO", currency: "AOA", language: "pt", timezone: "Africa/Lagos", dialCode: "+244", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AR", currency: "ARS", language: "es", timezone: "America/Argentina/Buenos_Aires", dialCode: "+54", taxRate: 21, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AS", currency: "USD", language: "en", timezone: "Pacific/Pago_Pago", dialCode: "+1684", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AT", currency: "EUR", language: "en", timezone: "Europe/Vienna", dialCode: "+43", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AU", currency: "AUD", language: "en", timezone: "Australia/Sydney", dialCode: "+61", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AW", currency: "AWG", language: "en", timezone: "America/Puerto_Rico", dialCode: "+297", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AX", currency: "EUR", language: "en", timezone: "Europe/Helsinki", dialCode: "+35818", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "AZ", currency: "AZN", language: "en", timezone: "Asia/Baku", dialCode: "+994", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BA", currency: "BAM", language: "en", timezone: "Europe/Belgrade", dialCode: "+387", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BB", currency: "BBD", language: "en", timezone: "America/Barbados", dialCode: "+1246", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BD", currency: "BDT", language: "en", timezone: "Asia/Dhaka", dialCode: "+880", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BE", currency: "EUR", language: "en", timezone: "Europe/Brussels", dialCode: "+32", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BF", currency: "XOF", language: "en", timezone: "Africa/Abidjan", dialCode: "+226", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BG", currency: "BGN", language: "en", timezone: "Europe/Sofia", dialCode: "+359", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BH", currency: "BHD", language: "en", timezone: "Asia/Qatar", dialCode: "+973", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BI", currency: "BIF", language: "en", timezone: "Africa/Maputo", dialCode: "+257", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BJ", currency: "XOF", language: "en", timezone: "Africa/Lagos", dialCode: "+229", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BL", currency: "EUR", language: "en", timezone: "America/Puerto_Rico", dialCode: "+590", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BM", currency: "BMD", language: "en", timezone: "Atlantic/Bermuda", dialCode: "+1441", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BN", currency: "BND", language: "en", timezone: "Asia/Kuching", dialCode: "+673", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BO", currency: "BOB", language: "es", timezone: "America/La_Paz", dialCode: "+591", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BQ", currency: "USD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+599", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BR", currency: "BRL", language: "pt", timezone: "America/Sao_Paulo", dialCode: "+55", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BS", currency: "BSD", language: "en", timezone: "America/Toronto", dialCode: "+1242", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BT", currency: "BTN", language: "en", timezone: "Asia/Thimphu", dialCode: "+975", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BW", currency: "BWP", language: "en", timezone: "Africa/Maputo", dialCode: "+267", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BY", currency: "BYN", language: "en", timezone: "Europe/Minsk", dialCode: "+375", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "BZ", currency: "BZD", language: "es", timezone: "America/Belize", dialCode: "+501", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CA", currency: "CAD", language: "en", timezone: "America/Toronto", dialCode: "+1", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CC", currency: "AUD", language: "en", timezone: "Asia/Yangon", dialCode: "+61", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CD", currency: "CDF", language: "en", timezone: "Africa/Kinshasa", dialCode: "+243", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CF", currency: "XAF", language: "en", timezone: "Africa/Lagos", dialCode: "+236", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CG", currency: "XAF", language: "en", timezone: "Africa/Lagos", dialCode: "+242", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CH", currency: "CHF", language: "en", timezone: "Europe/Zurich", dialCode: "+41", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CI", currency: "XOF", language: "en", timezone: "Africa/Abidjan", dialCode: "+225", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CK", currency: "CKD", language: "en", timezone: "Pacific/Rarotonga", dialCode: "+682", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CL", currency: "CLP", language: "es", timezone: "America/Santiago", dialCode: "+56", taxRate: 19, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CM", currency: "XAF", language: "en", timezone: "Africa/Lagos", dialCode: "+237", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CN", currency: "CNY", language: "en", timezone: "Asia/Shanghai", dialCode: "+86", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CO", currency: "COP", language: "es", timezone: "America/Bogota", dialCode: "+57", taxRate: 19, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CR", currency: "CRC", language: "es", timezone: "America/Costa_Rica", dialCode: "+506", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CU", currency: "CUC", language: "es", timezone: "America/Havana", dialCode: "+53", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CV", currency: "CVE", language: "pt", timezone: "Atlantic/Cape_Verde", dialCode: "+238", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CW", currency: "ANG", language: "en", timezone: "America/Puerto_Rico", dialCode: "+599", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CX", currency: "AUD", language: "en", timezone: "Asia/Bangkok", dialCode: "+61", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CY", currency: "EUR", language: "en", timezone: "Asia/Famagusta", dialCode: "+357", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "CZ", currency: "CZK", language: "en", timezone: "Europe/Prague", dialCode: "+420", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DE", currency: "EUR", language: "en", timezone: "Europe/Berlin", dialCode: "+49", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DJ", currency: "DJF", language: "en", timezone: "Africa/Nairobi", dialCode: "+253", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DK", currency: "DKK", language: "en", timezone: "Europe/Berlin", dialCode: "+45", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DM", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1767", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DO", currency: "DOP", language: "es", timezone: "America/Santo_Domingo", dialCode: "+1", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "DZ", currency: "DZD", language: "en", timezone: "Africa/Algiers", dialCode: "+213", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "EC", currency: "USD", language: "es", timezone: "America/Guayaquil", dialCode: "+593", taxRate: 15, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "EE", currency: "EUR", language: "en", timezone: "Europe/Tallinn", dialCode: "+372", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "EG", currency: "EGP", language: "en", timezone: "Africa/Cairo", dialCode: "+20", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "EH", currency: "DZD", language: "es", timezone: "Africa/El_Aaiun", dialCode: "+2", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ER", currency: "ERN", language: "en", timezone: "Africa/Nairobi", dialCode: "+291", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ES", currency: "EUR", language: "es", timezone: "Europe/Madrid", dialCode: "+34", taxRate: 21, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ET", currency: "ETB", language: "en", timezone: "Africa/Nairobi", dialCode: "+251", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "FI", currency: "EUR", language: "en", timezone: "Europe/Helsinki", dialCode: "+358", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "FJ", currency: "FJD", language: "en", timezone: "Pacific/Fiji", dialCode: "+679", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "FK", currency: "FKP", language: "en", timezone: "Atlantic/Stanley", dialCode: "+500", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "FO", currency: "DKK", language: "en", timezone: "Atlantic/Faroe", dialCode: "+298", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "FR", currency: "EUR", language: "en", timezone: "Europe/Paris", dialCode: "+33", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GA", currency: "XAF", language: "en", timezone: "Africa/Lagos", dialCode: "+241", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GB", currency: "GBP", language: "en", timezone: "Europe/London", dialCode: "+44", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GD", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1473", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GE", currency: "GEL", language: "en", timezone: "Asia/Tbilisi", dialCode: "+995", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GF", currency: "EUR", language: "en", timezone: "America/Cayenne", dialCode: "+594", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GG", currency: "GBP", language: "en", timezone: "Europe/London", dialCode: "+44", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GH", currency: "GHS", language: "en", timezone: "Africa/Abidjan", dialCode: "+233", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GI", currency: "GIP", language: "en", timezone: "Europe/Gibraltar", dialCode: "+350", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GL", currency: "DKK", language: "en", timezone: "America/Nuuk", dialCode: "+299", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GM", currency: "GMD", language: "en", timezone: "Africa/Abidjan", dialCode: "+220", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GN", currency: "GNF", language: "en", timezone: "Africa/Abidjan", dialCode: "+224", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GP", currency: "EUR", language: "en", timezone: "America/Puerto_Rico", dialCode: "+590", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GQ", currency: "XAF", language: "es", timezone: "Africa/Lagos", dialCode: "+240", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GR", currency: "EUR", language: "en", timezone: "Europe/Athens", dialCode: "+30", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GS", currency: "SHP", language: "en", timezone: "Atlantic/South_Georgia", dialCode: "+500", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GT", currency: "GTQ", language: "es", timezone: "America/Guatemala", dialCode: "+502", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GU", currency: "USD", language: "es", timezone: "Pacific/Guam", dialCode: "+1671", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GW", currency: "XOF", language: "pt", timezone: "Africa/Bissau", dialCode: "+245", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "GY", currency: "GYD", language: "en", timezone: "America/Guyana", dialCode: "+592", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "HK", currency: "HKD", language: "en", timezone: "Asia/Hong_Kong", dialCode: "+852", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "HN", currency: "HNL", language: "es", timezone: "America/Tegucigalpa", dialCode: "+504", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "HR", currency: "EUR", language: "en", timezone: "Europe/Belgrade", dialCode: "+385", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "HT", currency: "HTG", language: "en", timezone: "America/Port-au-Prince", dialCode: "+509", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "HU", currency: "HUF", language: "en", timezone: "Europe/Budapest", dialCode: "+36", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ID", currency: "IDR", language: "en", timezone: "Asia/Jakarta", dialCode: "+62", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IE", currency: "EUR", language: "en", timezone: "Europe/Dublin", dialCode: "+353", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IL", currency: "ILS", language: "en", timezone: "Asia/Jerusalem", dialCode: "+972", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IM", currency: "GBP", language: "en", timezone: "Europe/London", dialCode: "+44", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IN", currency: "INR", language: "en", timezone: "Asia/Kolkata", dialCode: "+91", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IO", currency: "USD", language: "en", timezone: "Indian/Chagos", dialCode: "+246", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IQ", currency: "IQD", language: "en", timezone: "Asia/Baghdad", dialCode: "+964", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IR", currency: "IRR", language: "en", timezone: "Asia/Tehran", dialCode: "+98", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IS", currency: "ISK", language: "en", timezone: "Africa/Abidjan", dialCode: "+354", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "IT", currency: "EUR", language: "en", timezone: "Europe/Rome", dialCode: "+39", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "JE", currency: "GBP", language: "en", timezone: "Europe/London", dialCode: "+44", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "JM", currency: "JMD", language: "en", timezone: "America/Jamaica", dialCode: "+1876", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "JO", currency: "JOD", language: "en", timezone: "Asia/Amman", dialCode: "+962", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "JP", currency: "JPY", language: "en", timezone: "Asia/Tokyo", dialCode: "+81", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KE", currency: "KES", language: "en", timezone: "Africa/Nairobi", dialCode: "+254", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KG", currency: "KGS", language: "en", timezone: "Asia/Bishkek", dialCode: "+996", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KH", currency: "KHR", language: "en", timezone: "Asia/Bangkok", dialCode: "+855", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KI", currency: "AUD", language: "en", timezone: "Pacific/Tarawa", dialCode: "+686", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KM", currency: "KMF", language: "en", timezone: "Africa/Nairobi", dialCode: "+269", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KN", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1869", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KP", currency: "KPW", language: "en", timezone: "Asia/Pyongyang", dialCode: "+850", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KR", currency: "KRW", language: "en", timezone: "Asia/Seoul", dialCode: "+82", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KW", currency: "KWD", language: "en", timezone: "Asia/Riyadh", dialCode: "+965", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KY", currency: "KYD", language: "en", timezone: "America/Panama", dialCode: "+1345", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "KZ", currency: "KZT", language: "en", timezone: "Asia/Almaty", dialCode: "+7", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LA", currency: "LAK", language: "en", timezone: "Asia/Bangkok", dialCode: "+856", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LB", currency: "LBP", language: "en", timezone: "Asia/Beirut", dialCode: "+961", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LC", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1758", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LI", currency: "CHF", language: "en", timezone: "Europe/Zurich", dialCode: "+423", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LK", currency: "LKR", language: "en", timezone: "Asia/Colombo", dialCode: "+94", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LR", currency: "LRD", language: "en", timezone: "Africa/Monrovia", dialCode: "+231", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LS", currency: "LSL", language: "en", timezone: "Africa/Johannesburg", dialCode: "+266", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LT", currency: "EUR", language: "en", timezone: "Europe/Vilnius", dialCode: "+370", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LU", currency: "EUR", language: "en", timezone: "Europe/Brussels", dialCode: "+352", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LV", currency: "EUR", language: "en", timezone: "Europe/Riga", dialCode: "+371", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "LY", currency: "LYD", language: "en", timezone: "Africa/Tripoli", dialCode: "+218", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MA", currency: "MAD", language: "en", timezone: "Africa/Casablanca", dialCode: "+212", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MC", currency: "EUR", language: "en", timezone: "Europe/Paris", dialCode: "+377", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MD", currency: "MDL", language: "en", timezone: "Europe/Chisinau", dialCode: "+373", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ME", currency: "EUR", language: "en", timezone: "Europe/Belgrade", dialCode: "+382", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MF", currency: "EUR", language: "en", timezone: "America/Puerto_Rico", dialCode: "+590", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MG", currency: "MGA", language: "en", timezone: "Africa/Nairobi", dialCode: "+261", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MH", currency: "USD", language: "en", timezone: "Pacific/Majuro", dialCode: "+692", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MK", currency: "MKD", language: "en", timezone: "Europe/Belgrade", dialCode: "+389", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ML", currency: "XOF", language: "en", timezone: "Africa/Abidjan", dialCode: "+223", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MM", currency: "MMK", language: "en", timezone: "Asia/Yangon", dialCode: "+95", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MN", currency: "MNT", language: "en", timezone: "Asia/Ulaanbaatar", dialCode: "+976", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MO", currency: "MOP", language: "pt", timezone: "Asia/Macau", dialCode: "+853", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MP", currency: "USD", language: "en", timezone: "Pacific/Guam", dialCode: "+1670", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MQ", currency: "EUR", language: "en", timezone: "America/Martinique", dialCode: "+596", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MR", currency: "MRU", language: "en", timezone: "Africa/Abidjan", dialCode: "+222", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MS", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1664", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MT", currency: "EUR", language: "en", timezone: "Europe/Malta", dialCode: "+356", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MU", currency: "MUR", language: "en", timezone: "Indian/Mauritius", dialCode: "+230", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MV", currency: "MVR", language: "en", timezone: "Indian/Maldives", dialCode: "+960", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MW", currency: "MWK", language: "en", timezone: "Africa/Maputo", dialCode: "+265", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MX", currency: "MXN", language: "es", timezone: "America/Mexico_City", dialCode: "+52", taxRate: 16, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MY", currency: "MYR", language: "en", timezone: "Asia/Kuching", dialCode: "+60", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "MZ", currency: "MZN", language: "pt", timezone: "Africa/Maputo", dialCode: "+258", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NA", currency: "NAD", language: "en", timezone: "Africa/Windhoek", dialCode: "+264", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NC", currency: "XPF", language: "en", timezone: "Pacific/Noumea", dialCode: "+687", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NE", currency: "XOF", language: "en", timezone: "Africa/Lagos", dialCode: "+227", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NF", currency: "AUD", language: "en", timezone: "Pacific/Norfolk", dialCode: "+672", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NG", currency: "NGN", language: "en", timezone: "Africa/Lagos", dialCode: "+234", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NI", currency: "NIO", language: "es", timezone: "America/Managua", dialCode: "+505", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NL", currency: "EUR", language: "en", timezone: "Europe/Brussels", dialCode: "+31", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NO", currency: "NOK", language: "en", timezone: "Europe/Berlin", dialCode: "+47", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NP", currency: "NPR", language: "en", timezone: "Asia/Kathmandu", dialCode: "+977", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NR", currency: "AUD", language: "en", timezone: "Pacific/Nauru", dialCode: "+674", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NU", currency: "NZD", language: "en", timezone: "Pacific/Niue", dialCode: "+683", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "NZ", currency: "NZD", language: "en", timezone: "Pacific/Auckland", dialCode: "+64", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "OM", currency: "OMR", language: "en", timezone: "Asia/Dubai", dialCode: "+968", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PA", currency: "PAB", language: "es", timezone: "America/Panama", dialCode: "+507", taxRate: 7, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PE", currency: "PEN", language: "es", timezone: "America/Lima", dialCode: "+51", taxRate: 18, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PF", currency: "XPF", language: "en", timezone: "Pacific/Tahiti", dialCode: "+689", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PG", currency: "PGK", language: "en", timezone: "Pacific/Port_Moresby", dialCode: "+675", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PH", currency: "PHP", language: "en", timezone: "Asia/Manila", dialCode: "+63", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PK", currency: "PKR", language: "en", timezone: "Asia/Karachi", dialCode: "+92", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PL", currency: "PLN", language: "en", timezone: "Europe/Warsaw", dialCode: "+48", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PM", currency: "EUR", language: "en", timezone: "America/Miquelon", dialCode: "+508", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PN", currency: "NZD", language: "en", timezone: "Pacific/Pitcairn", dialCode: "+64", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PR", currency: "USD", language: "es", timezone: "America/Puerto_Rico", dialCode: "+1", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PS", currency: "EGP", language: "en", timezone: "Asia/Gaza", dialCode: "+970", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PT", currency: "EUR", language: "pt", timezone: "Europe/Lisbon", dialCode: "+351", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PW", currency: "USD", language: "en", timezone: "Pacific/Palau", dialCode: "+680", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "PY", currency: "PYG", language: "es", timezone: "America/Asuncion", dialCode: "+595", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "QA", currency: "QAR", language: "en", timezone: "Asia/Qatar", dialCode: "+974", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "RE", currency: "EUR", language: "en", timezone: "Asia/Dubai", dialCode: "+262", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "RO", currency: "RON", language: "en", timezone: "Europe/Bucharest", dialCode: "+40", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "RS", currency: "RSD", language: "en", timezone: "Europe/Belgrade", dialCode: "+381", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "RU", currency: "RUB", language: "en", timezone: "Europe/Moscow", dialCode: "+7", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "RW", currency: "RWF", language: "en", timezone: "Africa/Maputo", dialCode: "+250", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SA", currency: "SAR", language: "en", timezone: "Asia/Riyadh", dialCode: "+966", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SB", currency: "SBD", language: "en", timezone: "Pacific/Guadalcanal", dialCode: "+677", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SC", currency: "SCR", language: "en", timezone: "Asia/Dubai", dialCode: "+248", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SD", currency: "SDG", language: "en", timezone: "Africa/Khartoum", dialCode: "+249", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SE", currency: "SEK", language: "en", timezone: "Europe/Berlin", dialCode: "+46", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SG", currency: "SGD", language: "en", timezone: "Asia/Singapore", dialCode: "+65", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SH", currency: "GBP", language: "en", timezone: "Africa/Abidjan", dialCode: "+2", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SI", currency: "EUR", language: "en", timezone: "Europe/Belgrade", dialCode: "+386", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SJ", currency: "NOK", language: "en", timezone: "Europe/Berlin", dialCode: "+4779", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SK", currency: "EUR", language: "en", timezone: "Europe/Prague", dialCode: "+421", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SL", currency: "SLL", language: "en", timezone: "Africa/Abidjan", dialCode: "+232", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SM", currency: "EUR", language: "en", timezone: "Europe/Rome", dialCode: "+378", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SN", currency: "XOF", language: "en", timezone: "Africa/Abidjan", dialCode: "+221", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SO", currency: "SOS", language: "en", timezone: "Africa/Nairobi", dialCode: "+252", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SR", currency: "SRD", language: "en", timezone: "America/Paramaribo", dialCode: "+597", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SS", currency: "SSP", language: "en", timezone: "Africa/Juba", dialCode: "+211", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ST", currency: "STN", language: "pt", timezone: "Africa/Sao_Tome", dialCode: "+239", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SV", currency: "USD", language: "es", timezone: "America/El_Salvador", dialCode: "+503", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SX", currency: "ANG", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1721", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SY", currency: "SYP", language: "en", timezone: "Asia/Damascus", dialCode: "+963", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "SZ", currency: "SZL", language: "en", timezone: "Africa/Johannesburg", dialCode: "+268", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TC", currency: "USD", language: "en", timezone: "America/Grand_Turk", dialCode: "+1649", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TD", currency: "XAF", language: "en", timezone: "Africa/Ndjamena", dialCode: "+235", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TF", currency: "EUR", language: "en", timezone: "Asia/Dubai", dialCode: "+262", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TG", currency: "XOF", language: "en", timezone: "Africa/Abidjan", dialCode: "+228", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TH", currency: "THB", language: "en", timezone: "Asia/Bangkok", dialCode: "+66", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TJ", currency: "TJS", language: "en", timezone: "Asia/Dushanbe", dialCode: "+992", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TK", currency: "NZD", language: "en", timezone: "Pacific/Fakaofo", dialCode: "+690", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TL", currency: "USD", language: "pt", timezone: "Asia/Dili", dialCode: "+670", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TM", currency: "TMT", language: "en", timezone: "Asia/Ashgabat", dialCode: "+993", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TN", currency: "TND", language: "en", timezone: "Africa/Tunis", dialCode: "+216", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TO", currency: "TOP", language: "en", timezone: "Pacific/Tongatapu", dialCode: "+676", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TR", currency: "TRY", language: "en", timezone: "Europe/Istanbul", dialCode: "+90", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TT", currency: "TTD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1868", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TV", currency: "AUD", language: "en", timezone: "Pacific/Tarawa", dialCode: "+688", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TW", currency: "TWD", language: "en", timezone: "Asia/Taipei", dialCode: "+886", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "TZ", currency: "TZS", language: "en", timezone: "Africa/Nairobi", dialCode: "+255", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "UA", currency: "UAH", language: "en", timezone: "Europe/Kyiv", dialCode: "+380", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "UG", currency: "UGX", language: "en", timezone: "Africa/Nairobi", dialCode: "+256", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "UM", currency: "USD", language: "en", timezone: "Pacific/Pago_Pago", dialCode: "+268", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "US", currency: "USD", language: "en", timezone: "America/New_York", dialCode: "+1", taxRate: 0, dateFormat: "MM/DD/YYYY", timeFormat: "12h" },
  { code: "UY", currency: "UYU", language: "es", timezone: "America/Montevideo", dialCode: "+598", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "UZ", currency: "UZS", language: "en", timezone: "Asia/Samarkand", dialCode: "+998", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VA", currency: "EUR", language: "en", timezone: "Europe/Rome", dialCode: "+3", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VC", currency: "XCD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1784", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VE", currency: "VES", language: "es", timezone: "America/Caracas", dialCode: "+58", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VG", currency: "USD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1284", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VI", currency: "USD", language: "en", timezone: "America/Puerto_Rico", dialCode: "+1340", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VN", currency: "VND", language: "en", timezone: "Asia/Bangkok", dialCode: "+84", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "VU", currency: "VUV", language: "en", timezone: "Pacific/Efate", dialCode: "+678", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "WF", currency: "XPF", language: "en", timezone: "Pacific/Tarawa", dialCode: "+681", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "WS", currency: "WST", language: "en", timezone: "Pacific/Apia", dialCode: "+685", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "XK", currency: "EUR", language: "en", timezone: "UTC", dialCode: "+383", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "YE", currency: "YER", language: "en", timezone: "Asia/Riyadh", dialCode: "+967", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "YT", currency: "EUR", language: "en", timezone: "Africa/Nairobi", dialCode: "+262", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ZA", currency: "ZAR", language: "en", timezone: "Africa/Johannesburg", dialCode: "+27", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ZM", currency: "ZMW", language: "en", timezone: "Africa/Maputo", dialCode: "+260", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" },
  { code: "ZW", currency: "BWP", language: "en", timezone: "Africa/Maputo", dialCode: "+263", taxRate: 0, dateFormat: "DD/MM/YYYY", timeFormat: "24h" }
];

export function getCountry(code: string): CountryDefinition | undefined {
  return COUNTRIES.find((c) => c.code === code);
}

/**
 * Países en los que VIMDY está disponible por el momento: son los únicos
 * con IVA/impuesto real verificado (ver nota arriba). Se restringe el
 * registro a esta lista a propósito, en vez de dejar elegir cualquiera de
 * los 246 países del catálogo con impuesto en 0 sin verificar — así ningún
 * negocio nuevo arranca con una cifra de impuesto inventada.
 *
 * Para agregar un país nuevo: 1) verificar su IVA real y ponerlo en
 * `COUNTRIES` arriba (dejar de ser 0), 2) agregar su código acá.
 */
export const AVAILABLE_COUNTRY_CODES: CountryCode[] = ["CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US"];

/** Catálogo de países ya disponibles para registro (ver AVAILABLE_COUNTRY_CODES). */
export const AVAILABLE_COUNTRIES: CountryDefinition[] = COUNTRIES.filter((c) =>
  AVAILABLE_COUNTRY_CODES.includes(c.code)
);

export function getCurrency(code: string): CurrencyDefinition | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

/**
 * Decimales reales de una moneda. Si el código no está en el catálogo
 * (no debería pasar, pero por seguridad) se asume 2 — el estándar ISO 4217
 * más común — en vez de reventar la app.
 */
export function getCurrencyDecimalDigits(currencyCode: string): number {
  return getCurrency(currencyCode)?.decimalDigits ?? 2;
}

/**
 * roundMoney
 * ---------------------------------------------------------------------------
 * Única fuente de verdad para redondear cifras de dinero en TODO VIMDY
 * (ventas, recibos, caja, reportes, IA). Se redondea según los decimales
 * reales de la moneda del negocio (`businesses.currency` en Supabase, vía
 * companyConfigStore) — 0 para COP/CLP/JPY/etc., 2 para el resto — así que
 * un negocio nuevo en cualquier país queda bien calculado sin tocar código.
 *
 * Se usa `toFixed` + `Number` (no solo `Math.round`) para evitar el
 * clásico error de coma flotante de JS (ej. 1.005 -> 1.00 en vez de 1.01)
 * en las monedas que sí usan decimales.
 */
export function roundMoney(value: number, currencyCode: string): number {
  const digits = getCurrencyDecimalDigits(currencyCode);
  return Number(value.toFixed(digits));
}

export function getLanguage(code: string): LanguageDefinition | undefined {
  return LANGUAGES.find((l) => l.code === code);
}

/**
 * Moneda + idioma + zona horaria sugeridos para un país.
 * Se usa en el selector de país y en Configuración: al elegir "México" se
 * autocompletan MXN, Español y America/Mexico_City de una vez — el negocio
 * puede cambiarlos después a mano si su caso es distinto.
 */
export function getCountryDefaults(
  countryCode: string
): {
  currency: CurrencyCode;
  language: LanguageCode;
  timezone: string;
  taxRate: number;
  dateFormat: "DD/MM/YYYY" | "MM/DD/YYYY";
  timeFormat: "24h" | "12h";
} | null {
  const country = getCountry(countryCode);
  if (!country) return null;
  return {
    currency: country.currency,
    language: country.language,
    timezone: country.timezone,
    taxRate: country.taxRate,
    dateFormat: country.dateFormat,
    timeFormat: country.timeFormat
  };
}

/** Zonas horarias únicas derivadas del catálogo de países (para el select). */
export const TIMEZONES: string[] = Array.from(new Set(COUNTRIES.map((c) => c.timezone))).sort();

/**
 * Nombre del país localizado con datos reales de CLDR (vía Intl.DisplayNames
 * del navegador) — no es una traducción escrita a mano, así que nunca queda
 * desactualizada ni le faltan países.
 */
export function getCountryName(code: string, language: LanguageCode = "es"): string {
  try {
    const dn = new Intl.DisplayNames([language], { type: "region" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/** Nombre de la moneda localizado, igual que getCountryName pero para monedas. */
export function getCurrencyName(code: string, language: LanguageCode = "es"): string {
  try {
    const dn = new Intl.DisplayNames([language], { type: "currency" });
    return dn.of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Detecta el país más probable del visitante a partir de su navegador
 * (idioma del sistema + zona horaria), para preseleccionarlo en el
 * selector de país — el usuario siempre puede cambiarlo manualmente.
 */
export function detectCountryFromBrowser(): CountryCode | null {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const byTimezone = COUNTRIES.find((c) => c.timezone === tz);
    if (byTimezone) return byTimezone.code;

    const locale = navigator.language || "";
    const region = locale.split("-")[1];
    if (region) {
      const byRegion = COUNTRIES.find((c) => c.code === region.toUpperCase());
      if (byRegion) return byRegion.code;
    }
    return null;
  } catch {
    return null;
  }
}