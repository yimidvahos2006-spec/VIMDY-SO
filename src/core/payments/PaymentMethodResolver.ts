/**
 * PaymentMethodResolver.ts
 * ---------------------------------------------------------------------------
 * Resuelve los métodos que VIMDY Payments puede presentar para el checkout
 * de suscripciones según el país.
 *
 * Este resolver NO ejecuta pagos y NO representa los métodos POS internos
 * CASH/CARD/TRANSFER/QR/MIXED. Esos forman parte del flujo operativo del POS
 * y se gobiernan por CashEngine / PaymentState / register_sale_payment_atomic.
 */

import type { CountryCode, PaymentMethodCode } from "./types/payment.types";

const COUNTRY_METHODS_MAP: Record<string, readonly PaymentMethodCode[]> = {
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

const DEFAULT_METHODS: readonly PaymentMethodCode[] = ["paypal", "card"];

export class PaymentMethodResolver {
  static resolve(country: CountryCode): PaymentMethodCode[] {
    const normalizedCountry = PaymentMethodResolver.normalizeCountry(country);
    const methods = COUNTRY_METHODS_MAP[normalizedCountry] ?? DEFAULT_METHODS;

    return [...methods];
  }

  private static normalizeCountry(country: CountryCode): string {
    return String(country ?? "").trim().toUpperCase();
  }
}
