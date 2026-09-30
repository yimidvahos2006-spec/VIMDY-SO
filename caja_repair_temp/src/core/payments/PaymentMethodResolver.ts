/**
 * PaymentMethodResolver.ts
 * ---------------------------------------------------------------------------
 * Decide qué métodos de pago mostrarle al usuario según el país. Es una
 * capa de presentación: no ejecuta pagos, solo dice qué opciones ofrecer.
 */

import type { CountryCode, PaymentMethodCode } from "./types/payment.types";

const COUNTRY_METHODS_MAP: Record<string, PaymentMethodCode[]> = {
  CO: ["pse", "nequi", "card"],
  AR: ["paypal", "card"],
  CL: ["paypal", "card"],
  PE: ["paypal", "card"],
  MX: ["paypal", "bank_transfer", "card"],
  US: ["paypal", "card"],
  EC: ["paypal", "card"],
  PA: ["paypal", "card"],
  VE: ["paypal", "card"],
  ES: ["paypal", "card"]
};

/** Métodos usados cuando el país no tiene una regla explícita. */
const DEFAULT_METHODS: PaymentMethodCode[] = ["paypal", "card"];

export class PaymentMethodResolver {
  static resolve(country: CountryCode): PaymentMethodCode[] {
    return COUNTRY_METHODS_MAP[country] ?? DEFAULT_METHODS;
  }
}