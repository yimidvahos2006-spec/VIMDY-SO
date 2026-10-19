import { Sale, Waiter } from "../entities/Entities";
import { getSaleNetTotal, isRevenueSaleStatus } from "../utils/saleRefunds";

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

/**
 * Devuelve el ranking de meseros ordenado de mayor a menor venta.
 * Solo incluye meseros que sí vendieron algo (no lista en $0 a quien no
 * atendió ninguna mesa hoy) y solo cuenta ventas con waiterId.
 */
export function computeWaiterLeaderboard(sales: Sale[], waiters: Waiter[]): WaiterRankingEntry[] {
  const nameById = new Map(waiters.map(w => [w.id, w.name]));
  const totals = new Map<string, { total: number; count: number }>();

  sales.forEach(sale => {
    if (!sale.waiterId || !isRevenueSaleStatus(sale.status)) return;
    const netTotal = getSaleNetTotal(sale);
    if (netTotal <= 0) return;

    const current = totals.get(sale.waiterId) ?? { total: 0, count: 0 };
    current.total += netTotal;
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