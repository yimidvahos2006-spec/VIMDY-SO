import { Sale, Waiter } from "../entities/Entities";

/* ===========================================================================
   waiterLeaderboard
   ---------------------------------------------------------------------------
   Cruza ventas reales del día contra los meseros ligeros (Waiter) para
   saber quién vendió más. Función pura, sin dependencias de UI, para que
   sea fácil de probar y de reutilizar (Dashboard hoy, quizás Reportes
   mañana).
=========================================================================== */

export interface WaiterRankingEntry {
  waiterId: string;
  waiterName: string;
  total: number;
  salesCount: number;
}

/** Ventas que no cuentan como venta real para efectos de un ranking. */
const EXCLUDED_STATUSES = new Set(["CANCELLED", "REFUNDED"]);

/**
 * Devuelve el ranking de meseros ordenado de mayor a menor venta.
 * Solo incluye meseros que sí vendieron algo (no lista en $0 a quien no
 * atendió ninguna mesa hoy) y solo cuenta ventas con waiterId.
 */
export function computeWaiterLeaderboard(sales: Sale[], waiters: Waiter[]): WaiterRankingEntry[] {
  const nameById = new Map(waiters.map(w => [w.id, w.name]));
  const totals = new Map<string, { total: number; count: number }>();

  sales.forEach(sale => {
    if (!sale.waiterId) return;
    if (sale.status && EXCLUDED_STATUSES.has(sale.status)) return;

    const current = totals.get(sale.waiterId) ?? { total: 0, count: 0 };
    current.total += sale.total;
    current.count += 1;
    totals.set(sale.waiterId, current);
  });

  return Array.from(totals.entries())
    .map(([waiterId, { total, count }]) => ({
      waiterId,
      waiterName: nameById.get(waiterId) ?? "Mesero",
      total,
      salesCount: count
    }))
    .sort((a, b) => b.total - a.total);
}