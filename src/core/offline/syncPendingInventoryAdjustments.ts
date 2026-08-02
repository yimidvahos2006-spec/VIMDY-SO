import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingInventoryAdjustmentsStore } from "./pendingInventoryAdjustmentsStore";
import type { PendingInventoryAdjustment } from "./PendingInventoryAdjustment";
import { vimdyCore } from "../VimdyCore";

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

let syncing = false;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribeQueue: (() => void) | null = null;

/** Reproduce un único PendingInventoryAdjustment contra Supabase usando InventoryEngine real. */
async function syncOne(pending: PendingInventoryAdjustment): Promise<void> {
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

/**
 * Punto de entrada principal. Segura de llamar tantas veces como se
 * quiera (ej. cada ping de connectionStore) — si ya hay una sincronización
 * en curso, o no hay nada que sincronizar, o no hay conexión real, no
 * hace nada.
 */
export async function syncPendingInventoryAdjustments(): Promise<void> {
  if (syncing) return;
  if (!connectionStore.isOnline()) return;

  const queue = pendingInventoryAdjustmentsStore.syncable();
  if (queue.length === 0) return;

  syncing = true;

  let syncedCount = 0;
  let failedCount = 0;

  try {
    for (const pending of queue) {
      // Igual que en syncPendingSales: si a mitad del lote se cayó la
      // conexión otra vez, no tiene caso seguir — se deja tal cual para
      // el próximo intento.
      if (!connectionStore.isOnline()) break;

      await pendingInventoryAdjustmentsStore.markSyncing(pending.id);

      try {
        await syncOne(pending);
        await pendingInventoryAdjustmentsStore.remove(pending.id);
        syncedCount += 1;
      } catch (error) {
        if (isNetworkFailure(error)) {
          await pendingInventoryAdjustmentsStore.requeue(pending.id);
          break;
        }

        // Error de NEGOCIO real (producto eliminado, ya no hay stock
        // suficiente para la salida, etc.): no se reintenta sola, queda
        // marcada para revisión manual.
        const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
        await pendingInventoryAdjustmentsStore.markFailed(pending.id, message);
        failedCount += 1;
      }
    }
  } finally {
    syncing = false;
  }

  if (syncedCount > 0) {
    // El stock ya se movió de verdad en el servidor — lo único que falta
    // es que el catálogo cacheado en esta pantalla se entere del valor
    // real (reemplaza el valor optimista que había puesto
    // offlineInventory.ts al encolar).
    await productCatalogStore.refresh().catch((error) => {
      console.error("No se pudo refrescar el catálogo tras sincronizar ajustes offline:", error);
    });

    // Mismo evento que ya escuchan useInventory/InventoryDashboard para
    // recargarse solos (ver useInventory.ts) sin que nadie tenga que
    // refrescar la pantalla a mano.
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
        : `${failedCount} ajustes de inventario sin conexión no se pudieron sincronizar y quedaron para revisión manual.`
    );
  }
}

/** Dispara una sincronización solo si de verdad hay algo que hacer. */
function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingInventoryAdjustmentsStore.syncable().length > 0) {
    void syncPendingInventoryAdjustments();
  }
}

/**
 * Arranca el motor de sincronización automática: queda escuchando cambios
 * de conexión y de la cola para dispararse solo. Llamar una vez al iniciar
 * sesión (ver AuthContext.tsx).
 */
export function startOfflineInventorySync(): void {
  if (unsubscribeConnection || unsubscribeQueue) return; // ya está corriendo

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribeQueue = pendingInventoryAdjustmentsStore.subscribe(triggerIfNeeded);

  triggerIfNeeded();
}

/** Para junto con el cierre de sesión (ver AuthContext.tsx). */
export function stopOfflineInventorySync(): void {
  unsubscribeConnection?.();
  unsubscribeQueue?.();
  unsubscribeConnection = null;
  unsubscribeQueue = null;
}