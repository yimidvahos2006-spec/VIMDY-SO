import type { IsoDateString } from "../entities/Entities";
import { companyConfigStore } from "../store/companyConfigStore";
import { getBusinessDateKey } from "./businessTime";

const ISO_DATE_ONLY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Mismo tope que valida el servidor (`normalize_expires_at`): hoy + 20 años. */
const MAX_YEARS_AHEAD = 20;

/**
 * Type guard de una fecha calendario `YYYY-MM-DD` REAL (rechaza "2026-02-31").
 * Es el mismo formato que valida el servidor (`normalize_expires_at`).
 */
export function isIsoDateString(value: unknown): value is IsoDateString {
  if (typeof value !== "string") return false;
  const match = ISO_DATE_ONLY_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** Valida un valor de formulario: `IsoDateString` o `undefined` si viene vacío o inválido. */
export function parseIsoDateString(value: string | null | undefined): IsoDateString | undefined {
  const trimmed = value?.trim();
  return trimmed && isIsoDateString(trimmed) ? trimmed : undefined;
}

/**
 * "Hoy" como fecha calendario en la zona horaria del NEGOCIO (nunca
 * `toISOString()`: devuelve UTC y en Colombia corre la fecha un día después de
 * las 7 pm). Ver businessTime.ts, única fuente de verdad del tiempo de negocio.
 */
export function getBusinessTodayIsoDate(now: Date = new Date()): IsoDateString {
  const tz = companyConfigStore.get().timezone || "America/Bogota";
  const key = getBusinessDateKey(now, tz);
  const parsed = parseIsoDateString(key);
  if (parsed) return parsed;
  // Respaldo (zona inválida en la configuración): fecha local del dispositivo.
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}` as IsoDateString;
}

export type ExpiryInputResult =
  | { readonly ok: true; readonly value: IsoDateString | undefined }
  | { readonly ok: false; readonly message: string };

/**
 * Valida el texto de un campo "Fecha de vencimiento" (input type="date").
 *  - Vacío: válido y sin valor, salvo que `required` sea true.
 *  - Con valor: fecha real, no anterior a `today` y no más de 20 años adelante
 *    (el servidor rechaza lo que pase de ahí con INVALID_EXPIRES_AT).
 */
export function checkExpiryInput(
  raw: string,
  options: { readonly required?: boolean; readonly today?: IsoDateString } = {}
): ExpiryInputResult {
  const trimmed = raw.trim();
  if (trimmed === "") {
    return options.required
      ? { ok: false, message: "Indica la fecha de vencimiento." }
      : { ok: true, value: undefined };
  }

  const value = parseIsoDateString(trimmed);
  if (!value) {
    return { ok: false, message: "La fecha de vencimiento no es válida." };
  }

  const today = options.today ?? getBusinessTodayIsoDate();
  if (value < today) {
    return { ok: false, message: "La fecha de vencimiento ya pasó." };
  }

  const maxYear = Number(today.slice(0, 4)) + MAX_YEARS_AHEAD;
  const limit = `${maxYear}${today.slice(4)}`;
  if (value > limit) {
    return {
      ok: false,
      message: `La fecha de vencimiento está muy lejos (máximo ${MAX_YEARS_AHEAD} años).`
    };
  }

  return { ok: true, value };
}