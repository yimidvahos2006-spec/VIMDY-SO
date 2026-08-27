import { useCallback, useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "./useVimdyCore";
import { computeWaiterLeaderboard, WaiterRankingEntry } from "../core/services/waiterLeaderboard";
import { logWarning } from "../infrastructure/logging/opsLogger";

/**
 * Ranking de meseros de HOY (00:00 a ahora), para la tarjeta "Mesero del
 * día" del Dashboard. Se recalcula solo, sin recargar la página, cada vez
 * que hay una venta nueva o cambia la lista de meseros.
 */
export function useWaiterLeaderboard() {
  const [entries, setEntries] = useState<WaiterRankingEntry[]>([]);
  const [totalActiveWaiters, setTotalActiveWaiters] = useState(0);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    // PASO 1.11 (Prueba de humo offline) — antes, si Promise.all rechazaba
    // (ej. sin conexión y el repositorio real todavía no tiene fallback
    // local), setLoading(false) nunca se llamaba y la tarjeta "Mesero del
    // día" del Dashboard se quedaba con el spinner colgado para siempre.
    // Con try/finally, `loading` siempre se resuelve pase lo que pase.
    try {
      const [sales, waiters] = await Promise.all([
        container.salesEngine.get().getSalesByDate(startOfToday),
        container.waiterEngine.get().listActive()
      ]);

      setEntries(computeWaiterLeaderboard(sales, waiters));
      setTotalActiveWaiters(waiters.length);
    } catch (error) {
      logWarning("[useWaiterLeaderboard] No se pudo cargar el ranking de meseros", { category: "sync", context: { error: String(error) } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useVimdyEvent("sale", () => reload());
  useVimdyEvent("waiter", () => reload());

  return { entries, totalActiveWaiters, loading };
}