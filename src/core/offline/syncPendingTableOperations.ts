import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingTableOperationsStore } from "./pendingTableOperationsStore";
import type { PendingTableOperation } from "./PendingTableOperation";

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

let syncing = false;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

/** Reproduce una única PendingTableOperation contra Supabase usando TableEngine real. */
async function syncOne(pending: PendingTableOperation): Promise<void> {
  if (pending.type === "OPEN") {
    if (!pending.openInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta openInput.");
    }
    await container.tableEngine.openTable(pending.openInput);
  } else {
    if (!pending.closeInput) {
      throw new Error("PENDING_TABLE_OPERATION_MISSING_INPUT: falta closeInput.");
    }
    await container.tableEngine.closeTable(pending.closeInput);
  }
}

/**
 * Punto de entrada principal. Segura de llamar tantas veces como se
 * quiera (ej. cada ping de connectionStore) — si ya hay una sincronización
 * en curso, o no hay nada que sincronizar, o no hay conexión real, no
 * hace nada.
 */
export async function syncPendingTableOperations(): Promise<void> {
  if (syncing) return;
  if (!connectionStore.isOnline()) return;

  const queue = pendingTableOperationsStore.syncable();
  if (queue.length === 0) return;

  syncing = true;

  let syncedCount = 0;
  let failedCount = 0;

  try {
    for (const pending of queue) {
      // Igual que en las otras dos colas: si a mitad del lote se cayó la
      // conexión otra vez, no tiene caso seguir — se deja tal cual para
      // el próximo intento.
      if (!connectionStore.isOnline()) break;

      // Respeta el orden: si una mesa tiene una apertura Y un cierre
      // encolados (se abrió y se cerró offline en la misma sesión sin
      // señal), `queue` ya viene en el mismo orden en que se encolaron
      // (ver findAll() de IndexedDbRepository), así que se sincronizan
      // en ese mismo orden.
      await pendingTableOperationsStore.markSyncing(pending.id);

      try {
        await syncOne(pending);
        await pendingTableOperationsStore.remove(pending.id);
        syncedCount += 1;
      } catch (error) {
        if (isNetworkFailure(error)) {
          await pendingTableOperationsStore.requeue(pending.id);
          break;
        }

        // Error de NEGOCIO real (la mesa ya no estaba disponible para
        // abrir, ya no tiene productos para cobrar, choque de edición,
        // etc.): no se reintenta sola, queda marcada para revisión
        // manual (ej. el mesero/cajero puede reabrir o recobrar la mesa
        // a mano una vez resuelto el problema de fondo).
        const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
        await pendingTableOperationsStore.markFailed(pending.id, message);
        failedCount += 1;
      }
    }
  } finally {
    syncing = false;
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
}

/** Dispara una sincronización solo si de verdad hay algo que hacer. */
function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingTableOperationsStore.syncable().length > 0) {
    void syncPendingTableOperations();
  }
}

/**
 * Arranca el motor de sincronización automática: queda escuchando cambios
 * de conexión y de la cola para dispararse solo. Llamar una vez al iniciar
 * sesión (ver AuthContext.tsx).
 */
export function startOfflineTableSync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return; // ya está corriendo

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingTableOperationsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

/** Para junto con el cierre de sesión (ver AuthContext.tsx). */
export function stopOfflineTableSync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
}