import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingTableOperationsStore } from "./pendingTableOperationsStore";
import type { PendingTableOperation } from "./PendingTableOperation";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";
import { OrderPriority } from "../entities/Entities";

/**
 * syncPendingTableOperations.ts
 * ---------------------------------------------------------------------------
 * PASO 1.8 del plan offline: recorre la cola (pendingTableOperationsStore) y
 * reproduce cada apertura/cierre de mesa contra Supabase usando el MISMO
 * engine real que usa la operación online (TableEngine.openTable()/
 * closeTable()) — nunca un camino paralelo. Mismo diseño que
 * syncPendingSales.ts / syncPendingInventoryAdjustments.ts.
 *
 * Para CLOSE, closeTable() ya hace TODO lo que haría un cobro online real
 * (crear la venta vía SalesEngine con el mismo saleId idempotente, cobrarla,
 * generar e imprimir el recibo, dejar la mesa libre) — no hace falta
 * reimplementar nada de eso aquí.
 *
 * Arranca/para junto con la sesión del negocio (ver start()/stop(), y su
 * conexión en AuthContext.tsx junto a startOfflineSalesSync/
 * startOfflineInventorySync).
 */

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

async function syncOne(pending: PendingTableOperation): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: la operación de mesa offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  if (pending.type === "OPEN") {
    if (!pending.openInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta openInput.");
    }
    await container.tableEngine.get().openTable(pending.openInput);
  } else if (pending.type === "CLOSE") {
    if (!pending.closeInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta closeInput.");
    }
    await container.tableEngine.get().closeTable(pending.closeInput);
  } else if (pending.type === "ADD_ITEM") {
    if (!pending.addItemInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta addItemInput.");
    }
    const product = productCatalogStore.getById(pending.addItemInput.productId);
    if (!product) {
      throw new Error(`PENDING_TABLE_OPERATION_MISSING_PRODUCT: no se encontró el producto ${pending.addItemInput.productId} en el catálogo.`);
    }
    await container.tableEngine.get().addItem({
      tableId: pending.tableId,
      product,
      quantity: pending.addItemInput.quantity,
      note: pending.addItemInput.note
    });
  } else if (pending.type === "REMOVE_ITEM") {
    if (!pending.removeItemInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta removeItemInput.");
    }
    await container.tableEngine.get().removeItem(pending.tableId, pending.removeItemInput.productId);
  } else if (pending.type === "UPDATE_QUANTITY") {
    if (!pending.updateQuantityInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta updateQuantityInput.");
    }
    await container.tableEngine.get().updateItemQuantity(
      pending.tableId,
      pending.updateQuantityInput.productId,
      pending.updateQuantityInput.quantity
    );
  } else if (pending.type === "SEND_TO_KITCHEN") {
    await container.tableEngine.get().sendToKitchen(pending.tableId, pending.sendToKitchenInput?.priority as OrderPriority | undefined);
  }
}

export async function syncPendingTableOperations(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!connectionStore.isOnline()) return;

    await pendingTableOperationsStore.recoverStuckSyncing();
    const queue = await pendingTableOperationsStore.findSyncable();
    if (queue.length === 0) return;

    let syncedCount = 0;
    let failedCount = 0;

    try {
      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;

        if ((pending.attempts ?? 0) >= MAX_OFFLINE_ATTEMPTS) {
          await pendingTableOperationsStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingTableOperationsStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingTableOperationsStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkFailure(error)) {
            await pendingTableOperationsStore.requeue(pending.id);
            break;
          }

          if (isBusinessError(error)) {
            await pendingTableOperationsStore.markPermanentFailure(pending.id, error instanceof Error ? error.message : String(error));
            failedCount += 1;
            continue;
          }

          const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
          await pendingTableOperationsStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;
    }

    if (syncedCount > 0) {
      toast.success(
        syncedCount === 1
          ? "1 operación de mesa sin conexión se sincronizó correctamente."
          : `${syncedCount} operaciones de mesa sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 operación de mesa sin conexión no se pudo sincronizar y quedó para revisión manual."
          : `${failedCount} operaciones de mesa sin conexión no se pudieron sincronizar y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingTableOperationsStore.syncable().length > 0) {
    void syncPendingTableOperations();
  }
}

export function startOfflineTableSync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return;

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingTableOperationsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

export function stopOfflineTableSync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
  syncPromise = null;
}
