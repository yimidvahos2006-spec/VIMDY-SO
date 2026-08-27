import { useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * Ranking de productos más vendidos en los últimos 30 días.
 * ---------------------------------------------------------------------------
 * Se usa en el POS para mostrar primero lo que el negocio realmente más
 * vende, así el cajero no necesita buscar ni cambiar de categoría para
 * las ventas del día a día (objetivo: menos toques, venta más rápida).
 *
 * No inventa lógica nueva: reusa SalesEngine.getSalesByDate +
 * calculateStatistics().bestSellingProducts, la misma fuente que ya
 * alimenta Reportes (useReports.ts) y el Copiloto (BusinessAnalyzer).
 *
 * Devuelve un Map<productId, posición> (0 = el más vendido). Los
 * productos que no aparecen en el Map simplemente no tienen ventas
 * recientes — no significa que estén mal, solo que van después.
 *
 * `refreshKey` fuerza un recálculo cuando cambia (se le pasa el tamaño
 * del catálogo, que cambia justo después de cada venta vía
 * productCatalogStore.refresh() en processSale.ts).
 */
export function useTopSellingProducts(refreshKey: unknown): Map<string, number> {
  const [ranking, setRanking] = useState<Map<string, number>>(new Map());

  useEffect(() => {
    let cancelled = false;

    (async () => {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - THIRTY_DAYS_MS);
        const sales = await container.salesEngine.get().getSalesByDate(from, to);
        const { bestSellingProducts } = container.salesEngine.get().calculateStatistics(sales);

        if (cancelled) return;

        const next = new Map<string, number>();
        bestSellingProducts.forEach((entry, index) => next.set(entry.productId, index));
        setRanking(next);
      } catch {
        // Si falla (p.ej. sin ventas todavía / offline), el POS simplemente
        // muestra el catálogo en su orden normal — nunca debe bloquear la venta.
        if (!cancelled) setRanking(new Map());
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshKey]);

  return ranking;
}