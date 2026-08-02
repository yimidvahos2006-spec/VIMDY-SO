import { useSyncExternalStore } from "react";

import { pendingCustomerOperationsStore, PendingCustomerOperationsSnapshot } from "./pendingCustomerOperationsStore";
import { PendingCustomerOperation } from "./PendingCustomerOperation";

export interface UsePendingCustomerOperationsQueueResult extends PendingCustomerOperationsSnapshot {
  /** Cuántos clientes hay en la cola en total (incluye SYNCING y FAILED). */
  count: number;
  /** Solo los que están esperando su turno. */
  pending: PendingCustomerOperation[];
}

/**
 * usePendingCustomerOperationsQueue
 * ---------------------------------------------------------------------------
 * PASO 1.10 del plan offline: versión React de pendingCustomerOperationsStore,
 * mismo patrón exacto que usePendingSalesQueue.ts /
 * usePendingInventoryAdjustmentsQueue.ts / usePendingTableOperationsQueue.ts.
 * La usa el badge "offline elegante" de Clientes (ver CustomerDashboard.tsx)
 * para mostrar cuántos clientes nuevos siguen esperando sincronizarse.
 */
export function usePendingCustomerOperationsQueue(): UsePendingCustomerOperationsQueueResult {
  const snapshot = useSyncExternalStore(
    pendingCustomerOperationsStore.subscribe,
    pendingCustomerOperationsStore.getSnapshot
  );

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((op) => op.status === "PENDING_SYNC")
  };
}