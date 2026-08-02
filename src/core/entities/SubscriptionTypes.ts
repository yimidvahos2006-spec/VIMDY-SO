/* ===========================================================================
   SubscriptionTypes
   ---------------------------------------------------------------------------
   VIMDY — FASE 7, PASO 1: los cuatro estados de suscripción del negocio.

   `plan` es lo que el negocio CONTRATÓ (se guarda tal cual en Supabase,
   columna `businesses.plan`). "Suspendido" no es un plan que alguien
   contrata — es un estado DERIVADO que se calcula (ver SubscriptionEngine)
   a partir de si el trial ya venció o si un cobro falló. Por eso vive
   aparte, en `SubscriptionStatus`.
=========================================================================== */

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
  status: "approved" | "declined" | "pending" | "error";
  paymentMethod: PaymentMethod;
  wompiReference: string | null;
  mercadopagoReference: string | null;
  paypalOrderId: string | null;
  paidAt: Date;
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
    price: 79000,
    currency: "COP",
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
    price: 790000,
    currency: "COP",
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