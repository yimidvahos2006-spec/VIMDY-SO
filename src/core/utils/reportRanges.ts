/**
 * Rangos de fechas de Reportes (Hoy, Últimos 7 días, Últimos 30 días, Este mes, Todo).
 * ---------------------------------------------------------------------------
 * Módulo PURO: no lee stores, no toca el DOM ni el reloj por su cuenta. Recibe
 * `now` y la zona horaria del negocio, y devuelve una ventana [inicio, fin).
 *
 * Reglas (las mismas de businessTime.ts, que sigue siendo la única fuente de
 * verdad del tiempo de negocio; aquí solo se compone):
 *  - Los días se cuentan como DÍAS CALENDARIO del negocio, nunca restando
 *    `n * 86_400_000` ms (eso falla en zonas con horario de verano) ni usando
 *    `toISOString()` (devuelve UTC y en Colombia corre el día después de las 7 pm).
 *  - La ventana es semiabierta: `inicio` incluido, `finExclusivo` excluido
 *    (= 00:00 del día siguiente en la zona del negocio).
 *  - "Todo" no tiene límites (start = null y endExclusive = null).
 *  - Zona inválida o vacía => America/Bogota (mismo respaldo que isoDate.ts).
 */

import {
  addBusinessDays,
  getBusinessDateKey,
  startOfBusinessMonth,
  startOfNextBusinessDay
} from "./businessTime";

export type ReportRange = "hoy" | "7d" | "30d" | "mes" | "todo";

export const REPORT_RANGES: readonly ReportRange[] = ["hoy", "7d", "30d", "mes", "todo"];

export const DEFAULT_REPORT_RANGE: ReportRange = "7d";

export const DEFAULT_REPORT_TIMEZONE = "America/Bogota";

export const REPORT_RANGE_LABEL: Record<ReportRange, string> = {
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
  todo: "Todo"
};

/** Ventana de tiempo semiabierta: start <= t < endExclusive. `null` = sin límite. */
export interface ReportWindow {
  readonly start: Date | null;
  readonly endExclusive: Date | null;
}

export interface ResolvedReportRange extends ReportWindow {
  readonly range: ReportRange;
  readonly label: string;
  /** Zona horaria realmente usada (ya validada). */
  readonly tz: string;
  /** Primer día incluido, `YYYY-MM-DD` en la zona del negocio. null en "todo". */
  readonly startKey: string | null;
  /** Último día incluido, `YYYY-MM-DD` en la zona del negocio. null en "todo". */
  readonly endKey: string | null;
  /** Cantidad de días calendario de la ventana. null en "todo". */
  readonly dayCount: number | null;
}

export function isReportRange(value: unknown): value is ReportRange {
  return typeof value === "string" && (REPORT_RANGES as readonly string[]).includes(value);
}

/** Devuelve `tz` si es una zona IANA válida; si no, America/Bogota. */
export function normalizeReportTimezone(tz: string | null | undefined): string {
  const candidate = (tz ?? "").trim();
  if (!candidate) return DEFAULT_REPORT_TIMEZONE;
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_REPORT_TIMEZONE;
  }
}

function daysInRange(range: Exclude<ReportRange, "mes" | "todo">): number {
  if (range === "hoy") return 1;
  if (range === "7d") return 7;
  return 30;
}

/**
 * Resuelve un rango a su ventana exacta.
 *
 * @param range Rango elegido en pantalla.
 * @param now   Instante de referencia (por defecto, ahora). Se inyecta para pruebas.
 * @param tz    Zona horaria del negocio (companyConfigStore.get().timezone).
 */
export function resolveReportRange(
  range: ReportRange,
  now: Date = new Date(),
  tz?: string | null
): ResolvedReportRange {
  if (!(now instanceof Date) || !Number.isFinite(now.getTime())) {
    throw new RangeError("resolveReportRange: `now` no es una fecha válida.");
  }
  const zone = normalizeReportTimezone(tz);
  const label = REPORT_RANGE_LABEL[range];

  if (range === "todo") {
    return { range, label, tz: zone, start: null, endExclusive: null, startKey: null, endKey: null, dayCount: null };
  }

  const todayKey = getBusinessDateKey(now, zone);
  const endExclusive = startOfNextBusinessDay(now, zone);

  if (range === "mes") {
    return {
      range,
      label,
      tz: zone,
      start: startOfBusinessMonth(now, zone),
      endExclusive,
      startKey: `${todayKey.slice(0, 7)}-01`,
      endKey: todayKey,
      dayCount: Number(todayKey.slice(8, 10))
    };
  }

  const dayCount = daysInRange(range);
  const start = addBusinessDays(now, zone, -(dayCount - 1));
  return {
    range,
    label,
    tz: zone,
    start,
    endExclusive,
    startKey: getBusinessDateKey(start, zone),
    endKey: todayKey,
    dayCount
  };
}

/**
 * Periodo inmediatamente anterior, con la misma cantidad de días calendario
 * (para "vs. periodo anterior"). null si el rango no tiene límites ("todo").
 *
 *   hoy -> ayer completo · 7d -> los 7 días previos · 30d -> los 30 previos
 *   mes -> los N días previos al día 1, donde N = días transcurridos del mes.
 */
export function getPreviousReportRange(current: ResolvedReportRange): ResolvedReportRange | null {
  if (!current.start || current.dayCount === null) return null;
  const { tz, dayCount } = current;
  const start = addBusinessDays(current.start, tz, -dayCount);
  const lastDay = addBusinessDays(current.start, tz, -1);
  return {
    range: current.range,
    label: current.label,
    tz,
    start,
    endExclusive: current.start,
    startKey: getBusinessDateKey(start, tz),
    endKey: getBusinessDateKey(lastDay, tz),
    dayCount
  };
}

/** ¿El instante cae dentro de la ventana? Fechas inválidas nunca entran. */
export function isInReportWindow(date: Date, window: ReportWindow): boolean {
  const t = date instanceof Date ? date.getTime() : Number.NaN;
  if (!Number.isFinite(t)) return false;
  if (window.start && t < window.start.getTime()) return false;
  if (window.endExclusive && t >= window.endExclusive.getTime()) return false;
  return true;
}

export function filterByReportRange<T>(
  items: readonly T[],
  getDate: (item: T) => Date,
  window: ReportWindow
): T[] {
  return items.filter((item) => isInReportWindow(getDate(item), window));
}