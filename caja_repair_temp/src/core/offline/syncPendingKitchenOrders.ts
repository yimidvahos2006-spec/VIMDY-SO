import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingKitchenOrdersStore } from "./pendingKitchenOrdersStore";
import type { PendingKitchenOrder } from "./PendingKitchenOrder";
import type { KitchenOrder } from "../entities/Entities";
import { logError } from "../../infrastructure/logging/opsLogger";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";

/**
 * syncPendingKitchenOrders.ts
 * ---------------------------------------------------------------------------
 * Parte 2 del plan de cocina offline: recorre la cola
 * (pendingKitchenOrdersStore) y reproduce cada comanda contra Supabase
 * usando el MISMO engine real que usa el flujo online (kitchen.save()) —
 * nunca un camino paralelo. Mismo diseño que syncPendingSales.ts /
 * syncPendingTableOperations.ts.
 */

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribePendingKitchenOrders: (() => void) | null = null;
let syncBackoffUntil = 0;

async function syncOne(pending: PendingKitchenOrder): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (!currentBusinessId || !currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay sesión activa (businessId=${currentBusinessId ?? "null"}, branchId=${currentBranchId ?? "null"}). No se puede sincronizar.`
    );
  }

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: la comanda offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  await container.kitchenEngine.get().save(pending.order);
}

export async function syncPendingKitchenOrders(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!connectionStore.isOnline()) return;

    if (Date.now() < syncBackoffUntil) return;

    await pendingKitchenOrdersStore.recoverStuckSyncing();
    const queue = await pendingKitchenOrdersStore.findSyncable();
    if (queue.length === 0) return;

    let syncedCount = 0;
    let failedCount = 0;

    try {
      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;

        if ((pending.attempts ?? 0) >= MAX_OFFLINE_ATTEMPTS) {
          await pendingKitchenOrdersStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingKitchenOrdersStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingKitchenOrdersStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkFailure(error)) {
            syncBackoffUntil = Date.now() + 5000;
            logError("Fallo de red al sincronizar comanda offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                businessId: pending.businessId,
                branchId: pending.branchId,
                attempts: pending.attempts,
                error: error instanceof Error ? error.message : String(error)
              }
            });
            await pendingKitchenOrdersStore.requeue(pending.id);
            break;
          }

          if (isBusinessError(error)) {
            logError("Error de negocio al sincronizar comanda offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                businessId: pending.businessId,
                branchId: pending.branchId,
                error: error instanceof Error ? error.message : String(error)
              }
            });
            await pendingKitchenOrdersStore.markPermanentFailure(pending.id, error instanceof Error ? error.message : String(error));
            failedCount += 1;
            continue;
          }

          const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
          logError("Error desconocido al sincronizar comanda offline", {
            category: "offline",
            context: {
              pendingId: pending.id,
              businessId: pending.businessId,
              branchId: pending.branchId,
              error: message
            }
          });
          await pendingKitchenOrdersStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;
    }

    if (syncedCount > 0) {
      syncBackoffUntil = 0;
      productCatalogStore.refresh().catch((error) => {
        logError("No se pudo refrescar el catálogo tras sincronizar comandas offline", { category: "offline", context: { error: String(error) } });
      });

      vimdyCore.emit("kitchen");

      toast.success(
        syncedCount === 1
          ? "1 comanda sin conexión se sincronizó correctamente."
          : `${syncedCount} comandas sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 comanda sin conexión no se pudo sincronizar y quedó para revisión manual."
          : `${failedCount} comandas sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingKitchenOrdersStore.syncable().length > 0) {
    void syncPendingKitchenOrders();
  }
}

export function startOfflineKitchenSync(): void {
  if (unsubscribeConnection || unsubscribePendingKitchenOrders) return;

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribePendingKitchenOrders = pendingKitchenOrdersStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

export function stopOfflineKitchenSync(): void {
  unsubscribeConnection?.();
  unsubscribePendingKitchenOrders?.();
  unsubscribeConnection = null;
  unsubscribePendingKitchenOrders = null;
  syncPromise = null;
}
