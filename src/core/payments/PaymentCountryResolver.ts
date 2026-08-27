/**
 * PaymentCountryResolver.ts
 * ---------------------------------------------------------------------------
 * Única fuente de verdad sobre QUÉ PROVEEDOR usar según el país.
 * Esta es la ÚNICA pieza de todo VIMDY que conoce la relación
 * país → proveedor. Nadie más debería tener un if/else de país y proveedor:
 * ese tipo de lógica queda prohibida fuera de este archivo.
 */

import type { CountryCode, PaymentProviderName } from "./types/payment.types";

/** Mapa país → proveedor. Regla de negocio central de VIMDY Payments. */
const COUNTRY_PROVIDER_MAP: Record<string, PaymentProviderName> = {
  CO: "wompi",
  AR: "paypal",
  CL: "paypal",
  PE: "paypal",
  MX: "paypal",
  US: "paypal",
  EC: "paypal",
  PA: "paypal",
  VE: "paypal",
  ES: "paypal"
};

/** Proveedor usado cuando el país no tiene una regla explícita. */
const DEFAULT_PROVIDER: PaymentProviderName = "paypal";

export class PaymentCountryResolver {
  /** Resuelve qué proveedor debe usarse para un país dado. */
  static resolve(country: CountryCode): PaymentProviderName {
    return COUNTRY_PROVIDER_MAP[country] ?? DEFAULT_PROVIDER;
  }
}