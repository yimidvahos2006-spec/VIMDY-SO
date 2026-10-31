import {
  BUSINESS_TIERS,
  SUBSCRIPTION_PLANS_BY_TIER,
  TIER_DEFINITIONS,
  type BillingPeriod,
  type BusinessTier,
  type PlanDefinition
} from "../core/entities/SubscriptionTypes";

/**
 * pricingCopy
 * ---------------------------------------------------------------------------
 * ÚNICA fuente de los precios y textos comerciales del sitio público
 * (Landing, FAQ, Términos, Asistente, CTA). Deriva del mismo catálogo que usa
 * el modal de pago (SubscriptionTypes), así el sitio nunca puede contradecir
 * lo que el usuario ve al pagar. Los precios no se escriben a mano en ningún
 * otro archivo de src/marketing.
 */

/** 59900 -> "$59.900" (separador de miles fijo, sin depender del idioma del navegador). */
export function formatCop(value: number): string {
  return `$${String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ".")}`;
}

function findPlan(tier: BusinessTier, period: BillingPeriod): PlanDefinition {
  const plan = SUBSCRIPTION_PLANS_BY_TIER[tier].find((candidate) => candidate.id === period);
  if (!plan) {
    throw new Error(`pricingCopy: no existe el plan ${tier}/${period}.`);
  }
  return plan;
}

export function priceLabel(tier: BusinessTier, period: BillingPeriod): string {
  return formatCop(findPlan(tier, period).price);
}

export { BUSINESS_TIERS, TIER_DEFINITIONS };
export type { BusinessTier, PlanDefinition };

/** Nombre corto de cada plan para frases corridas. */
export const TIER_PLAN_NAME: Record<BusinessTier, string> = {
  single: "Plan 1 Sede",
  multi: "Plan Multi-Sucursal (2 o más sedes)"
};

/** Beneficios que se listan en las tarjetas del sitio (sin la línea de ahorro, que va en la descripción). */
export function marketingFeatures(tier: BusinessTier): string[] {
  return findPlan(tier, "monthly").features;
}

export const MARKETING_PLAN_TEXT: Record<BillingPeriod, { name: string; description: string }> = {
  monthly: {
    name: "Mensual",
    description: "Flexibilidad para empezar y operar mes a mes."
  },
  yearly: {
    name: "Anual",
    description: "Ahorras 2 meses: pagas 10 y usas 12."
  }
};

function tierSentence(tier: BusinessTier, yearlyNote: string): string {
  return `${TIER_PLAN_NAME[tier]}: ${priceLabel(tier, "monthly")} COP/mes o ${priceLabel(tier, "yearly")} COP/año ${yearlyNote}`;
}

/** Respuesta corta de precios (FAQ y asistente). */
export const PRICING_SUMMARY = `${tierSentence("single", "(2 meses gratis).")} ${tierSentence("multi", "(2 meses gratis).")}`;

/** Respuesta a "¿puedo manejar varias sedes?" (FAQ y asistente). */
export const MULTI_BRANCH_ANSWER = `Sí. El ${TIER_PLAN_NAME.multi} conecta tus sucursales, con reportes consolidados y por sede, y un reporte diario por correo para cada sede. Se administran desde Configuración. Precio: ${priceLabel("multi", "monthly")} COP/mes o ${priceLabel("multi", "yearly")} COP/año. Si tienes una sola sede, el Plan 1 Sede cuesta ${priceLabel("single", "monthly")} COP/mes.`;

/** Cláusula de "Planes y precios" de los Términos. */
export const TERMS_PRICING_BODY =
  `${TIER_PLAN_NAME.single}: ${priceLabel("single", "monthly")} COP por mes o ${priceLabel("single", "yearly")} COP por año. ` +
  `${TIER_PLAN_NAME.multi}: ${priceLabel("multi", "monthly")} COP por mes o ${priceLabel("multi", "yearly")} COP por año. ` +
  "Cada plan anual da 12 meses de acceso por el precio de 10. Los precios están en pesos colombianos. " +
  "Si en algún momento debemos cobrar IVA, te lo informaremos antes de aplicarlo. " +
  "Si cambiamos los precios, te avisaremos con al menos 30 días y el cambio no afectará el período que ya pagaste.";

/** Línea de precio bajo el botón del CTA final. */
export const CTA_PRICE_LINE = `Desde ${priceLabel("single", "monthly")} COP / mes · Multi-Sucursal desde ${priceLabel("multi", "monthly")} COP / mes`;