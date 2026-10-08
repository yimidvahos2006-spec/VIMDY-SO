/**
 * PaymentCountryResolver.ts
 * ---------------------------------------------------------------------------
 * Única fuente de verdad sobre país -> proveedor de VIMDY Payments.
 *
 * Ningún otro archivo del motor debe duplicar esta relación.
 */

import type { CountryCode, PaymentProviderName } from "./types/payment.types";

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

const DEFAULT_PROVIDER: PaymentProviderName = "paypal";

export class PaymentCountryResolver {
  static resolve(country: CountryCode): PaymentProviderName {
    const normalizedCountry = String(country ?? "").trim().toUpperCase();
    return COUNTRY_PROVIDER_MAP[normalizedCountry] ?? DEFAULT_PROVIDER;
  }
}
