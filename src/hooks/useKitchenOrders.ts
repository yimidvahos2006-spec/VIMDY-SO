import { useCallback, useEffect, useRef, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { KitchenOrder } from "../core/entities/Entities";
import { useVimdyEvent } from "./useVimdyCore";
import { announceNewKitchenOrders } from "../core/services/kitchenAlertService";
import { enrichKitchenOrders, KitchenOrderView } from "../core/services/kitchenOrderEnrichment";
import { useAuth } from "../presentation/context/AuthContext";
import { logWarning } from "../infrastructure/logging/opsLogger";

export type { KitchenOrderItemView, KitchenOrderView } from "../core/services/kitchenOrderEnrichment";

/** Cuánto tiempo se mantiene resaltada (glow) una comanda recién llegada. */
const NEW_ORDER_HIGHLIGHT_MS = 5000;

/**
 * Única fuente de verdad para leer comandas de cocina en la UI.
 *
 * Lee siempre de `container.kitchenService` (KitchenEngine real) — nunca
 * de un store local desconectado — y se refresca de inmediato cuando
 * Caja, Meseros o Pedidos envían o actualizan una comanda, escuchando el
 * evento "kitchen" del bus global (vimdyCore). El cruce contra inventario,
 * mesas y meseros vive en `kitchenOrderEnrichment`, compartido con
 * useKitchenHistory para que ambas pantallas resuelvan los datos igual.
 *
 * Además detecta comandas PENDIENTE que no existían en la carga anterior:
 * dispara el aviso sonoro + de voz (kitchenAlertService) y las marca como
 * "nuevas" por unos segundos para que la tarjeta se resalte en pantalla.
 */
export function useKitchenOrders() {
  const { user } = useAuth();
  const [orders, setOrders] = useState<KitchenOrderView[]>([]);
  const [loading, setLoading] = useState(true);
  const [newOrderIds, setNewOrderIds] = useState<Set<string>>(new Set());

  // null = todavía no cargamos nunca -> no hay que anunciar la carga inicial,
  // solo lo que llegue después de que la pantalla ya esté abierta.
  const knownIdsRef = useRef<Set<string> | null>(null);

  const reload = useCallback(async () => {
    // PASO 1.11 (Prueba de humo offline) — mismo blindaje que
    // useWaiterLeaderboard/useKitchenHistory: sin este try/finally, una
    // falla de red en cualquiera de las 5 llamadas dejaba la pantalla de
    // Cocina con el spinner colgado para siempre (loading nunca volvía a
    // false).
    try {
      const [rawOrders, products, tables, users, waiters, categories] = await Promise.all([
        container.kitchenService.getOrders(),
        container.inventoryEngine.listAll(),
        container.tableEngine.getAllTables(),
        container.userEngine.listUsers(),
        container.waiterEngine.listAll(),
        container.categoryEngine.listAll()
      ]);

      const enriched = enrichKitchenOrders(rawOrders, { products, tables, users, waiters, categories }).sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );

      const knownIds = knownIdsRef.current;

      if (knownIds !== null) {
        const arrived = enriched.filter(
          order => order.status === "PENDIENTE" && !knownIds.has(order.id)
        );

        if (arrived.length > 0) {
          announceNewKitchenOrders(arrived.map(order => ({ origin: order.origin })));

          setNewOrderIds(prev => {
            const next = new Set(prev);
            arrived.forEach(order => next.add(order.id));
            return next;
          });

          arrived.forEach(order => {
            window.setTimeout(() => {
              setNewOrderIds(prev => {
                if (!prev.has(order.id)) return prev;
                const next = new Set(prev);
                next.delete(order.id);
                return next;
              });
            }, NEW_ORDER_HIGHLIGHT_MS);
          });
        }
      }

      knownIdsRef.current = new Set(enriched.map(order => order.id));

      setOrders(enriched);
    } catch (error) {
      logWarning("[useKitchenOrders] No se pudieron cargar las comandas", { category: "kitchen", context: { error: String(error) } });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  // Cualquier save/updateStatus/delete en KitchenEngine emite "kitchen":
  // en cuanto Caja o Meseros envían un pedido, esto lo vuelve a cargar.
  useVimdyEvent("kitchen", () => {
    reload();
  });

  async function updateStatus(id: string, status: KitchenOrder["status"]) {
    await container.kitchenService.updateStatus(id, status);
    // No hace falta llamar a reload() aquí: KitchenEngine ya emite el
    // evento "kitchen" y el listener de arriba se encarga de refrescar.
  }

  /**
   * Cancela una comanda desde Cocina, con motivo obligatorio. El actor
   * queda tomado de la sesión real (useAuth), nunca de un valor fijo,
   * para que la auditoría (AuditEngine) registre quién canceló de verdad.
   */
  async function cancelOrder(id: string, reason: string) {
    if (!user) {
      throw new Error("No hay una sesión activa para cancelar la comanda.");
    }
    await container.kitchenService.cancelOrder(id, reason, user.id);
  }

  return { orders, loading, reload, updateStatus, cancelOrder, newOrderIds };
}