import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingInventoryAdjustmentsStore } from "./pendingInventoryAdjustmentsStore";
import type { PendingInventoryAdjustment } from "./PendingInventoryAdjustment";
import { vimdyCore } from "../VimdyCore";
import { logError } from "../../infrastructure/logging/opsLogger";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";

/**
 * syncPendingInventoryAdjustments.ts
 * ---------------------------------------------------------------------------
 * PASO 1.7 del plan offline: recorre la cola (pendingInventoryAdjustmentsStore)
 * y reproduce cada ajuste contra Supabase usando el MISMO engine real que
 * usa un ajuste online (InventoryEngine.increaseStock()/decreaseStock()) —
 * nunca un camino paralelo. Mismo diseño que syncPendingSales.ts.
 *
 * Idempotencia: `pending.id` viaja como `movementId` — ver nota completa en
 * KardexEngine.record() e InventoryEngine.increaseStock()/decreaseStock().
 *
 * Arranca/para junto con la sesión del negocio (ver start()/stop(), y su
 * conexión en AuthContext.tsx junto a startOfflineSalesSync/stopOfflineSalesSync).
 */

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

/** Reproduce un único PendingInventoryAdjustment contra Supabase usando InventoryEngine real. */
async function syncOne(pending: PendingInventoryAdjustment): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: el ajuste de inventario offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  if (pending.type === "INCREASE") {
    await container.inventoryEngine.increaseStock(
      pending.productId,
      pending.quantity,
      pending.reason,
      pending.performedBy,
      pending.supplierId,
      pending.purchasePrice,
      pending.id
    );
  } else {
    await container.inventoryEngine.decreaseStock(
      pending.productId,
      pending.quantity,
      pending.reason,
      pending.performedBy,
      pending.lossCategory,
      pending.id
    );
  }
}

export async function syncPendingInventoryAdjustments(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!connectionStore.isOnline()) return;

    await pendingInventoryAdjustmentsStore.recoverStuckSyncing();
    const queue = await pendingInventoryAdjustmentsStore.findSyncable();
    if (queue.length === 0) return;

    let syncedCount = 0;
    let failedCount = 0;

    try {
      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;

        if ((pending.attempts ?? 0) >= MAX_OFFLINE_ATTEMPTS) {
          await pendingInventoryAdjustmentsStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingInventoryAdjustmentsStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingInventoryAdjustmentsStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkFailure(error)) {
            await pendingInventoryAdjustmentsStore.requeue(pending.id);
            break;
          }

          if (isBusinessError(error)) {
            await pendingInventoryAdjustmentsStore.markPermanentFailure(pending.id, error instanceof Error ? error.message : String(error));
            failedCount += 1;
            continue;
          }

          const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
          await pendingInventoryAdjustmentsStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;
    }

    if (syncedCount > 0) {
      await productCatalogStore.refresh().catch((error) => {
        logError("No se pudo refrescar el catálogo tras sincronizar ajustes offline", { category: "offline", context: { error: String(error) } });
      });

      vimdyCore.emit("inventory");

      toast.success(
        syncedCount === 1
          ? "1 ajuste de inventario sin conexión se sincronizó correctamente."
          : `${syncedCount} ajustes de inventario sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 ajuste de inventario sin conexión no se pudo sincronizar y quedó para revisión manual."
          : `${failedCount} ajustes de inventario sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingInventoryAdjustmentsStore.syncable().length > 0) {
    void syncPendingInventoryAdjustments();
  }
}

export function startOfflineInventorySync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return;

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingInventoryAdjustmentsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

export function stopOfflineInventorySync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
  syncPromise = null;
}
