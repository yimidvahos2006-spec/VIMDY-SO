import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingSalesStore } from "./pendingSalesStore";
import type { PendingSale } from "./PendingSale";
import type { Sale } from "../entities/Entities";

/**
 * syncPendingSales.ts
 * ---------------------------------------------------------------------------
 * Parte 4 del plan de ventas offline: recorre la cola de la Parte 2
 * (pendingSalesStore) y reproduce cada venta contra Supabase usando los
 * MISMOS engines reales que usa el cobro online (SalesEngine.createSale /
 * registerPayment) — nunca un camino paralelo. Todo lo que ya pasa
 * automáticamente en una venta online (descuento de inventario real,
 * comanda en Cocina, ingreso a caja, puntos de fidelización, auditoría,
 * eventos del bus vimdyCore que refrescan el Dashboard) pasa exactamente
 * igual aquí, porque se llama a las mismas funciones.
 *
 * Se apoya por completo en la idempotencia por id (checklist crítico #4):
 * sin importar en qué punto exacto se había quedado cada venta offline
 * (sin crear todavía, creada pero sin cobrar, cobrada pero la respuesta
 * nunca llegó al navegador), reproducir la "receta" completa desde cero
 * —createSale() y, si aplica, registerPayment()— es siempre seguro.
 *
 * Arranca/para junto con la sesión del negocio (ver start()/stop(), y su
 * conexión en AuthContext.tsx junto a startRealtimeSync/stopRealtimeSync),
 * no apenas se importa el módulo: la cola es una cosa del negocio activo,
 * igual que el resto de datos en pantalla.
 */

let syncing = false;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribePendingSales: (() => void) | null = null;

/** Reproduce una única PendingSale contra Supabase usando los engines reales. */
async function syncOne(pending: PendingSale): Promise<Sale> {
  const sale = await container.salesEngine.createSale(pending.createSaleInput);

  if (pending.payment) {
    await container.salesEngine.registerPayment(sale, pending.payment.method, {
      received: pending.payment.received,
      reference: pending.payment.reference,
      mixed: pending.payment.mixed
    });
  }

  return sale;
}

/**
 * Punto de entrada principal. Segura de llamar tantas veces como se
 * quiera (ej. cada ping de connectionStore) — si ya hay una sincronización
 * en curso, o no hay nada que sincronizar, o no hay conexión real, no
 * hace nada.
 */
export async function syncPendingSales(): Promise<void> {
  if (syncing) return;
  if (!connectionStore.isOnline()) return;

  const queue = pendingSalesStore.syncable();
  if (queue.length === 0) return;

  syncing = true;

  let syncedCount = 0;
  let failedCount = 0;

  try {
    for (const pending of queue) {
      // Si a mitad del lote se volvió a caer la conexión, no tiene caso
      // seguir intentando las que faltan: se dejan tal cual (siguen
      // PENDING_SYNC, ver requeue más abajo para la que se estaba
      // procesando) para el próximo intento, sin generar una ráfaga de
      // errores de red que en realidad no son culpa de esas ventas.
      if (!connectionStore.isOnline()) break;

      await pendingSalesStore.markSyncing(pending.id);

      try {
        await syncOne(pending);
        await pendingSalesStore.remove(pending.id);
        syncedCount += 1;
      } catch (error) {
        if (isNetworkFailure(error)) {
          await pendingSalesStore.requeue(pending.id);
          break;
        }

        // Error de NEGOCIO real (sin stock, producto eliminado, turno con
        // conflicto, etc.) — ver Parte 6: no se reintenta sola, queda
        // marcada para revisión manual (pendingSalesStore.requeue() la
        // puede reintentar a mano una vez resuelto el problema de fondo).
        const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
        await pendingSalesStore.markFailed(pending.id, message);
        failedCount += 1;
      }
    }
  } finally {
    syncing = false;
  }

  if (syncedCount > 0) {
    // El stock y la caja ya se movieron de verdad (mismos engines que el
    // cobro online, con sus mismos eventos del bus vimdyCore) — lo único
    // que falta es que el catálogo cacheado en esta pantalla se entere
    // del stock nuevo.
    productCatalogStore.refresh().catch((error) => {
      console.error("No se pudo refrescar el catálogo tras sincronizar ventas offline:", error);
    });

    toast.success(
      syncedCount === 1
        ? "1 venta sin conexión se sincronizó correctamente."
        : `${syncedCount} ventas sin conexión se sincronizaron correctamente.`
    );
  }

  if (failedCount > 0) {
    toast.error(
      failedCount === 1
        ? "1 venta sin conexión no se pudo sincronizar y quedó para revisión manual."
        : `${failedCount} ventas sin conexión no se pudieron sincronizar y quedaron para revisión manual.`
    );
  }
}

/** Dispara una sincronización solo si de verdad hay algo que hacer. */
function triggerIfNeeded(): void {
  if (connectionStore.isOnline() && pendingSalesStore.syncable().length > 0) {
    void syncPendingSales();
  }
}

/**
 * Arranca el motor de sincronización automática: queda escuchando cambios
 * de conexión (Parte 1) y de la cola (Parte 2) para dispararse solo, sin
 * que ninguna pantalla tenga que acordarse de llamarlo. Llamar una vez al
 * iniciar sesión (ver AuthContext.tsx).
 */
export function startOfflineSalesSync(): void {
  if (unsubscribeConnection || unsubscribePendingSales) return; // ya está corriendo

  unsubscribeConnection = connectionStore.subscribe(triggerIfNeeded);
  unsubscribePendingSales = pendingSalesStore.subscribe(triggerIfNeeded);

  // Por si ya había ventas pendientes de una sesión anterior y se llega
  // a iniciar sesión con internet desde el primer momento.
  triggerIfNeeded();
}

/** Para junto con el cierre de sesión (ver AuthContext.tsx). */
export function stopOfflineSalesSync(): void {
  unsubscribeConnection?.();
  unsubscribePendingSales?.();
  unsubscribeConnection = null;
  unsubscribePendingSales = null;
}