import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingPurchasesStore } from "./pendingPurchasesStore";
import type { PendingPurchase } from "./PendingPurchase";
import type { PurchaseReceiptResult } from "../engines/PurchaseOrderEngine";
import { vimdyCore } from "../VimdyCore";
import { logError } from "../../infrastructure/logging/opsLogger";
import {
  getCurrentBusinessId,
  getCurrentBranchId
} from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError } from "./offlineConstants";

/**
 * syncPendingPurchases
 * ---------------------------------------------------------------------------
 * Sincroniza la cola dedicada de Compras (PendingPurchase) contra el
 * servidor. Mismo patrón que syncPendingInventoryAdjustments.ts.
 *
 * Cada compra viaja con `operationId = pending.id`, la clave de idempotencia
 * guardada en IndexedDB: si un intento anterior sí llegó al servidor pero la
 * respuesta se perdió (o el navegador se reinició), el servidor responde
 * "idempotent" y NO suma el stock otra vez.
 */

const SYNC_BACKOFF_MS = 5000;

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleActive = false;
let syncBackoffUntil = 0;

/**
 * ¿El servidor (o la validación local) rechazó la compra por una regla de
 * negocio? Esas NO se reintentan: repetirlas daría el mismo error. Cualquier
 * otro fallo (red, error inesperado) se conserva en la cola para reintentar.
 */
export function isPermanentPurchaseError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);

  return (
    isBusinessError(error) ||
    /PURCHASE_[A-Z_]+/.test(message) ||
    message.startsWith("SUPPLIER_REQUIRED") ||
    message.startsWith("ITEMS_REQUIRED") ||
    message.startsWith("INVALID_ITEM") ||
    message.startsWith("DUPLICATE_PURCHASE") ||
    message.startsWith("IDEMPOTENCY_KEY_REUSED")
  );
}

/**
 * Ejecuta UNA compra pendiente contra el servidor, con su clave de
 * idempotencia. Lo usan el ciclo automático (abajo) y el registro inmediato
 * (offlinePurchase.ts), para que los dos hagan exactamente lo mismo.
 */
export async function executePendingPurchase(
  pending: PendingPurchase
): Promise<PurchaseReceiptResult> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (!currentBusinessId || !currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay negocio/sucursal activos para sincronizar la compra ${pending.id}.`
    );
  }

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: la compra offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  const engine = container.purchaseOrderEngine.get();

  if (pending.kind === "DIRECT") {
    if (!pending.supplierId) {
      throw new Error("SUPPLIER_REQUIRED");
    }

    return engine.recordDirectPurchase({
      supplierId: pending.supplierId,
      items: pending.items,
      invoiceNumber: pending.invoiceNumber,
      note: pending.note,
      performedBy: pending.performedBy,
      operationId: pending.id
    });
  }

  if (!pending.purchaseOrderId) {
    throw new Error("PURCHASE_ORDER_NOT_FOUND");
  }

  return engine.markAsPurchased(
    pending.purchaseOrderId,
    pending.performedBy,
    [...pending.items],
    pending.id
  );
}

function scheduleRetry(): void {
  if (!lifecycleActive || retryTimer) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    triggerIfNeeded();
  }, SYNC_BACKOFF_MS);
}

export async function syncPendingPurchases(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    let syncedCount = 0;
    let failedCount = 0;

    try {
      if (!connectionStore.isOnline()) return;
      if (Date.now() < syncBackoffUntil) return;

      await pendingPurchasesStore.recoverStuckSyncing();
      const queue = await pendingPurchasesStore.findSyncable();
      if (queue.length === 0) return;

      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;
        if (Date.now() < syncBackoffUntil) break;

        if (pending.attempts >= MAX_OFFLINE_ATTEMPTS) {
          await pendingPurchasesStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingPurchasesStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await executePendingPurchase(pending);
          await pendingPurchasesStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);

          if (isPermanentPurchaseError(error)) {
            await pendingPurchasesStore.markPermanentFailure(pending.id, message);
            failedCount += 1;
            continue;
          }

          if (isNetworkFailure(error)) {
            syncBackoffUntil = Date.now() + SYNC_BACKOFF_MS;
            await pendingPurchasesStore.requeue(pending.id, message);
            scheduleRetry();
            logError("Fallo de red al sincronizar compra offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                kind: pending.kind,
                error: message
              }
            });
            break;
          }

          await pendingPurchasesStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;

      if (lifecycleActive && connectionStore.isOnline() && Date.now() >= syncBackoffUntil) {
        queueMicrotask(triggerIfNeeded);
      }
    }

    if (syncedCount > 0) {
      await productCatalogStore.refresh().catch((error) => {
        logError("No se pudo refrescar el catálogo tras sincronizar compras offline", {
          category: "offline",
          context: { error: String(error) }
        });
      });

      vimdyCore.emit("inventory");

      toast.success(
        syncedCount === 1
          ? "1 compra sin conexión se sincronizó correctamente."
          : `${syncedCount} compras sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 compra sin conexión no se pudo sincronizar y quedó para revisión manual."
          : `${failedCount} compras sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (
    !connectionStore.isOnline() ||
    Date.now() < syncBackoffUntil ||
    pendingPurchasesStore.syncable().length === 0
  ) {
    return;
  }

  void syncPendingPurchases();
}

export function startOfflinePurchaseSync(): void {
  lifecycleActive = true;

  if (!unsubscribeConnection) {
    unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  }
  if (!unsubscribeQueue) {
    unsubscribeQueue = pendingPurchasesStore.subscribe(triggerIfNeeded);
  }

  // Tras un reinicio del navegador la cola ya está en IndexedDB pero el
  // snapshot en memoria todavía está vacío: se hidrata antes de decidir.
  void pendingPurchasesStore.refresh().then(triggerIfNeeded);
}

export function stopOfflinePurchaseSync(): void {
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

/** Solo para pruebas: limpia el estado interno entre un test y otro. */
export function resetOfflinePurchaseSyncStateForTests(): void {
  syncBackoffUntil = 0;
  syncPromise = null;
  stopOfflinePurchaseSync();
}