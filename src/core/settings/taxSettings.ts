import { localeForLanguage } from "./regionalSettings";
import type { LanguageCode } from "../config/globalization";

/**
 * taxSettings
 * ---------------------------------------------------------------------------
 * Lectura y formato PUROS de los dos campos de la tarjeta "Impuestos y
 * moneda": IVA (%) y Meta de ventas diaria.
 *
 * Los campos guardan el texto que escribe la persona (no un número), porque
 * con un <input type="number"> no se podía borrar el "0" ni escribir "8,5":
 * el navegador devolvía vacío y el valor saltaba a 0. Aquí se interpreta ese
 * texto y se devuelve null si no es válido, para poder avisarle y bloquear
 * el guardado en vez de guardar una cifra equivocada.
 */

export const MAX_TAX_PERCENT = 100;
export const MAX_DAILY_GOAL = 100_000_000_000;

export const TAX_ERROR_MESSAGE =
  "Escribe un IVA entre 0 y 100, con hasta 2 decimales (por ejemplo 19 u 8,5).";
export const DAILY_GOAL_ERROR_MESSAGE =
  "Escribe la meta como un número entero, sin decimales (por ejemplo 500.000).";

/** "19" → 19 · "8,5" → 8.5 · "" o "abc" o "101" → null. Acepta coma o punto decimal. */
export function parseTaxPercentInput(raw: string): number | null {
  const normalized = raw.trim().replace(",", ".");
  if (!/^\d{1,3}(\.\d{0,2})?$/.test(normalized)) return null;
  const value = Number(normalized);
  if (!Number.isFinite(value) || value < 0 || value > MAX_TAX_PERCENT) return null;
  return value;
}

export function formatTaxPercent(value: number): string {
  return Number.isFinite(value) ? String(value) : "0";
}

/**
 * Meta diaria como número entero. Los puntos, comas y espacios son separadores
 * de miles ("500.000" → 500000). Vacío significa "sin meta" (0). Un separador
 * seguido de 1 o 2 dígitos al final ("1500.50") parece un decimal y se rechaza
 * en lugar de convertirlo en una cifra 100 veces mayor.
 */
export function parseDailyGoalInput(raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed === "") return 0;
  if (/[^\d.,\s]/.test(trimmed)) return null;
  if (/[.,]\d{1,2}$/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (digits === "" || digits.length > 12) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value > MAX_DAILY_GOAL) return null;
  return value;
}

/** 500000 → "500.000" (es). Una meta de 0 se muestra vacía, con el texto "0 = sin meta". */
export function formatDailyGoal(value: number, language: LanguageCode = "es"): string {
  if (!Number.isFinite(value) || value <= 0) return "";
  return new Intl.NumberFormat(localeForLanguage(language), { maximumFractionDigits: 0 }).format(value);
}