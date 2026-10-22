import type { InventoryMovement } from "../entities/Entities";
import { getBusinessDateKey } from "./businessTime";

/**
 * Presentación del historial de movimientos de inventario ("Últimos
 * movimientos"). Todo se calcula AL MOSTRAR, a partir de los datos reales del
 * movimiento (tipo, cantidad, fecha, motivo, nombre guardado): nunca se guarda
 * un texto como "hoy" o "ayer" en la base de datos, porque ese texto quedaría
 * desactualizado al día siguiente.
 *
 * Los días se cuentan en la zona horaria del NEGOCIO (businessTime.ts), no en
 * la del dispositivo.
 */

/** Cuántos días hacia atrás muestra el panel. El Kardex NO se borra: solo se oculta lo más viejo. */
export const MOVEMENT_VISIBLE_DAYS = 30;

function dayNumber(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86_400_000;
}

/** Días calendario del negocio entre `date` y `now` (0 = hoy, 1 = ayer). */
export function businessDaysAgo(date: Date, now: Date, tz: string): number {
  return dayNumber(getBusinessDateKey(now, tz)) - dayNumber(getBusinessDateKey(date, tz));
}

/** "hoy a las 3:45 p. m." · "ayer" · "hace 3 días" · "el 12 oct". */
export function getRelativeMovementTime(date: Date, now: Date, tz: string, locale = "es"): string {
  const diff = businessDaysAgo(date, now, tz);

  if (diff <= 0) {
    const time = new Intl.DateTimeFormat(locale, {
      timeZone: tz,
      hour: "numeric",
      minute: "2-digit",
      hour12: true
    }).format(date);
    return `hoy a las ${time}`;
  }
  if (diff === 1) return "ayer";
  if (diff < 7) return `hace ${diff} días`;

  const shortDate = new Intl.DateTimeFormat(locale, {
    timeZone: tz,
    day: "numeric",
    month: "short"
  }).format(date);
  return `el ${shortDate}`;
}

/** Solo los movimientos de los últimos `days` días del negocio (no borra nada). */
export function filterVisibleMovements(
  movements: ReadonlyArray<InventoryMovement>,
  now: Date,
  tz: string,
  days: number = MOVEMENT_VISIBLE_DAYS
): InventoryMovement[] {
  return movements.filter((m) => businessDaysAgo(m.date, now, tz) <= days);
}

export interface MovementDescription {
  /** Frase natural: "Agregaste Queso", "Vendiste Gaseosa Hit Manzana 400ml". */
  readonly title: string;
  /** Signo que acompaña la cantidad ("" para ajustes sin dirección). */
  readonly sign: "+" | "-" | "";
  readonly tone: "up" | "down" | "neutral";
}

function isSaleReason(reason: string): boolean {
  const r = reason.trim().toLowerCase();
  return r === "sale" || r.startsWith("venta");
}

export function describeMovement(
  movement: Pick<InventoryMovement, "type" | "reason">,
  productName: string
): MovementDescription {
  if (movement.type === "INCREASE") {
    return { title: `Agregaste ${productName}`, sign: "+", tone: "up" };
  }
  if (movement.type === "DECREASE") {
    const verb = isSaleReason(movement.reason ?? "") ? "Vendiste" : "Sacaste";
    return { title: `${verb} ${productName}`, sign: "-", tone: "down" };
  }
  return { title: `Ajustaste ${productName}`, sign: "", tone: "neutral" };
}