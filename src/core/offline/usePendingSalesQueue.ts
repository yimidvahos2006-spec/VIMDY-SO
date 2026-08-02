import { useSyncExternalStore } from "react";

import { pendingSalesStore, PendingSalesSnapshot } from "./pendingSalesStore";
import { PendingSale } from "./PendingSale";

export interface UsePendingSalesQueueResult extends PendingSalesSnapshot {
  /** Cuántas ventas hay en la cola en total (incluye SYNCING y FAILED). */
  count: number;
  /** Solo las que están esperando su turno (útil para el banner de la Parte 5). */
  pending: PendingSale[];
}

/**
 * usePendingSalesQueue
 * ---------------------------------------------------------------------------
 * Parte 2 — versión React de pendingSalesStore. Igual que useConnection,
 * el store ya se hidrata solo al importarse, así que este hook solo se
 * suscribe con useSyncExternalStore y no necesita ningún useEffect propio.
 */
export function usePendingSalesQueue(): UsePendingSalesQueueResult {
  const snapshot = useSyncExternalStore(pendingSalesStore.subscribe, pendingSalesStore.getSnapshot);

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((sale) => sale.status === "PENDING_SYNC")
  };
}