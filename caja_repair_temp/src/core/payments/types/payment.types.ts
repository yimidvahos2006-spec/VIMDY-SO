/**
 * payment.types.ts
 * ---------------------------------------------------------------------------
 * Tipos base del motor de pagos VIMDY Payments.
 * Única fuente de verdad para nombres de proveedores, países, monedas,
 * métodos de pago y estados normalizados. Todo el resto de payments/ (y
 * SOLO payments/) importa desde acá.
 */

/** Código de país ISO 3166-1 alpha-2 (ej. "CO", "MX", "BR"). */
export type CountryCode = string;

/** Monedas soportadas por VIMDY Payments. */
export type CurrencyCode =
  | "COP"
  | "MXN"
  | "ARS"
  | "CLP"
  | "PEN"
  | "USD"
  | "EUR";

/**
 * Proveedores soportados internamente. Este tipo NUNCA debe filtrarse fuera
 * de payments/ — el resto de VIMDY no debe saber que esto existe.
 */
export type PaymentProviderName = "wompi" | "mercadopago" | "paypal";

/** Tipo de negocio VIMDY (restaurante, hotel, tienda, etc.). Criterio de enrutamiento. */
export type BusinessType = string;

/** Plan contratado por el negocio (free, pro, enterprise, etc.). Criterio de enrutamiento. */
export type PlanCode = string;

/** Métodos de pago que el Router puede exponer según el país. */
export type PaymentMethodCode =
  | "pse"
  | "nequi"
  | "card"
  | "mercadopago_wallet"
  | "bank_transfer"
  | "paypal";

/** Estado normalizado de un pago, igual sin importar el proveedor real. */
export type PaymentStatus =
  | "pending"
  | "approved"
  | "declined"
  | "cancelled"
  | "refunded"
  | "expired"
  | "error";