import { useSyncExternalStore } from "react";

import { pendingPurchasesStore, PendingPurchasesSnapshot } from "./pendingPurchasesStore";
import { PendingPurchase } from "./PendingPurchase";

export interface UsePendingPurchasesQueueResult extends PendingPurchasesSnapshot {
  /** Cuántas compras hay en la cola en total (incluye SYNCING, FAILED y PERMANENT_FAILURE). */
  count: number;
  /** Solo las que están esperando su turno. */
  pending: PendingPurchase[];
  /** Las que necesitan revisión manual (el servidor las rechazó o se agotaron los intentos). */
  needsReview: PendingPurchase[];
}

/**
 * usePendingPurchasesQueue
 * ---------------------------------------------------------------------------
 * Versión React de pendingPurchasesStore, mismo patrón exacto que
 * usePendingInventoryAdjustmentsQueue.ts. Sirve para mostrar en Compras
 * cuántas compras siguen esperando sincronizarse.
 */
export function usePendingPurchasesQueue(): UsePendingPurchasesQueueResult {
  const snapshot = useSyncExternalStore(
    pendingPurchasesStore.subscribe,
    pendingPurchasesStore.getSnapshot
  );

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((purchase) => purchase.status === "PENDING_SYNC"),
    needsReview: snapshot.items.filter(
      (purchase) => purchase.status === "FAILED" || purchase.status === "PERMANENT_FAILURE"
    )
  };
}