import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingCustomerOperationsStore } from "./pendingCustomerOperationsStore";
import type { PendingCustomerOperation } from "./PendingCustomerOperation";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";

/**
 * syncPendingCustomerOperations.ts
 * ---------------------------------------------------------------------------
 * PASO 1.9 del plan offline: recorre la cola (pendingCustomerOperationsStore)
 * y reproduce cada creación de cliente contra Supabase usando el MISMO
 * engine real que usa la creación online (CustomerEngine.save()) — nunca un
 * camino paralelo. Mismo diseño que syncPendingSales.ts /
 * syncPendingInventoryAdjustments.ts / syncPendingTableOperations.ts.
 *
 * Arranca/para junto con la sesión del negocio (ver start()/stop(), y su
 * conexión en AuthContext.tsx junto a startOfflineSalesSync/
 * startOfflineInventorySync/startOfflineTableSync).
 */

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

async function syncOne(pending: PendingCustomerOperation): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: el cliente offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  await container.customerEngine.get().save(pending.customer);
}

export async function syncPendingCustomerOperations(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!connectionStore.isOnline()) return;

    await pendingCustomerOperationsStore.recoverStuckSyncing();
    const queue = await pendingCustomerOperationsStore.findSyncable();
    if (queue.length === 0) return;

    let syncedCount = 0;
    let failedCount = 0;

    try {
      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;

        if ((pending.attempts ?? 0) >= MAX_OFFLINE_ATTEMPTS) {
          await pendingCustomerOperationsStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingCustomerOperationsStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingCustomerOperationsStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkFailure(error)) {
            await pendingCustomerOperationsStore.requeue(pending.id);
            break;
          }

          if (isBusinessError(error)) {
            await pendingCustomerOperationsStore.markPermanentFailure(pending.id, error instanceof Error ? error.message : String(error));
            failedCount += 1;
            continue;
          }

          const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
          await pendingCustomerOperationsStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;
    }

    if (syncedCount > 0) {
      toast.success(
        syncedCount === 1
          ? "1 cliente sin conexión se sincronizó correctamente."
          : `${syncedCount} clientes sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 cliente sin conexión no se pudo sincronizar y quedó para revisión manual."
          : `${failedCount} clientes sin conexión no se pudieron sincronizar y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingCustomerOperationsStore.syncable().length > 0) {
    void syncPendingCustomerOperations();
  }
}

export function startOfflineCustomerSync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return;

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingCustomerOperationsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

export function stopOfflineCustomerSync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
  syncPromise = null;
}
