import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingCustomerOperationsStore } from "./pendingCustomerOperationsStore";
import type { PendingCustomerOperation } from "./PendingCustomerOperation";

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

let syncing = false;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

/** Reproduce una única PendingCustomerOperation contra Supabase usando CustomerEngine real. */
async function syncOne(pending: PendingCustomerOperation): Promise<void> {
  await container.customerEngine.save(pending.customer);
}

/**
 * Punto de entrada principal. Segura de llamar tantas veces como se
 * quiera (ej. cada ping de connectionStore) — si ya hay una sincronización
 * en curso, o no hay nada que sincronizar, o no hay conexión real, no
 * hace nada.
 */
export async function syncPendingCustomerOperations(): Promise<void> {
  if (syncing) return;
  if (!connectionStore.isOnline()) return;

  const queue = pendingCustomerOperationsStore.syncable();
  if (queue.length === 0) return;

  syncing = true;

  let syncedCount = 0;
  let failedCount = 0;

  try {
    for (const pending of queue) {
      // Igual que en las otras tres colas: si a mitad del lote se cayó la
      // conexión otra vez, no tiene caso seguir — se deja tal cual para
      // el próximo intento.
      if (!connectionStore.isOnline()) break;

      await pendingCustomerOperationsStore.markSyncing(pending.id);

      try {
        await syncOne(pending);
        await pendingCustomerOperationsStore.remove(pending.id);
        syncedCount += 1;
      } catch (error) {
        if (isNetworkFailure(error)) {
          await pendingCustomerOperationsStore.requeue(pending.id);
          break;
        }

        // Error de NEGOCIO real (ej. dato inválido): no se reintenta sola,
        // queda marcada para revisión manual.
        const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
        await pendingCustomerOperationsStore.markFailed(pending.id, message);
        failedCount += 1;
      }
    }
  } finally {
    syncing = false;
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
}

/** Dispara una sincronización solo si de verdad hay algo que hacer. */
function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingCustomerOperationsStore.syncable().length > 0) {
    void syncPendingCustomerOperations();
  }
}

/**
 * Arranca el motor de sincronización automática: queda escuchando cambios
 * de conexión y de la cola para dispararse solo. Llamar una vez al iniciar
 * sesión (ver AuthContext.tsx).
 */
export function startOfflineCustomerSync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return; // ya está corriendo

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingCustomerOperationsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

/** Para junto con el cierre de sesión (ver AuthContext.tsx). */
export function stopOfflineCustomerSync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
}