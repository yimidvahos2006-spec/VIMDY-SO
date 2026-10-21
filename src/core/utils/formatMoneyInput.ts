/**
 * Da formato colombiano a un campo de dinero mientras la persona escribe.
 *
 * "3000" -> "3.000"   "1250000" -> "1.250.000"   "3500,5" -> "3.500,5"
 *
 * Reglas:
 * - El punto es SIEMPRE separador de miles y lo pone esta función; si la
 *   persona escribe un punto, se ignora y se vuelve a calcular.
 * - La coma es el único separador decimal (máximo 2 decimales).
 * - Solo se dejan dígitos y una coma. Letras, signos y "$" se descartan.
 * - Lo que devuelve siempre lo entiende parseMoneyInput sin ambigüedad.
 */
const MAX_INTEGER_DIGITS = 12;

export function formatMoneyInput(raw: string | null | undefined): string {
  if (raw == null) return "";

  const cleaned = String(raw).replace(/[^\d,]/g, "");
  if (cleaned === "") return "";

  const firstComma = cleaned.indexOf(",");
  const hasComma = firstComma !== -1;

  let integerPart = (hasComma ? cleaned.slice(0, firstComma) : cleaned).slice(0, MAX_INTEGER_DIGITS);
  const decimalPart = hasComma
    ? cleaned.slice(firstComma + 1).replace(/,/g, "").slice(0, 2)
    : "";

  integerPart = integerPart.replace(/^0+(?=\d)/, "");
  if (integerPart === "") integerPart = "0";

  const grouped = integerPart.replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return hasComma ? `${grouped},${decimalPart}` : grouped;
}

/** Convierte un número guardado (3000 o 3.5) al texto que se muestra en el campo ("3.000" o "3,5"). */
export function toMoneyInputValue(value: number | string | null | undefined): string {
  if (value == null || value === "") return "";
  return formatMoneyInput(String(value).replace(".", ","));
}