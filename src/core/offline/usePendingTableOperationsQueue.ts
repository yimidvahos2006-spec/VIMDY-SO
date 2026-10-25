import { useMemo, useSyncExternalStore } from "react";

import { pendingTableOperationsStore, PendingTableOperationsSnapshot } from "./pendingTableOperationsStore";
import { PendingTableOperation } from "./PendingTableOperation";
import { BlockedTable, blockedTablesFrom } from "./tableConflictRules";

export interface UsePendingTableOperationsQueueResult extends PendingTableOperationsSnapshot {
  /** Cuántas operaciones hay en la cola en total (incluye SYNCING y FAILED). */
  count: number;
  /** Solo las que están esperando su turno. */
  pending: PendingTableOperation[];
  /**
   * Mesas con operaciones retenidas por conflicto (derivado de la cola, igual
   * que pendingTableOperationsStore.blockedTables()). Alimenta el aviso
   * TableConflictBanner de Meseros.
   */
  blocked: BlockedTable[];
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

  const blocked = useMemo(() => blockedTablesFrom(snapshot.items), [snapshot.items]);

  return {
    ...snapshot,
    count: snapshot.items.length,
    pending: snapshot.items.filter((op) => op.status === "PENDING_SYNC"),
    blocked
  };
}