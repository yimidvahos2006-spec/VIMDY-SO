/**
 * Convierte lo que escribe una persona en un campo de dinero a número.
 *
 * Problema que resuelve: en Colombia el punto separa los miles ("3.500" =
 * tres mil quinientos), pero JavaScript lee "3.500" como 3,5. Con un
 * <input type="number"> el precio se guardaba en 3.5 pesos sin avisar.
 *
 * Reglas:
 * - "3500", "3.500", "3,500", "$ 3.500" -> 3500
 * - "1.250.000", "1,250,000"            -> 1250000
 * - "3.500,50", "3,500.50"              -> 3500.5 (el último separador es el decimal)
 * - "3.5", "3,5", "12.75"               -> decimal (no son exactamente 3 dígitos)
 * Devuelve NaN si el texto no es un número válido.
 */
export function parseMoneyInput(raw: string | number | null | undefined): number {
  if (typeof raw === "number") return raw;
  if (raw == null) return Number.NaN;

  const text = String(raw).replace(/[\s$]/g, "");
  if (text === "") return Number.NaN;
  if (!/^-?[\d.,]+$/.test(text)) return Number.NaN;

  const lastDot = text.lastIndexOf(".");
  const lastComma = text.lastIndexOf(",");

  // Los dos separadores presentes: el que aparece último es el decimal.
  if (lastDot !== -1 && lastComma !== -1) {
    const decimalSep = lastDot > lastComma ? "." : ",";
    const thousandSep = decimalSep === "." ? "," : ".";
    const normalized = text.split(thousandSep).join("").replace(decimalSep, ".");
    return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
  }

  const sep = lastDot !== -1 ? "." : lastComma !== -1 ? "," : "";
  if (sep === "") return Number(text);

  const parts = text.split(sep);
  const looksLikeThousands =
    parts.length > 2
      ? parts.slice(1).every((part) => part.length === 3)
      : parts[1].length === 3 && parts[0].length >= 1 && parts[0] !== "0" && parts[0] !== "-0";

  if (looksLikeThousands) return Number(parts.join(""));
  if (parts.length > 2) return Number.NaN;

  const normalized = `${parts[0]}.${parts[1]}`;
  return /^-?\d*\.?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}