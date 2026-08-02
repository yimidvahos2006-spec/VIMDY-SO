/**
 * paymentUtils.ts
 * ---------------------------------------------------------------------------
 * Utilidades pequeñas y sin dependencias externas, compartidas por todo el
 * motor de pagos.
 */

/** Genera un id único para pagos, sesiones y reembolsos (sin librerías externas). */
export function generatePaymentId(prefix: string = "pay"): string {
  const random = Math.random().toString(36).slice(2, 10);
  const timestamp = Date.now().toString(36);
  return `${prefix}_${timestamp}${random}`;
}

/** Timestamp ISO reutilizable en todos los modelos. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Redondea un monto a 2 decimales, evitando errores de coma flotante. */
export function roundAmount(amount: number): number {
  return Math.round((amount + Number.EPSILON) * 100) / 100;
}