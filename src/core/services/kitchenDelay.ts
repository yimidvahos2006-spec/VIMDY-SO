/**
 * kitchenDelay.ts
 * ---------------------------------------------------------------------------
 * Reglas puras de "qué tan demorado va un pedido en Cocina".
 *
 * Antes TODAS las comandas se ponían rojas a los 15 minutos, sin importar
 * qué llevaban (una bebida de 3 min o un plato de 30). Ahora la meta es el
 * tiempo estimado del propio pedido (el del plato más demorado, ver
 * KitchenOrderView.estimatedPrepMinutes). Si el pedido no trae tiempo
 * estimado, se usa la meta por defecto de 15 minutos, igual que antes.
 *
 *   - En tiempo : menos del 70 % de la meta.
 *   - Por vencer: desde el 70 % de la meta.
 *   - Demorado  : desde que se cumple la meta.
 */

export type KitchenDelayLevel = "ON_TIME" | "WARNING" | "DELAYED";

export const DEFAULT_PREP_MINUTES = 15;
export const WARNING_RATIO = 0.7;

export interface KitchenDelayInfo {
  level: KitchenDelayLevel;
  /** Segundos transcurridos desde que entró el pedido (nunca negativo). */
  elapsedSeconds: number;
  /** Meta en minutos que se usó para este pedido. */
  targetMinutes: number;
  /** Segundos que se pasó de la meta (0 si todavía no se pasa). */
  overdueSeconds: number;
}

/** Meta válida del pedido: su tiempo estimado, o 15 min si no tiene uno usable. */
export function resolveTargetMinutes(estimatedMinutes?: number | null): number {
  return typeof estimatedMinutes === "number" &&
    Number.isFinite(estimatedMinutes) &&
    estimatedMinutes > 0
    ? estimatedMinutes
    : DEFAULT_PREP_MINUTES;
}

export function computeKitchenDelay(
  createdAt: Date | string | number,
  estimatedMinutes: number | null | undefined,
  nowMs: number
): KitchenDelayInfo {
  const createdMs = new Date(createdAt).getTime();

  // Si la fecha del pedido es inválida o el reloj del equipo va atrasado
  // respecto al servidor, no se muestran tiempos negativos ni NaN.
  const elapsedSeconds = Number.isFinite(createdMs)
    ? Math.max(0, Math.floor((nowMs - createdMs) / 1000))
    : 0;

  const targetMinutes = resolveTargetMinutes(estimatedMinutes);
  const targetSeconds = targetMinutes * 60;

  let level: KitchenDelayLevel = "ON_TIME";
  if (elapsedSeconds >= targetSeconds) {
    level = "DELAYED";
  } else if (elapsedSeconds >= targetSeconds * WARNING_RATIO) {
    level = "WARNING";
  }

  return {
    level,
    elapsedSeconds,
    targetMinutes,
    overdueSeconds: Math.max(0, elapsedSeconds - targetSeconds)
  };
}

/** Parte los segundos en minutos y segundos para mostrarlos ("12m 05s"). */
export function splitElapsed(elapsedSeconds: number): { minutes: number; seconds: number } {
  const safe = Math.max(0, Math.floor(elapsedSeconds));
  return { minutes: Math.floor(safe / 60), seconds: safe % 60 };
}