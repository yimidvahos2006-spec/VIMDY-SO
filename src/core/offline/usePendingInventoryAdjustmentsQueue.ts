import { useSyncExternalStore } from "react";

import { pendingInventoryAdjustmentsStore, PendingInventoryAdjustmentsSnapshot } from "./pendingInventoryAdjustmentsStore";
import { PendingInventoryAdjustment } from "./PendingInventoryAdjustment";

export interface UsePendingInventoryAdjustmentsQueueResult extends PendingInventoryAdjustmentsSnapshot {
  /** Cuántos ajustes hay en la cola en total (incluye SYNCING y FAILED). */
  count: number;
  /** Solo los que están esperando su turno. */
  pending: PendingInventoryAdjustment[];
}

/**
 * usePendingInventoryAdjustmentsQueue
 * ---------------------------------------------------------------------------
 * PASO 1.10 del plan offline: versión React de pendingInventoryAdjustmentsStore,
 * mismo patrón exacto que usePendingSalesQueue.ts. La usa el badge "offline
 * elegante" de Inventario (ver InventoryDashboard.tsx) para mostrar cuántos
 * ajustes de stock siguen esperando sincronizarse.
 */
export function usePendingInventoryAdjustmentsQueue(): UsePendingInventoryAdjustmentsQueueResult {
  const snapshot = useSyncExternalStore(
    pendingInventoryAdjustmentsStore.subscribe,
    pendingInventoryAdjustmentsStore.getSnapshot
  );

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((adjustment) => adjustment.status === "PENDING_SYNC")
  };
}