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
import {
  hasCustomerIdAlias,
  loadCustomerIdAliases,
  pruneCustomerIdAliases,
  registerCustomerIdAlias
} from "./customerIdAliases";
import { isCustomerPhoneConflict } from "./customerPhoneConflict";
import { CustomerLocalRepository } from "../../infrastructure/di/repositories/CustomerLocalRepository";
import { logWarning } from "../../infrastructure/logging/opsLogger";
import { vimdyCore } from "../VimdyCore";

const SYNC_BACKOFF_MS = 5000;

const localCustomers = new CustomerLocalRepository();

/** SAVED: se creó/actualizó; LINKED: ya existía (mismo teléfono) y se vinculó; SKIPPED: ya estaba resuelto. */
type SyncOutcome = "SAVED" | "LINKED" | "SKIPPED";

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleActive = false;
let syncBackoffUntil = 0;

async function syncOne(pending: PendingCustomerOperation): Promise<SyncOutcome> {
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

  // PASO 2: si este id local ya fue resuelto a un id canónico (p. ej. el
  // cliente llegó al servidor pero la app se cerró antes de sacarlo de la
  // cola), reintentar NO debe volver a guardarlo: crearía un duplicado.
  if (hasCustomerIdAlias(pending.id)) return "SKIPPED";

  try {
    // CustomerRepository.save() usa upsert por id: el mismo customer.id es la
    // clave de idempotencia. No se usa una segunda ruta paralela.
    await container.customerEngine.get().save(pending.customer);
    return "SAVED";
  } catch (error) {
    if (!isCustomerPhoneConflict(error)) throw error;
    return linkToExistingCustomer(pending);
  }
}

/**
 * PASO 3: el servidor rechazó el cliente offline con 23505 porque ya existe
 * otro con el mismo teléfono. En vez de marcar un error permanente, se busca
 * ese cliente en el servidor y se RECONECTA: el id local pasa a ser alias del
 * id existente (ver customerIdAliases.ts), de modo que las ventas y mesas en
 * cola que apuntan al id local usan al cliente existente.
 *
 * No se sobreescriben los datos del cliente existente con los capturados
 * offline: el registro del servidor es la autoridad.
 *
 * Errores:
 * - Sin red al consultar: se propaga tal cual (isNetworkFailure) y el cliente
 *   vuelve a la cola para reintentar.
 * - No se encuentra el cliente con ese teléfono (p. ej. está en otra
 *   sucursal): CUSTOMER_PHONE_CONFLICT, error de negocio con mensaje claro
 *   para revisión manual.
 */
async function linkToExistingCustomer(pending: PendingCustomerOperation): Promise<SyncOutcome> {
  const phone = pending.customer.phone;

  const existing = phone
    ? await container.customerEngine.get().findByPhone(phone, pending.customer.id)
    : null;

  if (!existing) {
    throw new Error(
      `CUSTOMER_PHONE_CONFLICT: el teléfono ${phone ?? "(vacío)"} ya está registrado en el servidor, pero no se encontró el cliente existente para vincular "${pending.customer.name}". Revísalo manualmente.`
    );
  }

  await registerCustomerIdAlias(pending.customer.id, existing.id);

  // El cliente offline nunca llegó al servidor: se retira del caché local para
  // no mostrar un duplicado en Clientes/Caja (el existente ya quedó cacheado).
  try {
    await localCustomers.delete(pending.customer.id);
    await localCustomers.save(existing);
  } catch (error) {
    logWarning("[syncPendingCustomerOperations] No se pudo actualizar el caché local tras vincular", {
      category: "offline",
      context: { error: String(error) }
    });
  }

  logWarning("Cliente offline vinculado con cliente existente por teléfono duplicado", {
    category: "offline",
    context: {
      localId: pending.customer.id,
      canonicalId: existing.id,
      businessId: pending.businessId,
      branchId: pending.branchId
    }
  });

  vimdyCore.emit("customer");
  return "LINKED";
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
    let linkedCount = 0;
    let failedCount = 0;

    try {
      if (!connectionStore.isOnline()) return;
      if (Date.now() < syncBackoffUntil) return;

      await loadCustomerIdAliases();
      await pruneCustomerIdAliases();
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
          const outcome = await syncOne(pending);
          await pendingCustomerOperationsStore.remove(pending.id);
          if (outcome === "LINKED") {
            linkedCount += 1;
          } else {
            syncedCount += 1;
          }
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

    if (linkedCount > 0) {
      toast.info(
        linkedCount === 1
          ? "1 cliente sin conexión ya existía con ese teléfono; se vinculó con el cliente existente."
          : `${linkedCount} clientes sin conexión ya existían con ese teléfono; se vincularon con los clientes existentes.`
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