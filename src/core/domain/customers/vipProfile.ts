// src/core/domain/customers/vipProfile.ts
/* ===========================================================================
   Perfil VIP de un cliente — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   Resume en UNA sola estructura lo que la tarjeta del cliente necesita
   mostrar: cuánto ha gastado, cuántas veces ha venido, qué pide más y cómo
   va hacia el siguiente nivel.

   Todo se DERIVA de las ventas del cliente (nunca se guarda ni se suma a
   mano), con las mismas reglas que ya usa fidelización:

     - Solo cuentan ventas PAID / CLOSED (countsTowardLoyalty).
     - Una venta devuelta por completo no es una visita.
     - El gasto es neto de reembolsos (getSaleNetTotal).
     - Los favoritos usan los ítems netos de reembolsos (getSaleNetItems):
       un plato devuelto deja de contar como "favorito".

   Así la tarjeta, el nivel y la pantalla de Clientes no pueden contradecirse.
=========================================================================== */

import type { Sale } from "../../entities/Entities";
import { getSaleNetItems, getSaleNetTotal } from "../../utils/saleRefunds";
import {
  DEFAULT_LOYALTY_CONFIG,
  calculateLoyaltyProfile,
  countsTowardLoyalty,
  type LoyaltyConfig,
  type TierProgress
} from "./loyalty";

export interface FavoriteProduct {
  readonly productId: string;
  /** Unidades netas de reembolsos que ha comprado en total. */
  readonly units: number;
  /** En cuántas visitas distintas lo pidió. */
  readonly visits: number;
}

export interface CustomerVipProfile {
  /** Gasto neto de por vida. */
  readonly totalSpent: number;
  /** Visitas/compras que cuentan (PAID/CLOSED con neto > 0). */
  readonly visitCount: number;
  /** totalSpent / visitCount (0 si no hay visitas). */
  readonly averageTicket: number;
  readonly firstVisitAt: Date | null;
  readonly lastVisitAt: Date | null;
  readonly points: number;
  readonly tier: TierProgress["tier"];
  readonly tierProgress: TierProgress;
  /** Top N productos por unidades; empata por visitas y luego por id (determinista). */
  readonly favorites: readonly FavoriteProduct[];
}

export interface VipProfileOptions {
  readonly loyalty?: LoyaltyConfig;
  /** Cuántos favoritos devolver. Por defecto 5. */
  readonly topFavorites?: number;
}

export const DEFAULT_TOP_FAVORITES = 5;

/** Una venta es una "visita" si cuenta para fidelización y sigue teniendo neto > 0. */
function isVisit(sale: Sale): boolean {
  return countsTowardLoyalty(sale) && getSaleNetTotal(sale) > 0;
}

export function calculateFavoriteProducts(
  sales: readonly Sale[],
  limit: number = DEFAULT_TOP_FAVORITES
): FavoriteProduct[] {
  const byProduct = new Map<string, { units: number; visits: number }>();

  for (const sale of sales) {
    if (!isVisit(sale)) continue;

    const seenInThisSale = new Set<string>();
    for (const item of getSaleNetItems(sale)) {
      const entry = byProduct.get(item.productId) ?? { units: 0, visits: 0 };
      entry.units += Number(item.quantity) || 0;
      if (!seenInThisSale.has(item.productId)) {
        entry.visits += 1;
        seenInThisSale.add(item.productId);
      }
      byProduct.set(item.productId, entry);
    }
  }

  return [...byProduct.entries()]
    .map(([productId, { units, visits }]) => ({ productId, units, visits }))
    .filter((favorite) => favorite.units > 0)
    .sort(
      (a, b) =>
        b.units - a.units ||
        b.visits - a.visits ||
        a.productId.localeCompare(b.productId)
    )
    .slice(0, Math.max(limit, 0));
}

export function buildCustomerVipProfile(
  sales: readonly Sale[],
  options: VipProfileOptions = {}
): CustomerVipProfile {
  const loyalty = options.loyalty ?? DEFAULT_LOYALTY_CONFIG;
  const base = calculateLoyaltyProfile(sales, loyalty);

  const averageTicket =
    base.lifetimePurchaseCount > 0
      ? Math.round((base.lifetimeSpent / base.lifetimePurchaseCount) * 100) / 100
      : 0;

  return {
    totalSpent: base.lifetimeSpent,
    visitCount: base.lifetimePurchaseCount,
    averageTicket,
    firstVisitAt: base.firstPurchaseAt,
    lastVisitAt: base.lastPurchaseAt,
    points: base.lifetimePoints,
    tier: base.tier,
    tierProgress: base.progress,
    favorites: calculateFavoriteProducts(sales, options.topFavorites ?? DEFAULT_TOP_FAVORITES)
  };
}