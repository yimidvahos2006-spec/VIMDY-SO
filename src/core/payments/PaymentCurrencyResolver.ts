/**
 * PaymentCurrencyResolver.ts
 * ---------------------------------------------------------------------------
 * Resuelve automáticamente la moneda a partir del país. Única fuente de
 * verdad país → moneda dentro del motor de pagos.
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

/** Moneda usada cuando el país no tiene una regla explícita. */
const DEFAULT_CURRENCY: CurrencyCode = "USD";

export class PaymentCurrencyResolver {
  static resolve(country: CountryCode): CurrencyCode {
    return COUNTRY_CURRENCY_MAP[country] ?? DEFAULT_CURRENCY;
  }
}