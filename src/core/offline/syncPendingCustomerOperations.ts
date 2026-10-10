import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingCustomerOperationsStore } from "./pendingCustomerOperationsStore";
import type { PendingCustomerOperation } from "./PendingCustomerOperation";
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

async function syncOne(pending: PendingCustomerOperation): Promise<void> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (!currentBusinessId || !currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay negocio/sucursal activos para sincronizar el cliente ${pending.id}.`
    );
  }

  if (
    pending.businessId !== currentBusinessId ||
    pending.branchId !== currentBranchId
  ) {
    throw new Error(
      `CONTEXT_MISMATCH: el cliente offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  // CustomerRepository.save() usa upsert por id: el mismo customer.id es la
  // clave de idempotencia. No se usa una segunda ruta paralela.
  await container.customerEngine.get().save(pending.customer);
}

function scheduleRetry(): void {
  if (!lifecycleActive || retryTimer) return;

  retryTimer = setTimeout(() => {
    retryTimer = null;
    triggerIfNeeded();
  }, SYNC_BACKOFF_MS);
}

export async function syncPendingCustomerOperations(): Promise<void> {
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    let syncedCount = 0;
    let failedCount = 0;

    try {
      if (!connectionStore.isOnline()) return;
      if (Date.now() < syncBackoffUntil) return;

      await pendingCustomerOperationsStore.recoverStuckSyncing();
      const queue = await pendingCustomerOperationsStore.findSyncable();
      if (queue.length === 0) return;

      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;
        if (Date.now() < syncBackoffUntil) break;

        if (pending.attempts >= MAX_OFFLINE_ATTEMPTS) {
          await pendingCustomerOperationsStore.markPermanentFailure(
            pending.id,
            "MAX_ATTEMPTS_REACHED"
          );
          failedCount += 1;
          continue;
        }

        const started = await pendingCustomerOperationsStore.markSyncing(
          pending.id
        );
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingCustomerOperationsStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          const message =
            error instanceof Error ? error.message : String(error);

          if (isNetworkFailure(error)) {
            syncBackoffUntil = Date.now() + SYNC_BACKOFF_MS;
            await pendingCustomerOperationsStore.requeue(pending.id);
            scheduleRetry();
            break;
          }

          if (isBusinessError(error)) {
            await pendingCustomerOperationsStore.markPermanentFailure(
              pending.id,
              message
            );
            failedCount += 1;
            continue;
          }

          await pendingCustomerOperationsStore.markFailed(
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
          : `${failedCount} clientes sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
      );
    }
  })();

  return syncPromise;
}

function triggerIfNeeded(): void {
  if (
    !connectionStore.isOnline() ||
    Date.now() < syncBackoffUntil ||
    pendingCustomerOperationsStore.syncable().length === 0
  ) {
    return;
  }

  void syncPendingCustomerOperations();
}

export function startOfflineCustomerSync(): void {
  lifecycleActive = true;

  if (!unsubscribeConnection) {
    unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  }

  if (!unsubscribeQueue) {
    unsubscribeQueue = pendingCustomerOperationsStore.subscribe(
      triggerIfNeeded
    );
  }

  triggerIfNeeded();
}

export function stopOfflineCustomerSync(): void {
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
