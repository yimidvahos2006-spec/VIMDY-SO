import { useCallback, useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "./useVimdyCore";
import { enrichKitchenOrders, KitchenOrderView } from "../core/services/kitchenOrderEnrichment";

/**
 * Historial de comandas ENTREGADAS. Lee de `container.kitchenService.getHistory()`,
 * que filtra sobre el mismo repositorio real de KitchenEngine — las comandas
 * nunca se borran, solo cambian de estado (ver KitchenEngine.getDeliveredOrders).
 *
 * Se refresca automáticamente en cuanto una comanda pasa a ENTREGADO en
 * cualquier otra pantalla, escuchando el mismo evento "kitchen" del bus
 * global que usa useKitchenOrders.
 */
export function useKitchenHistory() {
  const [orders, setOrders] = useState<KitchenOrderView[]>([]);
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    // PASO 1.11 (Prueba de humo offline) — mismo blindaje que
    // useWaiterLeaderboard/useKitchenOrders: si alguna de las 5 llamadas
    // falla por red, `loading` igual se resuelve en el finally, en vez de
    // dejar el historial de Cocina con el spinner colgado.
    try {
      const [rawOrders, products, tables, users, waiters, categories] = await Promise.all([
        container.kitchenService.getHistory(),
        container.inventoryEngine.listAll(),
        container.tableEngine.getAllTables(),
        container.userEngine.listUsers(),
        container.waiterEngine.listAll(),
        container.categoryEngine.listAll()
      ]);

      // getDeliveredOrders ya ordena más reciente primero.
      const enriched = enrichKitchenOrders(rawOrders, { products, tables, users, waiters, categories });

      setOrders(enriched);
    } catch (error) {
      console.warn("[useKitchenHistory] No se pudo cargar el historial de cocina:", error);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  useVimdyEvent("kitchen", () => {
    reload();
  });

  return { orders, loading, reload };
}