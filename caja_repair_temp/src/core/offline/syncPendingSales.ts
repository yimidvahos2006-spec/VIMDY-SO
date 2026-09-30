import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingSalesStore } from "./pendingSalesStore";
import type { PendingSale } from "./PendingSale";
import type { Sale } from "../entities/Entities";
import { logError } from "../../infrastructure/logging/opsLogger";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { MAX_OFFLINE_ATTEMPTS, isBusinessError, OFFLINE_BUSINESS_ERROR_PREFIXES } from "./offlineConstants";

function formatOfflineBusinessError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  const upper = message.toUpperCase();

  if (upper.startsWith("VALIDATION_ERROR:") || upper.startsWith("INSUFFICIENT_STOCK:")) {
    const detail = message.includes(":")
      ? message.split(":").slice(1).join(":").trim()
      : message;
    return `Stock o datos inválidos: ${detail}`;
  }

  if (upper.startsWith("PRODUCT_NOT_FOUND:")) {
    return "Un producto de la venta offline ya no existe en el inventario.";
  }

  if (upper.startsWith("CONTEXT_MISMATCH:") || upper.startsWith("NO_BUSINESS_CONTEXT:")) {
    return "La venta offline corresponde a otro negocio o sucursal.";
  }

  if (upper.startsWith("ACCESS_DENIED:")) {
    return "Sin permisos para sincronizar esta venta offline.";
  }

  const prefix = OFFLINE_BUSINESS_ERROR_PREFIXES.find((p) => upper.startsWith(p));
  if (prefix) {
    const detail = message.includes(":") ? message.split(":").slice(1).join(":").trim() : message;
    return `Error de negocio: ${detail}`;
  }

  return message;
}

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

let syncPromise: Promise<void> | null = null;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribePendingSales: (() => void) | null = null;
let syncBackoffUntil = 0;

/** Reproduce una única PendingSale contra Supabase usando los engines reales. */
export async function syncOne(pending: PendingSale): Promise<Sale> {
  const currentBusinessId = getCurrentBusinessId();
  const currentBranchId = getCurrentBranchId();

  if (!currentBusinessId || !currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay sesión activa (businessId=${currentBusinessId ?? "null"}, branchId=${currentBranchId ?? "null"}). No se puede sincronizar.`
    );
  }

  if (pending.businessId !== currentBusinessId || pending.branchId !== currentBranchId) {
    throw new Error(
      `CONTEXT_MISMATCH: la venta offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  const sale = await container.salesEngine.get().createSale(pending.createSaleInput);

  if (pending.payment) {
    await container.salesEngine.get().registerPayment(sale, pending.payment.method, {
      received: pending.payment.received,
      reference: pending.payment.reference,
      mixed: pending.payment.mixed
    });
  }

  if (!pending.createSaleInput.skipKitchen) {
    const existingKitchenOrder = await container.kitchenEngine.get().getById(sale.id);
    if (!existingKitchenOrder) {
      await container.salesEngine.get().sendToKitchen(sale);
    }
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
  if (syncPromise) return syncPromise;

  syncPromise = (async () => {
    if (!connectionStore.isOnline()) return;

    if (Date.now() < syncBackoffUntil) return;

    await pendingSalesStore.recoverStuckSyncing();
    const queue = await pendingSalesStore.findSyncable();
    if (queue.length === 0) return;

    let syncedCount = 0;
    let failedCount = 0;
    let firstBusinessError: string | null = null;

    try {
      for (const pending of queue) {
        if (!connectionStore.isOnline()) break;

        if ((pending.attempts ?? 0) >= MAX_OFFLINE_ATTEMPTS) {
          await pendingSalesStore.markPermanentFailure(pending.id, "MAX_ATTEMPTS_REACHED");
          failedCount += 1;
          continue;
        }

        const started = await pendingSalesStore.markSyncing(pending.id);
        if (!started) continue;

        try {
          await syncOne(pending);
          await pendingSalesStore.remove(pending.id);
          syncedCount += 1;
        } catch (error) {
          if (isNetworkFailure(error)) {
            syncBackoffUntil = Date.now() + 5000;
            logError("Fallo de red al sincronizar venta offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                businessId: pending.businessId,
                branchId: pending.branchId,
                attempts: pending.attempts,
                error: error instanceof Error ? error.message : String(error)
              }
            });
            await pendingSalesStore.requeue(pending.id);
            break;
          }

          if (isBusinessError(error)) {
            const rawMessage = error instanceof Error ? error.message : String(error);
            logError("Error de negocio al sincronizar venta offline", {
              category: "offline",
              context: {
                pendingId: pending.id,
                businessId: pending.businessId,
                branchId: pending.branchId,
                error: rawMessage
              }
            });
            await pendingSalesStore.markPermanentFailure(pending.id, rawMessage);
            failedCount += 1;
            if (!firstBusinessError) {
              firstBusinessError = formatOfflineBusinessError(error);
            }
            continue;
          }

          const message = error instanceof Error ? error.message : "Error desconocido al sincronizar.";
          logError("Error desconocido al sincronizar venta offline", {
            category: "offline",
            context: {
              pendingId: pending.id,
              businessId: pending.businessId,
              branchId: pending.branchId,
              error: message
            }
          });
          await pendingSalesStore.markFailed(pending.id, message);
          failedCount += 1;
        }
      }
    } finally {
      syncPromise = null;
    }

    if (syncedCount > 0) {
      syncBackoffUntil = 0;
      productCatalogStore.refresh().catch((error) => {
        logError("No se pudo refrescar el catálogo tras sincronizar ventas offline", { category: "offline", context: { error: String(error) } });
      });

      vimdyCore.emit("inventory");

      toast.success(
        syncedCount === 1
          ? "1 venta sin conexión se sincronizó correctamente."
          : `${syncedCount} ventas sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      if (failedCount === 1 && firstBusinessError) {
        toast.error(firstBusinessError);
      } else if (failedCount === 1) {
        toast.error("1 venta sin conexión no se pudo sincronizar y quedó para revisión manual.");
      } else {
        toast.error(
          `${failedCount} ventas sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
        );
      }
    }
  })();

  return syncPromise;
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
  syncPromise = null;
}
