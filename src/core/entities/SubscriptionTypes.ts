import type { CurrencyCode } from "../payments/types/payment.types";

/** Lo que el negocio contrató. Se guarda en `businesses.plan`. */
export type SubscriptionPlan = "trial" | "monthly" | "yearly";

/** Métodos de cobro reales que puede quedar guardados en `businesses.payment_method`. */
export type PaymentMethod =
  | "wompi_card"
  | "wompi_pse"
  | "wompi_nequi"
  | "mercadopago_wallet"
  | "mercadopago_card"
  | "mercadopago_bank_transfer"
  | "paypal"
  | null;

/** Estado del último cobro. 'none' = todavía no ha habido ningún cobro (trial). */
export type PaymentStatus = "none" | "pending" | "approved" | "declined" | "past_due";

/**
 * Estado EFECTIVO que ve el usuario — los 4 círculos de PASO 1.
 * Se calcula, nunca se guarda directamente.
 */
export type SubscriptionStatus = "trial" | "monthly" | "yearly" | "suspended";

/** Fila `businesses` tal como la necesita el módulo de suscripciones. */
export interface Subscription {
  businessId: string;
  plan: SubscriptionPlan;
  trialEndsAt: Date | null;
  renewalDate: Date | null;
  nextChargeAt: Date | null;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
}

/** Una fila de `subscription_payments` — PASO 8, historial de pagos. */
export interface SubscriptionPayment {
  id: string;
  plan: SubscriptionPlan;
  amount: number;
  currency: string;
  status: "approved" | "declined" | "pending" | "error" | "refunded";
  paymentMethod: PaymentMethod;
  wompiReference: string | null;
  mercadopagoReference: string | null;
  paypalOrderId: string | null;
  paidAt: Date;
  renewalNumber: number;
  providerRefundId: string | null;
  refundedAt: Date | null;
}

/** Entrada de auditoría de suscripciones. */
export interface SubscriptionAuditEntry {
  id: string;
  businessId: string;
  action: string;
  actorType: string;
  actorId: string | null;
  details: Record<string, unknown>;
  createdAt: Date;
}

/** Detalles de una operación de suscripción para auditoría. */
export interface SubscriptionAuditDetails {
  plan?: SubscriptionPlan;
  paymentId?: string;
  renewalNumber?: number;
  renewalDate?: string;
  refundAmount?: number;
  originalAmount?: number;
  currency?: string;
  providerRefundId?: string;
  isTotalRefund?: boolean;
  newPaymentStatus?: string;
  expiredAt?: string;
  cancelledAt?: string;
}

/** PASO 6 — lo que se muestra en las tarjetas de planes. */
export interface PlanDefinition {
  id: Extract<SubscriptionPlan, "monthly" | "yearly">;
  name: string;
  price: number;
  currency: string;
  billingLabel: string;
  highlight?: string;
  features: string[];
}

export const SUBSCRIPTION_PLANS: PlanDefinition[] = [
  {
    id: "monthly",
    name: "Plan Mensual",
    price: 89,
    currency: "USD",
    billingLabel: "Facturación mensual",
    features: [
      "Todas las funciones de VIMDY incluidas",
      "Soporte prioritario por WhatsApp",
      "Actualizaciones automáticas",
      "Acceso completo a POS, inventario, reportes y más"
    ]
  },
  {
    id: "yearly",
    name: "Plan Anual",
    price: 899,
    currency: "USD",
    billingLabel: "Facturación anual",
    highlight: "Ahorra dos meses",
    features: [
      "Todas las funciones de VIMDY incluidas",
      "Soporte prioritario por WhatsApp",
      "Actualizaciones automáticas",
      "Acceso completo a POS, inventario, reportes y más",
      "Dos meses gratis frente al plan mensual"
    ]
  }
];

const COUNTRY_PRICE_MAP: Record<string, Record<"monthly" | "yearly", number>> = {
  CO: { monthly: 79000, yearly: 790000 },
  US: { monthly: 89, yearly: 899 },
  MX: { monthly: 1499, yearly: 14990 },
  PE: { monthly: 149, yearly: 1490 },
  CL: { monthly: 14990, yearly: 149900 },
  AR: { monthly: 89999, yearly: 899999 },
  EC: { monthly: 59, yearly: 599 },
  PA: { monthly: 69, yearly: 699 },
  VE: { monthly: 49, yearly: 499 },
  ES: { monthly: 69, yearly: 699 }
};

export function getPlanPrice(planId: "monthly" | "yearly", countryCode: string): number {
  const countryPricing = COUNTRY_PRICE_MAP[countryCode];
  if (countryPricing) {
    return countryPricing[planId];
  }
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
  return plan ? plan.price : 0;
}

export function getPlanCurrency(planId: "monthly" | "yearly", countryCode: string): CurrencyCode {
  const currencyMap: Record<string, CurrencyCode> = {
    CO: "COP",
    US: "USD",
    MX: "MXN",
    PE: "PEN",
    CL: "CLP",
    AR: "ARS",
    EC: "USD",
    PA: "USD",
    VE: "USD",
    ES: "EUR"
  };
  return currencyMap[countryCode] ?? "USD";
}