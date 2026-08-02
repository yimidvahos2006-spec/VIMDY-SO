import { useSyncExternalStore } from "react";

import { pendingTableOperationsStore, PendingTableOperationsSnapshot } from "./pendingTableOperationsStore";
import { PendingTableOperation } from "./PendingTableOperation";

export interface UsePendingTableOperationsQueueResult extends PendingTableOperationsSnapshot {
  /** Cuántas operaciones hay en la cola en total (incluye SYNCING y FAILED). */
  count: number;
  /** Solo las que están esperando su turno. */
  pending: PendingTableOperation[];
}

/**
 * usePendingTableOperationsQueue
 * ---------------------------------------------------------------------------
 * PASO 1.10 del plan offline: versión React de pendingTableOperationsStore,
 * mismo patrón exacto que usePendingSalesQueue.ts /
 * usePendingInventoryAdjustmentsQueue.ts. La usa el badge "offline elegante"
 * de Mesas (ver Meseros.tsx) para mostrar cuántas aperturas/cierres de mesa
 * siguen esperando sincronizarse.
 */
export function usePendingTableOperationsQueue(): UsePendingTableOperationsQueueResult {
  const snapshot = useSyncExternalStore(
    pendingTableOperationsStore.subscribe,
    pendingTableOperationsStore.getSnapshot
  );

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((op) => op.status === "PENDING_SYNC")
  };
}