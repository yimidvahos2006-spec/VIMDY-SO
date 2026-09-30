/**
 * Utilidades de tiempo de negocio — ÚNICA fuente de verdad para "qué día,
 * semana, mes, año u hora es" en todo VIMDY. Ningún módulo debe calcular
 * esto por su cuenta (new Date().setHours(0,0,0,0), .getHours(), .getMonth(),
 * .getFullYear() contra el reloj del dispositivo). Todo pasa por aquí,
 * usando siempre companyConfigStore.get().timezone como zona horaria del
 * NEGOCIO — nunca Intl.DateTimeFormat().resolvedOptions().timeZone (esto es
 * la zona del dispositivo, solo sirve para preseleccionar país en un form).
 */

export function getBusinessDateKey(date: Date, tz: string): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = new Map(parts.map(p => [p.type, p.value]));
  return `${map.get("year")}-${map.get("month")}-${map.get("day")}`;
}

export function isBusinessToday(date: Date, now: Date, tz: string): boolean {
  return getBusinessDateKey(date, tz) === getBusinessDateKey(now, tz);
}

export function getYesterdayKey(now: Date, tz: string): string {
  const todayKey = getBusinessDateKey(now, tz);
  const [y, m, d] = todayKey.split("-").map(Number);
  const yesterday = new Date(Date.UTC(y, m - 1, d - 1));
  return `${yesterday.getUTCFullYear()}-${pad2(yesterday.getUTCMonth() + 1)}-${pad2(yesterday.getUTCDate())}`;
}

export function getDayKeyForOffset(now: Date, tz: string, daysAgo: number): string {
  const todayKey = getBusinessDateKey(now, tz);
  const [y, m, d] = todayKey.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d - daysAgo));
  return `${day.getUTCFullYear()}-${pad2(day.getUTCMonth() + 1)}-${pad2(day.getUTCDate())}`;
}

export function startOfBusinessDay(date: Date, tz: string): Date {
  const key = getBusinessDateKey(date, tz);
  const [y, m, d] = key.split("-").map(Number);
  return zonedDateToUTC(y, m, d, 0, 0, 0, tz);
}

export function addBusinessDays(date: Date, tz: string, days: number): Date {
  const key = getBusinessDateKey(date, tz);
  const [y, m, d] = key.split("-").map(Number);
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return zonedDateToUTC(shifted.getUTCFullYear(), shifted.getUTCMonth() + 1, shifted.getUTCDate(), 0, 0, 0, tz);
}

export function startOfNextBusinessDay(date: Date, tz: string): Date {
  return addBusinessDays(date, tz, 1);
}

export function startOfBusinessWeek(date: Date, tz: string): Date {
  const key = getBusinessDateKey(date, tz);
  const [y, m, d] = key.split("-").map(Number);
  const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addBusinessDays(date, tz, -weekday);
}

export function startOfBusinessMonth(date: Date, tz: string): Date {
  const key = getBusinessDateKey(date, tz);
  const [y, m] = key.split("-").map(Number);
  return zonedDateToUTC(y, m, 1, 0, 0, 0, tz);
}

export function startOfBusinessYear(date: Date, tz: string): Date {
  const key = getBusinessDateKey(date, tz);
  const [y] = key.split("-").map(Number);
  return zonedDateToUTC(y, 1, 1, 0, 0, 0, tz);
}

export function getBusinessHour(date: Date, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    hour12: false
  }).formatToParts(date);
  const hourStr = parts.find(p => p.type === "hour")?.value ?? "0";
  const hour = Number(hourStr);
  return hour === 24 ? 0 : hour;
}

export function getBusinessMonthKey(date: Date, tz: string): string {
  return getBusinessDateKey(date, tz).slice(0, 7);
}

export function getBusinessYearKey(date: Date, tz: string): string {
  return getBusinessDateKey(date, tz).slice(0, 4);
}

export function businessDayRangeUTC(now: Date, tz: string): { start: Date; end: Date } {
  return {
    start: startOfBusinessDay(now, tz),
    end: startOfNextBusinessDay(now, tz)
  };
}

function zonedDateToUTC(y: number, m: number, d: number, h: number, min: number, s: number, tz: string): Date {
  const utcGuess = new Date(Date.UTC(y, m - 1, d, h, min, s));
  const tzDate = new Date(utcGuess.toLocaleString("en-US", { timeZone: tz }));
  const utcDate = new Date(utcGuess.toLocaleString("en-US", { timeZone: "UTC" }));
  const offset = utcDate.getTime() - tzDate.getTime();
  return new Date(utcGuess.getTime() + offset);
}

function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}
