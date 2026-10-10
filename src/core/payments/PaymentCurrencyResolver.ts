/**
 * PaymentCurrencyResolver.ts
 * ---------------------------------------------------------------------------
 * Única fuente de verdad país -> moneda dentro de VIMDY Payments.
 *
 * Este resolver solo determina la moneda de cobro del motor de pagos.
 * Los impuestos no se calculan aquí: para suscripciones el importe canónico
 * ya proviene de SubscriptionTypes.getPlanPrice(); para ventas POS los
 * impuestos pertenecen al SalesEngine / configuración fiscal de VIMDY.
 */

import type { CountryCode, CurrencyCode } from "./types/payment.types";

const COUNTRY_CURRENCY_MAP: Record<string, CurrencyCode> = {
  CO: "COP",
  MX: "MXN",
  AR: "ARS",
  CL: "CLP",
  PE: "PEN",
  EC: "USD",
  US: "USD",
  PA: "USD",
  VE: "USD",
  ES: "EUR"
};

const DEFAULT_CURRENCY: CurrencyCode = "USD";

export class PaymentCurrencyResolver {
  static resolve(country: CountryCode): CurrencyCode {
    const normalizedCountry = String(country ?? "").trim().toUpperCase();
    return COUNTRY_CURRENCY_MAP[normalizedCountry] ?? DEFAULT_CURRENCY;
  }
}
