import {
  BUSINESS_TIERS,
  SUBSCRIPTION_PLANS_BY_TIER,
  TIER_DEFINITIONS,
  getEditionPlanPrice,
  type BillingPeriod,
  type BusinessTier,
  type PlanDefinition,
  type ProductEdition
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

/** Precio público (Colombia, COP) de una edición: "$99.000". Lanza si no existe: nunca se inventa. */
export function editionPriceLabel(
  edition: ProductEdition,
  tier: BusinessTier,
  period: BillingPeriod
): string {
  const price = getEditionPlanPrice(edition, period, "CO", tier);
  if (price <= 0) {
    throw new Error(`pricingCopy: no existe el precio ${edition}/${tier}/${period}.`);
  }
  return formatCop(price);
}

export { BUSINESS_TIERS, TIER_DEFINITIONS };
export type { BusinessTier, PlanDefinition, ProductEdition };

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

function totalTierSentence(tier: BusinessTier): string {
  return `${TIER_PLAN_NAME[tier]}: ${editionPriceLabel("total", tier, "monthly")} COP/mes o ${editionPriceLabel("total", tier, "yearly")} COP/año (2 meses gratis).`;
}

/** Respuesta corta de precios (FAQ y asistente). */
export const PRICING_SUMMARY =
  `${tierSentence("single", "(2 meses gratis).")} ${tierSentence("multi", "(2 meses gratis).")} ` +
  `Con el módulo contable (VIMDY Total): ${totalTierSentence("single")} ${totalTierSentence("multi")}`;

/** Respuesta a "¿puedo manejar varias sedes?" (FAQ y asistente). */
export const MULTI_BRANCH_ANSWER = `Sí. El ${TIER_PLAN_NAME.multi} conecta tus sucursales, con reportes consolidados y por sede, y un reporte diario por correo para cada sede. Se administran desde Configuración. Precio: ${priceLabel("multi", "monthly")} COP/mes o ${priceLabel("multi", "yearly")} COP/año. Si tienes una sola sede, el Plan 1 Sede cuesta ${priceLabel("single", "monthly")} COP/mes.`;

/**
 * Cláusula de "Planes y precios" de los Términos. Lista los precios de las dos
 * ediciones (Plan Operativo y VIMDY Total); ambos salen del catálogo, nunca a mano.
 * Ojo: no usa EDITION_COPY porque se define más abajo en este archivo.
 */
export const TERMS_PRICING_BODY =
  "Plan Operativo. " +
  `${TIER_PLAN_NAME.single}: ${priceLabel("single", "monthly")} COP por mes o ${priceLabel("single", "yearly")} COP por año. ` +
  `${TIER_PLAN_NAME.multi}: ${priceLabel("multi", "monthly")} COP por mes o ${priceLabel("multi", "yearly")} COP por año. ` +
  "VIMDY Total (Plan Operativo más módulo contable). " +
  `${TIER_PLAN_NAME.single}: ${editionPriceLabel("total", "single", "monthly")} COP por mes o ${editionPriceLabel("total", "single", "yearly")} COP por año. ` +
  `${TIER_PLAN_NAME.multi}: ${editionPriceLabel("total", "multi", "monthly")} COP por mes o ${editionPriceLabel("total", "multi", "yearly")} COP por año. ` +
  "Cada plan anual da 12 meses de acceso por el precio de 10. Los precios están en pesos colombianos. " +
  "Si en algún momento debemos cobrar IVA, te lo informaremos antes de aplicarlo. " +
  "Si cambiamos los precios, te avisaremos con al menos 30 días y el cambio no afectará el período que ya pagaste.";

/* ---------------------------------------------------------------------------
   Ediciones del producto: Operativo vs VIMDY Total (con módulo contable).
   Los textos describen QUÉ incluye cada edición. El precio de VIMDY Total sale
   del catálogo (SubscriptionTypes.getEditionPlanPrice) vía editionPriceLabel:
   nunca se escribe a mano en src/marketing.
--------------------------------------------------------------------------- */

export interface EditionCopy {
  id: ProductEdition;
  name: string;
  tagline: string;
  /** Funciones propias de la edición. */
  features: readonly string[];
  /** Solo VIMDY Total: lo que suma sobre el Plan Operativo. */
  inherits?: string;
}

export const EDITION_COPY: Record<ProductEdition, EditionCopy> = {
  operativo: {
    id: "operativo",
    name: "Plan Operativo",
    tagline: "La operación completa del día a día, de la caja a la cocina.",
    features: [
      "POS y caja con turnos y cierre",
      "Inventario de insumos en tiempo real",
      "Cocina (KDS) conectada a cada comanda",
      "Meseros y mesas ilimitadas"
    ]
  },
  total: {
    id: "total",
    name: "VIMDY Total",
    tagline: "Operación y contabilidad en un solo lugar: sabe cuánto ganas de verdad.",
    inherits: "Todo el Plan Operativo, más:",
    features: [
      "Gastos fijos: arriendo, servicios y proveedores",
      "Nómina de empleados registrada como gasto fijo",
      "Utilidad Neta Real calculada automáticamente",
      "Panel para tu contador, solo de consulta"
    ]
  }
};

/** Fórmula que se muestra en la tarjeta de VIMDY Total (coincide con realNetProfit.ts). */
export const NET_PROFIT_FORMULA = ["Ventas", "Costo de insumos", "Gastos fijos"] as const;

/**
 * Cláusula de "Ediciones" de los Términos (sin precios: esos van en TERMS_PRICING_BODY).
 * Describe qué incluye cada edición, que el módulo contable es una herramienta de
 * gestión y cómo funciona el cambio de edición.
 */
export const TERMS_EDITIONS_BODY =
  `VIMDY se ofrece en dos ediciones. El ${EDITION_COPY.operativo.name} cubre la operación del día a día: POS y caja con turnos y cierre, inventario de insumos, cocina conectada a cada comanda, y meseros y mesas ilimitadas. ` +
  `${EDITION_COPY.total.name} incluye todo el ${EDITION_COPY.operativo.name} y suma el módulo contable: gastos fijos, nómina registrada como gasto fijo, Utilidad Neta Real y un panel de solo consulta para tu contador. ` +
  "El módulo contable es una herramienta de gestión: calcula sus cifras con los datos que tú registras (ventas, costos de insumos y gastos fijos). No es contabilidad oficial ni asesoría contable o tributaria, y no reemplaza a tu contador ni tus obligaciones ante la DIAN. " +
  "Si le das acceso a tu contador, tú decides quién entra a tu cuenta y respondes por esa decisión. " +
  `Puedes pasar del ${EDITION_COPY.operativo.name} a ${EDITION_COPY.total.name} en cualquier momento pagando el plan que elijas: la edición nueva empieza el día del pago aprobado y el período pagado se cuenta desde ese día. ` +
  "Si tienes dudas sobre cómo queda tu tiempo pagado, escríbenos a hola@vimdy.co antes de pagar. " +
  `${EDITION_COPY.total.name} y el Plan Multi-Sucursal se pagan con Wompi, en Colombia.`;

/** Línea de precio bajo el botón del CTA final. */
export const CTA_PRICE_LINE = `Desde ${priceLabel("single", "monthly")} COP / mes · Multi-Sucursal desde ${priceLabel("multi", "monthly")} COP / mes`;