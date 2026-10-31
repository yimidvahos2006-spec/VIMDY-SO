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
export type SubscriptionStatus = "trial" | "monthly" | "yearly" | "expired" | "suspended";

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

/** Periodo de facturación de un plan. Es lo que se guarda en `businesses.plan`. */
export type BillingPeriod = Extract<SubscriptionPlan, "monthly" | "yearly">;

/**
 * Nivel comercial del negocio:
 * - `single`: negocio de 1 sede.
 * - `multi`: multi-sucursal (2 o más sedes).
 *
 * El nivel cambia el precio, NO la duración: un plan anual multi-sucursal
 * dura lo mismo que uno anual de 1 sede.
 */
export type BusinessTier = "single" | "multi";

export const BUSINESS_TIERS: readonly BusinessTier[] = ["single", "multi"];

export const DEFAULT_BUSINESS_TIER: BusinessTier = "single";

export function isBusinessTier(value: unknown): value is BusinessTier {
  return value === "single" || value === "multi";
}

/** PASO 6 — lo que se muestra en las tarjetas de planes. */
export interface PlanDefinition {
  id: BillingPeriod;
  tier: BusinessTier;
  name: string;
  price: number;
  currency: string;
  billingLabel: string;
  highlight?: string;
  /** Texto corto del ahorro (solo planes anuales). */
  savingsLabel?: string;
  features: string[];
}

/** Textos comerciales de cada nivel (selector del modal de planes). */
export interface TierDefinition {
  id: BusinessTier;
  label: string;
  sublabel: string;
  tagline: string;
}

export const TIER_DEFINITIONS: Record<BusinessTier, TierDefinition> = {
  single: {
    id: "single",
    label: "Negocio de 1 sede",
    sublabel: "Un local, todo bajo control",
    tagline: "Todo el músculo operativo de VIMDY para tu restaurante. Sin candados y con control total directo a tu correo."
  },
  multi: {
    id: "multi",
    label: "Multi-Sucursal",
    sublabel: "2 o más sedes",
    tagline: "Para dueños que mandan en grande. Centraliza, administra y haz crecer múltiples sedes desde un solo panel."
  }
};

/**
 * Dónde se administran las sucursales dentro de VIMDY. Se reutiliza en el
 * modal de planes y en la tarjeta de Suscripción para que siempre digan lo mismo.
 */
export const BRANCH_MANAGEMENT_PATH = "Configuración › Operación › Sucursales";

export const BRANCH_MANAGEMENT_HINT =
  `Crea, edita y activa o desactiva tus sucursales cuando quieras desde ${BRANCH_MANAGEMENT_PATH}.`;

const SINGLE_TIER_FEATURES: readonly string[] = [
  "POS y Mesas Ilimitadas",
  "Control de Insumos en Vivo",
  "Reporte Diario Automático al Correo (al cerrar caja)",
  "Comandas y Cocina Conectadas",
  "Soporte Prioritario por WhatsApp"
];

const MULTI_TIER_FEATURES: readonly string[] = [
  "Múltiples Sucursales Conectadas",
  "Reportes Consolidados y por Sede",
  "Reporte Diario por Correo para Cada Sede",
  "Todo el Poder Pro Sin Límites",
  "Soporte VIP Prioritario"
];

const YEARLY_SAVINGS_FEATURE = "Ahorras 2 meses: pagas 10 y usas 12";
const YEARLY_SAVINGS_LABEL = "Ahorras 2 meses";

export const SUBSCRIPTION_PLANS_BY_TIER: Record<BusinessTier, PlanDefinition[]> = {
  single: [
    {
      id: "monthly",
      tier: "single",
      name: "Plan Mensual",
      price: 59900,
      currency: "COP",
      billingLabel: "Facturación mensual",
      features: [...SINGLE_TIER_FEATURES]
    },
    {
      id: "yearly",
      tier: "single",
      name: "Plan Anual",
      price: 599000,
      currency: "COP",
      billingLabel: "Facturación anual",
      highlight: "Mejor valor",
      savingsLabel: YEARLY_SAVINGS_LABEL,
      features: [...SINGLE_TIER_FEATURES, YEARLY_SAVINGS_FEATURE]
    }
  ],
  multi: [
    {
      id: "monthly",
      tier: "multi",
      name: "Plan Mensual Multi-Sucursal",
      price: 110900,
      currency: "COP",
      billingLabel: "Facturación mensual",
      features: [...MULTI_TIER_FEATURES]
    },
    {
      id: "yearly",
      tier: "multi",
      name: "Plan Anual Multi-Sucursal",
      price: 1109000,
      currency: "COP",
      billingLabel: "Facturación anual",
      highlight: "Mejor valor",
      savingsLabel: YEARLY_SAVINGS_LABEL,
      features: [...MULTI_TIER_FEATURES, YEARLY_SAVINGS_FEATURE]
    }
  ]
};

/** Planes de 1 sede. Se conserva el nombre original para no romper a los consumidores existentes. */
export const SUBSCRIPTION_PLANS: PlanDefinition[] = SUBSCRIPTION_PLANS_BY_TIER.single;

/**
 * Precios por país y nivel. Espejo de PLAN_PRICE_BY_COUNTRY en
 * supabase/functions/wompi-create-checkout/index.ts (el servidor es quien
 * decide el cobro real). Solo Colombia tiene precio multi-sucursal
 * verificado: en los demás países `multi` no existe y NO se inventa.
 */
const COUNTRY_PRICE_MAP: Record<string, Partial<Record<BusinessTier, Record<BillingPeriod, number>>>> = {
  CO: {
    single: { monthly: 59900, yearly: 599000 },
    multi: { monthly: 110900, yearly: 1109000 }
  },
  US: { single: { monthly: 89, yearly: 1068 } },
  MX: { single: { monthly: 1499, yearly: 17988 } },
  PE: { single: { monthly: 149, yearly: 1788 } },
  CL: { single: { monthly: 14990, yearly: 179880 } },
  AR: { single: { monthly: 89999, yearly: 1079988 } },
  EC: { single: { monthly: 59, yearly: 708 } },
  PA: { single: { monthly: 69, yearly: 828 } },
  VE: { single: { monthly: 49, yearly: 588 } },
  ES: { single: { monthly: 69, yearly: 828 } }
};

/** ¿Hay un precio verificado para este nivel en este país? */
export function isTierAvailable(tier: BusinessTier, countryCode: string): boolean {
  return COUNTRY_PRICE_MAP[countryCode]?.[tier] !== undefined;
}

/**
 * Precio canónico del plan. Devuelve 0 cuando no existe un precio verificado
 * (p. ej. `multi` fuera de Colombia): GlobalPaymentRouter rechaza cualquier
 * precio <= 0, así que un nivel sin precio nunca llega a cobrarse.
 */
export function getPlanPrice(
  planId: BillingPeriod,
  countryCode: string,
  tier: BusinessTier = DEFAULT_BUSINESS_TIER
): number {
  const countryPricing = COUNTRY_PRICE_MAP[countryCode];
  if (countryPricing) {
    return countryPricing[tier]?.[planId] ?? 0;
  }
  if (tier !== DEFAULT_BUSINESS_TIER) {
    return 0;
  }
  const plan = SUBSCRIPTION_PLANS.find((p) => p.id === planId);
  return plan ? plan.price : 0;
}

export function getPlanCurrency(planId: BillingPeriod, countryCode: string): CurrencyCode {
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