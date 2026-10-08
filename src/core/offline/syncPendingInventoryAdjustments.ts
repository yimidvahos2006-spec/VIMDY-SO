import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingInventoryAdjustmentsStore } from "./pendingInventoryAdjustmentsStore";
import type { PendingInventoryAdjustment } from "./PendingInventoryAdjustment";
import { vimdyCore } from "../VimdyCore";
import { logError } from "../../infrastructure/logging/opsLogger";
import {
  getCurrentBusinessId,
  getCurrentBranchId
} from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";

const SYNC_BACKOFF_MS = 5000;

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleActive = false;
let syncBackoffUntil = 0;

function isPermanentInventoryError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    isBusinessError(error) ||
    message.startsWith("IDEMPOTENCY_KEY_REUSED") ||
    message.startsWith("INVALID_STOCK_QUANTITY") ||
    message.startsWith("PURCHASE_PRICE_INVALID") ||
    message.startsWith("PRODUCT_STOCK_TRACKING_DISABLED")
  );
}

async function syncOne(pending: PendingInventoryAdjustment): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (!currentBusinessId || !currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay negocio/sucursal activos para sincronizar el ajuste ${pending.id}.`
    );
  }

  if (
    pending.businessId !== currentBusinessId ||
    pending.branchId !== currentBranchId
  ) {
    throw new Error(
      `CONTEXT_MISMATCH: el ajuste de inventario offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  // InventoryEngine termina en la RPC atómica que recibe movementId.
  // pending.id viaja como esa clave y evita volver a descontar/sumar stock.
  if (pending.type === "INCREASE") {
    await container.inventoryEngine.get().increaseStock(
      pending.productId,
      pending.quantity,
      pending.reason,
      pending.performedBy,
      pending.supplierId,
      pending.purchasePrice,
      pending.id,
      pending.branchId
    );
    return;
  }

  await container.inventoryEngine.get().decreaseStock(
    pending.productId,
    pending.quantity,
    pending.reason,
    pending.performedBy,
    pending.lossCategory,
    pending.id,
    pending.branchId
  );
}

function scheduleRetry(): void {
  if (!lifecycleActive || retryTimer) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    triggerIfNeeded();
  }, SYNC_BACKOFF_MS);
}

export async function syncPendingInventoryAdjustments(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    let syncedCount = 0;
    let failedCount = 0;

    try {
      if (!connectionStore.isOnline()) return;
      if (Date.now() < syncBackoffUntil) return;

      await pendingInventoryAdjustmentsStore.recoverStuckSyncing();
      const queue = await pendingInventoryAdjustmentsStore.findSyncable();
      if (queue.length === 0) return;

      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;
        if (Date.now() < syncBackoffUntil) break;

        if (pending.attempts >= MAX_OFFLINE_ATTEMPTS) {
          await pendingInventoryAdjustmentsStore.markPermanentFailure(
            pending.id,
            "MAX_ATTEMPTS_REACHED"
          );
          failedCount += 1;
          continue;
        }

        const started = await pendingInventoryAdjustmentsStore.markSyncing(
          pending.id
        );
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingInventoryAdjustmentsStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          if (isPermanentInventoryError(error)) {
            await pendingInventoryAdjustmentsStore.markPermanentFailure(
              pending.id,
              message
            );
            failedCount += 1;
            continue;
          }

          if (isNetworkFailure(error)) {
            syncBackoffUntil = Date.now() + SYNC_BACKOFF_MS;
            await pendingInventoryAdjustmentsStore.requeue(pending.id);
            scheduleRetry();
            logError("Fallo de red al sincronizar ajuste de inventario offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                productId: pending.productId,
                error: message
              }
            });
            break;
          }

          await pendingInventoryAdjustmentsStore.markFailed(
            pending.id,
            message
          );
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;

      if (
        lifecycleActive &&
        connectionStore.isOnline() &&
        Date.now() >= syncBackoffUntil
      ) {
        queueMicrotask(triggerIfNeeded);
      }
    }

    if (syncedCount > 0) {
      await productCatalogStore.refresh().catch((error) => {
        logError(
          "No se pudo refrescar el catálogo tras sincronizar ajustes offline",
          {
            category: "offline",
            context: { error: String(error) }
          }
        );
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
  if (
    !connectionStore.isOnline() ||
    Date.now() < syncBackoffUntil ||
    pendingInventoryAdjustmentsStore.syncable().length === 0
  ) {
    return;
  }

  void syncPendingInventoryAdjustments();
}

export function startOfflineInventorySync(): void {
  lifecycleActive = true;

  if (!unsubscribeConnection) {
    unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  }
  if (!unsubscribeQueue) {
    unsubscribeQueue = pendingInventoryAdjustmentsStore.subscribe(
      triggerIfNeeded
    );
  }

  triggerIfNeeded();
}

export function stopOfflineInventorySync(): void {
  lifecycleActive = false;

  unsubscribeConnection?.();
  unsubscribeQueue?.();

  unsubscribeConnection = null;
  unsubscribeQueue = null;

  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
}
