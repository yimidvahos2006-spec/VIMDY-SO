/**
 * invoiceUtils.ts
 * ---------------------------------------------------------------------------
 * Utilidades pequeñas y sin dependencias externas, compartidas por todo el
 * motor de facturación. Mismo patrón que payments/utils/paymentUtils.ts.
 */

/** Timestamp ISO reutilizable en todos los modelos de invoicing. */
export function nowIso(): string {
  return new Date().toISOString();
}