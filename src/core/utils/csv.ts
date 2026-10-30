/**
 * Exportación CSV unificada para Excel (es-CO).
 * ---------------------------------------------------------------------------
 * - UTF-8 con BOM (tildes y "ñ" bien en Excel) y separador ";".
 * - Línea "sep=;" al inicio (Excel ignora la configuración regional del equipo).
 *   Se puede quitar con `{ sepHint: false }` si algún consumidor no la tolera.
 * - Protección anti-inyección de fórmulas ("CSV injection"): todo TEXTO que
 *   Excel pueda interpretar como fórmula se neutraliza (ver `sanitizeCsvText`).
 * - Números con coma decimal, sin separador de miles (Excel los reconoce como
 *   número y se pueden sumar), con los decimales reales de la moneda.
 *
 * REGLA CLAVE: un `string` SIEMPRE es texto y se sanitiza; un `number` es un
 * número y no se toca. Por eso los montos se pasan como número (o con
 * `csvMoney`), nunca como string: un "-5000" en string se trataría como texto.
 *
 * Todo es puro salvo `downloadCsvFile`, que es la única función que toca el DOM.
 */

export const CSV_BOM = "﻿";
export const CSV_SEPARATOR = ";";
const CSV_EOL = "\r\n";
const MAX_FREE_DECIMALS = 6;

/** Número tipado: se escribe sin comillas, con decimales fijos si `decimals` viene. */
export interface CsvNumberCell {
  readonly kind: "number";
  readonly value: number;
  readonly decimals?: number;
}

export type CsvCell = string | number | boolean | null | undefined | CsvNumberCell;
export type CsvRow = readonly CsvCell[];

export interface BuildCsvOptions {
  /** Separador decimal de los números. Por defecto "," (es-CO). */
  readonly decimalSeparator?: "," | ".";
  /** Escribe "sep=;" como primera línea. Por defecto true. */
  readonly sepHint?: boolean;
}

/** Monto con los decimales de la moneda (COP = 0, USD = 2...). */
export function csvMoney(value: number, decimals: number): CsvNumberCell {
  return { kind: "number", value, decimals };
}

/** Número con decimales fijos opcionales (cantidades, porcentajes...). */
export function csvNumber(value: number, decimals?: number): CsvNumberCell {
  return { kind: "number", value, decimals };
}

/* ───────────────────────── Números ───────────────────────── */

/** Redondeo "half away from zero" sin el error clásico de coma flotante (1.005 -> 1.01). */
function roundHalfAwayFromZero(value: number, decimals: number): number {
  const abs = Math.abs(value);
  const text = String(abs);
  // Notación científica (muy grande/pequeño): el truco con exponentes no aplica.
  if (text.includes("e")) return Number(value.toFixed(decimals));
  const shifted = Math.round(Number(`${text}e${decimals}`));
  const rounded = Number(`${shifted}e-${decimals}`);
  return value < 0 ? -rounded : rounded;
}

/**
 * Número -> texto para Excel. NaN/Infinity -> "" (celda vacía, no "NaN").
 * Sin `decimals`: enteros tal cual y hasta 6 decimales sin ceros sobrantes.
 */
export function formatCsvNumber(
  value: number,
  decimals?: number,
  decimalSeparator: "," | "." = ","
): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "";

  let text: string;
  if (decimals === undefined) {
    const rounded = roundHalfAwayFromZero(value, MAX_FREE_DECIMALS);
    text = Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(MAX_FREE_DECIMALS).replace(/0+$/, "");
  } else {
    const digits = Math.min(Math.max(Math.trunc(decimals), 0), 20);
    text = roundHalfAwayFromZero(value, digits).toFixed(digits);
  }

  if (/^-0(?:[.,]?0*)$/.test(text)) text = text.slice(1); // "-0" / "-0.00" -> "0" / "0.00"
  return decimalSeparator === "," ? text.replace(".", ",") : text;
}

/* ───────────────────────── Texto + anti-inyección ───────────────────────── */

/**
 * Caracteres con los que Excel/LibreOffice/Sheets empiezan una fórmula o un
 * comando: = + - @ , TAB y CR (OWASP "CSV Injection"), más sus variantes de
 * ancho completo (＝ ＋ － ＠).
 */
const FORMULA_TRIGGER = /^[=+\-@\t\r＝＋－＠]/;

/** Espacios y caracteres de control que se pueden anteponer para "esconder" el disparador. */
// eslint-disable-next-line no-control-regex
const LEADING_NOISE = /^[\s\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F ​-‍⁠﻿]+/;

/** Caracteres de control (salvo \t y \n) que no tienen lugar en un CSV. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

/**
 * Deja un texto seguro para una celda:
 *  1. quita caracteres de control y normaliza saltos de línea a "\n";
 *  2. si, ignorando espacios/control iniciales, empieza por = + - @ TAB o CR,
 *     antepone una comilla simple (') para que Excel lo trate como texto.
 */
export function sanitizeCsvText(value: string): string {
  const clean = value.replace(/\r\n?/g, "\n").replace(CONTROL_CHARS, "");
  const probe = clean.replace(LEADING_NOISE, "");
  if (FORMULA_TRIGGER.test(clean) || FORMULA_TRIGGER.test(probe)) return `'${clean}`;
  return clean;
}

function quoteCsvText(value: string): string {
  return `"${sanitizeCsvText(value).replace(/"/g, '""')}"`;
}

function isCsvNumberCell(cell: CsvCell): cell is CsvNumberCell {
  return typeof cell === "object" && cell !== null && (cell as CsvNumberCell).kind === "number";
}

/** Una celda ya serializada (con comillas si es texto). */
export function serializeCsvCell(cell: CsvCell, decimalSeparator: "," | "." = ","): string {
  if (cell === null || cell === undefined) return "";
  if (typeof cell === "number") return formatCsvNumber(cell, undefined, decimalSeparator);
  if (typeof cell === "boolean") return quoteCsvText(cell ? "Sí" : "No");
  if (isCsvNumberCell(cell)) return formatCsvNumber(cell.value, cell.decimals, decimalSeparator);
  return quoteCsvText(String(cell));
}

/* ───────────────────────── Documento ───────────────────────── */

/**
 * Construye el CSV (sin BOM: el BOM se agrega al descargar, una sola vez).
 * Una fila vacía `[]` produce una línea en blanco.
 */
export function buildCsv(rows: readonly CsvRow[], options: BuildCsvOptions = {}): string {
  const decimalSeparator = options.decimalSeparator ?? ",";
  const lines = rows.map((row) =>
    row.map((cell) => serializeCsvCell(cell, decimalSeparator)).join(CSV_SEPARATOR)
  );
  if (options.sepHint !== false) lines.unshift(`sep=${CSV_SEPARATOR}`);
  return lines.join(CSV_EOL);
}

/** Antepone el BOM UTF-8 una sola vez (si ya lo trae, no lo duplica). */
export function withCsvBom(csv: string): string {
  return csv.startsWith(CSV_BOM) ? csv : CSV_BOM + csv;
}

export function csvToBlob(csv: string): Blob {
  return new Blob([withCsvBom(csv)], { type: "text/csv;charset=utf-8;" });
}

/** Descarga el CSV en el navegador. Única función de este módulo que usa el DOM. */
export function downloadCsvFile(fileName: string, csv: string): void {
  const url = URL.createObjectURL(csvToBlob(csv));
  const link = document.createElement("a");
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  // Revocar en el mismo tick cancela la descarga en algunos navegadores (Safari).
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}