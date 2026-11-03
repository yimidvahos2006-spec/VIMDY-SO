/**
 * mixedPayment.ts
 * ---------------------------------------------------------------------------
 * Reglas puras del pago MIXTO (efectivo + transferencia + tarjeta).
 *
 * Es la MISMA regla que ya valida el servidor en
 * SalesEngine.normalizeMixedPayment(), pero calculada en la pantalla para
 * que el cajero vea al instante cuánto falta, cuánto es de vuelto y si el
 * pago se puede cobrar. Así nunca llega al servidor un pago que va a ser
 * rechazado.
 *
 * Reglas:
 *  1. La suma de los tres montos debe cubrir el total.
 *  2. Tarjeta + transferencia NO pueden superar el total (el exceso no se
 *     puede devolver como vuelto).
 *  3. El vuelto solo puede salir del efectivo recibido.
 */

export type MixedKind = "cash" | "card" | "transfer";

export interface MixedAmounts {
  cash: number;
  card: number;
  transfer: number;
}

export interface MixedSummary {
  /** Suma de los tres montos recibidos. */
  received: number;
  /** Lo que todavía falta por cubrir (0 si ya está cubierto). */
  missing: number;
  /** Vuelto a entregar (solo sale del efectivo). */
  change: number;
  /** Tarjeta + transferencia. */
  externalTotal: number;
  /** true si tarjeta + transferencia superan el total. */
  externalExceeds: boolean;
  /** true si la suma cubre el total. */
  covered: boolean;
  /** true si el pago se puede cobrar tal cual. */
  valid: boolean;
}

const EPSILON = 0.005;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/** Convierte lo que escribió el cajero en un monto seguro (>= 0, finito). */
export function sanitizeMixedAmount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) return 0;
  return round(parsed);
}

export function summarizeMixed(total: number, amounts: MixedAmounts): MixedSummary {
  const safeTotal = round(Math.max(Number.isFinite(total) ? total : 0, 0));
  const cash = sanitizeMixedAmount(amounts.cash);
  const card = sanitizeMixedAmount(amounts.card);
  const transfer = sanitizeMixedAmount(amounts.transfer);

  const received = round(cash + card + transfer);
  const externalTotal = round(card + transfer);
  const missing = round(Math.max(safeTotal - received, 0));
  const change = round(Math.max(received - safeTotal, 0));

  const covered = received >= safeTotal - EPSILON;
  const externalExceeds = externalTotal > safeTotal + EPSILON;
  const changeFitsInCash = change <= cash + EPSILON;

  return {
    received,
    missing,
    change,
    externalTotal,
    externalExceeds,
    covered,
    valid: covered && !externalExceeds && changeFitsInCash
  };
}

/**
 * Lo que falta por cubrir si el campo `kind` se llenara con el resto:
 * total menos lo que ya hay en los OTROS dos campos (nunca negativo).
 */
export function remainderFor(
  total: number,
  amounts: MixedAmounts,
  kind: MixedKind
): number {
  const safeTotal = Math.max(Number.isFinite(total) ? total : 0, 0);
  const others = (["cash", "card", "transfer"] as const)
    .filter((k) => k !== kind)
    .reduce((sum, k) => sum + sanitizeMixedAmount(amounts[k]), 0);

  return round(Math.max(safeTotal - others, 0));
}