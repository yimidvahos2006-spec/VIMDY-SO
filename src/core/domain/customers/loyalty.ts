// src/core/domain/customers/loyalty.ts
/* ===========================================================================
   Reglas de fidelización — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   Modelo: los puntos y el nivel de un cliente se DERIVAN de su gasto neto de
   por vida; nunca se suman a mano venta por venta. Así un reembolso o una
   corrección se refleja solos y el número no puede desviarse.

     gasto de por vida  = Σ (total − reembolsos) de ventas PAID / CLOSED
     puntos de por vida = floor(gasto / currencyUnitsPerPoint)
     nivel              = el tier más alto cuyo minPoints ≤ puntos

   Esta es la ESPECIFICACIÓN de referencia: la fuente de verdad en producción
   son las columnas calculadas por Postgres en customers_v2 (migración
   20261113000000). Los tests verifican que ambas reglas coincidan
   (umbrales y fórmula de puntos).

   Los valores por defecto replican el comportamiento actual de la app:
   1 punto por cada $1.000 (loyaltyPointsPerCurrencyUnit = 0.001),
   Plata desde 150 puntos y Oro desde 500.
=========================================================================== */

import type { Sale } from "../../entities/Entities";
import { getSaleNetTotal } from "../../utils/saleRefunds";

export type LoyaltyTier = "bronce" | "plata" | "oro";

export interface LoyaltyTierRule {
  readonly tier: LoyaltyTier;
  readonly minPoints: number;
}

export interface LoyaltyConfig {
  /** Unidades de moneda del negocio que equivalen a 1 punto. */
  readonly currencyUnitsPerPoint: number;
  /** Ascendente por minPoints; el primero debe empezar en 0. */
  readonly tiers: readonly LoyaltyTierRule[];
}

export const DEFAULT_LOYALTY_CONFIG: LoyaltyConfig = {
  currencyUnitsPerPoint: 1000,
  tiers: [
    { tier: "bronce", minPoints: 0 },
    { tier: "plata", minPoints: 150 },
    { tier: "oro", minPoints: 500 }
  ]
};

/** Cliente genérico de mostrador: no acumula fidelización. */
export const GENERIC_CUSTOMER_ID = "CLIENTE_GENERAL";

export interface TierProgress {
  readonly tier: LoyaltyTier;
  readonly nextTier: LoyaltyTier | null;
  readonly pointsToNextTier: number | null;
  /** 0..1 dentro del escalón actual; 1 en el nivel máximo. */
  readonly progress: number;
}

export interface LoyaltyProfile {
  readonly lifetimeSpent: number;
  readonly lifetimePurchaseCount: number;
  readonly firstPurchaseAt: Date | null;
  readonly lastPurchaseAt: Date | null;
  readonly lifetimePoints: number;
  readonly tier: LoyaltyTier;
  readonly progress: TierProgress;
}

export function assertValidLoyaltyConfig(config: LoyaltyConfig): void {
  if (!Number.isFinite(config.currencyUnitsPerPoint) || config.currencyUnitsPerPoint <= 0) {
    throw new Error("INVALID_LOYALTY_CONFIG:currencyUnitsPerPoint");
  }
  if (config.tiers.length === 0 || config.tiers[0].minPoints !== 0) {
    throw new Error("INVALID_LOYALTY_CONFIG:firstTierMustStartAtZero");
  }
  for (let i = 1; i < config.tiers.length; i += 1) {
    if (!(config.tiers[i].minPoints > config.tiers[i - 1].minPoints)) {
      throw new Error("INVALID_LOYALTY_CONFIG:tiersMustBeStrictlyAscending");
    }
  }
}

/** Un cliente real (no mostrador, no vacío) es elegible para acumular. */
export function isLoyaltyEligibleCustomer(customerId: string | null | undefined): boolean {
  const id = (customerId ?? "").trim();
  return id !== "" && id !== GENERIC_CUSTOMER_ID;
}

/**
 * Regla ESTRICTA y única para fidelización: solo ventas PAID o CLOSED.
 * Es a propósito más estricta que isRevenueSaleStatus (que acepta ventas
 * históricas sin status): el servidor nunca cuenta un status vacío.
 */
export function countsTowardLoyalty(sale: Pick<Sale, "status">): boolean {
  const status = (sale.status ?? "").trim().toUpperCase();
  return status === "PAID" || status === "CLOSED";
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** Total neto de reembolsos de UNA venta, en centavos (0 si no cuenta). */
function netCents(sale: Sale): number {
  if (!countsTowardLoyalty(sale)) return 0;
  return toCents(getSaleNetTotal(sale));
}

/** Gasto neto de por vida (2 decimales), sumando solo ventas que cuentan. */
export function calculateLifetimeSpent(sales: readonly Sale[]): number {
  const cents = sales.reduce((sum, sale) => sum + netCents(sale), 0);
  return cents / 100;
}

/** Puntos de por vida: división entera exacta en centavos (sin error de punto flotante). */
export function calculateLifetimePoints(lifetimeSpent: number, config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG): number {
  assertValidLoyaltyConfig(config);
  if (!Number.isFinite(lifetimeSpent) || lifetimeSpent <= 0) return 0;
  return Math.floor(toCents(lifetimeSpent) / toCents(config.currencyUnitsPerPoint));
}

export function resolveTier(points: number, config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG): LoyaltyTier {
  assertValidLoyaltyConfig(config);
  const safe = Number.isFinite(points) && points > 0 ? points : 0;
  let current = config.tiers[0].tier;
  for (const rule of config.tiers) {
    if (safe >= rule.minPoints) current = rule.tier;
  }
  return current;
}

export function getTierProgress(points: number, config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG): TierProgress {
  assertValidLoyaltyConfig(config);
  const safe = Number.isFinite(points) && points > 0 ? points : 0;
  const tier = resolveTier(safe, config);
  const index = config.tiers.findIndex((rule) => rule.tier === tier);
  const next = config.tiers[index + 1];

  if (!next) return { tier, nextTier: null, pointsToNextTier: null, progress: 1 };

  const floor = config.tiers[index].minPoints;
  return {
    tier,
    nextTier: next.tier,
    pointsToNextTier: next.minPoints - safe,
    progress: (safe - floor) / (next.minPoints - floor)
  };
}

/**
 * Perfil completo derivado de las ventas de UN cliente. Una venta cuenta como
 * "compra" solo si su neto de reembolsos es mayor que 0: una venta devuelta
 * por completo mediante reembolsos parciales no es una visita.
 */
export function calculateLoyaltyProfile(
  sales: readonly Sale[],
  config: LoyaltyConfig = DEFAULT_LOYALTY_CONFIG
): LoyaltyProfile {
  assertValidLoyaltyConfig(config);

  let cents = 0;
  let count = 0;
  let first: Date | null = null;
  let last: Date | null = null;

  for (const sale of sales) {
    const net = netCents(sale);
    if (net <= 0) continue;
    cents += net;
    count += 1;
    const at = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt);
    if (Number.isNaN(at.getTime())) continue;
    if (first === null || at < first) first = at;
    if (last === null || at > last) last = at;
  }

  const lifetimeSpent = cents / 100;
  const lifetimePoints = calculateLifetimePoints(lifetimeSpent, config);

  return {
    lifetimeSpent,
    lifetimePurchaseCount: count,
    firstPurchaseAt: first,
    lastPurchaseAt: last,
    lifetimePoints,
    tier: resolveTier(lifetimePoints, config),
    progress: getTierProgress(lifetimePoints, config)
  };
}