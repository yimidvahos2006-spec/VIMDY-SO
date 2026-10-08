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
import {
  getCurrentBusinessId,
  getCurrentBranchId
} from "../../infrastructure/supabase/supabaseClient";
import {
  MAX_OFFLINE_ATTEMPTS,
  isBusinessError,
  OFFLINE_BUSINESS_ERROR_PREFIXES
} from "./offlineConstants";

/**
 * Convierte un error de negocio de sincronización en un mensaje útil
 * para el cajero.
 */
function formatOfflineBusinessError(
  error: unknown
): string {
  const message =
    error instanceof Error
      ? error.message
      : String(error);

  const upper =
    message.toUpperCase();

  if (
    upper.startsWith(
      "VALIDATION_ERROR:"
    ) ||
    upper.startsWith(
      "INSUFFICIENT_STOCK:"
    )
  ) {
    const detail =
      message.includes(":")
        ? message
            .split(":")
            .slice(1)
            .join(":")
            .trim()
        : message;

    return `Stock o datos inválidos: ${detail}`;
  }

  if (
    upper.startsWith(
      "PRODUCT_NOT_FOUND:"
    )
  ) {
    return "Un producto de la venta offline ya no existe en el inventario.";
  }

  if (
    upper.startsWith(
      "CONTEXT_MISMATCH:"
    ) ||
    upper.startsWith(
      "NO_BUSINESS_CONTEXT:"
    )
  ) {
    return "La venta offline corresponde a otro negocio o sucursal.";
  }

  if (
    upper.startsWith(
      "ACCESS_DENIED:"
    )
  ) {
    return "Sin permisos para sincronizar esta venta offline.";
  }

  const prefix =
    OFFLINE_BUSINESS_ERROR_PREFIXES.find(
      (value) =>
        upper.startsWith(
          value
        )
    );

  if (prefix) {
    const detail =
      message.includes(":")
        ? message
            .split(":")
            .slice(1)
            .join(":")
            .trim()
        : message;

    return `Error de negocio: ${detail}`;
  }

  return message;
}

/**
 * Reproduce una única operación offline contra el backend.
 *
 * El principio de diseño es importante:
 *
 * OFFLINE:
 *   IndexedDB
 *      ↓
 *   PendingSale
 *
 * ONLINE:
 *   SalesEngine.createSale()
 *      ↓
 *   SalesEngine.registerPayment()
 *
 * No existe una segunda implementación de creación de venta.
 *
 * La cola solamente conserva la intención hasta que el flujo real pueda
 * ejecutarse.
 */
export async function syncOne(
  pending: PendingSale
): Promise<Sale> {
  const currentBusinessId =
    getCurrentBusinessId();

  const currentBranchId =
    getCurrentBranchId();

  if (
    !currentBusinessId ||
    !currentBranchId
  ) {
    throw new Error(
      `CONTEXT_MISMATCH: no hay sesión activa (businessId=${currentBusinessId ?? "null"}, branchId=${currentBranchId ?? "null"}). No se puede sincronizar.`
    );
  }

  if (
    pending.businessId !==
      currentBusinessId ||
    pending.branchId !==
      currentBranchId
  ) {
    throw new Error(
      `CONTEXT_MISMATCH: la venta offline pertenece a ${pending.businessId}/${pending.branchId}, pero la sesión actual es ${currentBusinessId}/${currentBranchId}.`
    );
  }

  if (
    !pending.createSaleInput.id
  ) {
    throw new Error(
      "PENDING_SALE_REQUIRES_ID: la venta offline no tiene un identificador idempotente."
    );
  }

  /*
   * IMPORTANTE:
   *
   * createSale() es el mismo método que utiliza el flujo online.
   *
   * Si la operación ya alcanzó a crear la venta antes de una caída de red,
   * la implementación idempotente del SalesEngine debe devolver la venta
   * existente en vez de volver a descontar inventario.
   */
  const sale =
    await container.salesEngine
      .get()
      .createSale(
        pending.createSaleInput
      );

  /*
   * Si existía un cobro offline, se reproduce exactamente el mismo pago.
   *
   * registerPayment() es el punto donde se debe garantizar la idempotencia
   * financiera para impedir movimientos duplicados de caja.
   */
  if (
    pending.payment
  ) {
    await container.salesEngine
      .get()
      .registerPayment(
        sale,
        pending.payment.method,
        {
          received:
            pending.payment.received,

          reference:
            pending.payment.reference,

          mixed:
            pending.payment.mixed,

          shiftId:
            pending.payment.shiftId,

          cashRegisterId:
            pending.payment.cashRegisterId
        }
      );
  }

  /*
   * createSale() normalmente se encarga del flujo de cocina.
   *
   * Esta comprobación defensiva evita crear una segunda comanda si la venta
   * ya produjo una orden de cocina.
   */
  if (
    !pending.createSaleInput
      .skipKitchen
  ) {
    const existingKitchenOrder =
      await container.kitchenEngine
        .get()
        .getById(
          sale.id
        );

    if (
      !existingKitchenOrder
    ) {
      await container.salesEngine
        .get()
        .sendToKitchen(
          sale
        );
    }
  }

  return sale;
}

let syncPromise:
  Promise<void> | null = null;

let unsubscribeConnection:
  (() => void) | null = null;

let unsubscribePendingSales:
  (() => void) | null = null;

let syncBackoffUntil = 0;

/**
 * Procesa la cola secuencialmente.
 *
 * Solo existe una ejecución simultánea. Si otro evento intenta iniciar
 * sincronización mientras ya existe una, reutiliza la misma Promise.
 */
export async function syncPendingSales(): Promise<void> {
  if (
    syncPromise
  ) {
    return syncPromise;
  }

  syncPromise =
    (async () => {
      if (
        !connectionStore.isOnline()
      ) {
        return;
      }

      if (
        Date.now() <
        syncBackoffUntil
      ) {
        return;
      }

      /*
       * Una operación que quedó SYNCING por un cierre inesperado no debe
       * permanecer bloqueada para siempre.
       */
      await pendingSalesStore
        .recoverStuckSyncing();

      const queue =
        await pendingSalesStore
          .findSyncable();

      if (
        queue.length === 0
      ) {
        return;
      }

      let syncedCount = 0;
      let failedCount = 0;
      let firstBusinessError:
        string | null = null;

      try {
        /*
         * SECUENCIAL A PROPÓSITO.
         *
         * No utilizamos Promise.all().
         *
         * Esto reduce el riesgo de que múltiples ventas offline intenten
         * modificar simultáneamente inventario/caja cuando el objetivo de
         * este bloque es conservar el orden de la cola.
         */
        for (
          const pending of queue
        ) {
          if (
            !connectionStore.isOnline()
          ) {
            break;
          }

          if (
            (pending.attempts ?? 0) >=
            MAX_OFFLINE_ATTEMPTS
          ) {
            await pendingSalesStore
              .markPermanentFailure(
                pending.id,
                "MAX_ATTEMPTS_REACHED"
              );

            failedCount +=
              1;

            continue;
          }

          const started =
            await pendingSalesStore
              .markSyncing(
                pending.id
              );

          if (!started) {
            continue;
          }

          try {
            await syncOne(
              pending
            );

            /*
             * Elimina la operación local SOLO después de que el flujo
             * remoto haya finalizado correctamente.
             */
            await pendingSalesStore
              .remove(
                pending.id
              );

            syncedCount +=
              1;
          } catch (error) {
            /*
             * Una caída de red significa que no podemos conocer con
             * seguridad si la respuesta remota llegó.
             *
             * Por eso NO se elimina la operación.
             *
             * Se devuelve a PENDING_SYNC con el mismo id para que el
             * siguiente intento pueda beneficiarse de la idempotencia.
             */
            if (
              isNetworkFailure(
                error
              )
            ) {
              syncBackoffUntil =
                Date.now() +
                5000;

              logError(
                "Fallo de red al sincronizar venta offline",
                {
                  category:
                    "offline",

                  context: {
                    pendingId:
                      pending.id,

                    businessId:
                      pending.businessId,

                    branchId:
                      pending.branchId,

                    attempts:
                      pending.attempts,

                    error:
                      error instanceof Error
                        ? error.message
                        : String(
                            error
                          )
                  }
                }
              );

              await pendingSalesStore
                .requeue(
                  pending.id
                );

              /*
               * No tiene sentido continuar golpeando el backend si ya
               * perdimos la conexión.
               */
              break;
            }

            /*
             * Los errores de negocio se conservan como permanentes.
             * Continuamos con la siguiente venta porque una venta inválida
             * no debe bloquear todas las operaciones posteriores.
             */
            if (
              isBusinessError(
                error
              )
            ) {
              const rawMessage =
                error instanceof Error
                  ? error.message
                  : String(
                      error
                    );

              logError(
                "Error de negocio al sincronizar venta offline",
                {
                  category:
                    "offline",

                  context: {
                    pendingId:
                      pending.id,

                    businessId:
                      pending.businessId,

                    branchId:
                      pending.branchId,

                    error:
                      rawMessage
                  }
                }
              );

              await pendingSalesStore
                .markPermanentFailure(
                  pending.id,
                  rawMessage
                );

              failedCount +=
                1;

              if (
                !firstBusinessError
              ) {
                firstBusinessError =
                  formatOfflineBusinessError(
                    error
                  );
              }

              continue;
            }

            /*
             * Error desconocido:
             * se conserva el registro y se saca del ciclo automático.
             */
            const message =
              error instanceof Error
                ? error.message
                : "Error desconocido al sincronizar.";

            logError(
              "Error desconocido al sincronizar venta offline",
              {
                category:
                  "offline",

                context: {
                  pendingId:
                    pending.id,

                  businessId:
                    pending.businessId,

                  branchId:
                    pending.branchId,

                  error:
                    message
                }
              }
            );

            await pendingSalesStore
              .markFailed(
                pending.id,
                message
              );

            failedCount +=
              1;
          }
        }
      } finally {
        /*
         * Siempre liberamos el lock global de sincronización.
         */
        syncPromise =
          null;
      }

      if (
        syncedCount > 0
      ) {
        syncBackoffUntil =
          0;

        /*
         * El backend es la autoridad del stock.
         * Una vez sincronizadas las ventas, refrescamos el catálogo.
         */
        productCatalogStore
          .refresh()
          .catch(
            (error) => {
              logError(
                "No se pudo refrescar el catálogo tras sincronizar ventas offline",
                {
                  category:
                    "offline",

                  context: {
                    error:
                      String(
                        error
                      )
                  }
                }
              );
            }
          );

        vimdyCore.emit(
          "inventory"
        );

        toast.success(
          syncedCount === 1
            ? "1 venta sin conexión se sincronizó correctamente."
            : `${syncedCount} ventas sin conexión se sincronizaron correctamente.`
        );
      }

      if (
        failedCount > 0
      ) {
        if (
          failedCount === 1 &&
          firstBusinessError
        ) {
          toast.error(
            firstBusinessError
          );
        } else if (
          failedCount === 1
        ) {
          toast.error(
            "1 venta sin conexión no se pudo sincronizar y quedó para revisión manual."
          );
        } else {
          toast.error(
            `${failedCount} ventas sin conexión no pudieron sincronizarse y quedaron para revisión manual.`
          );
        }
      }
    })();

  return syncPromise;
}

/**
 * Inicia una sincronización únicamente cuando:
 *
 * - hay conexión;
 * - existen ventas PENDING_SYNC.
 */
function triggerIfNeeded(): void {
  if (
    connectionStore.isOnline() &&
    pendingSalesStore
      .syncable()
      .length > 0
  ) {
    void syncPendingSales();
  }
}

/**
 * Activa la sincronización automática.
 *
 * Se suscribe a:
 * - cambios de conexión;
 * - cambios de la cola local.
 */
export function startOfflineSalesSync(): void {
  if (
    unsubscribeConnection ||
    unsubscribePendingSales
  ) {
    return;
  }

  unsubscribeConnection =
    connectionStore.subscribe(
      triggerIfNeeded
    );

  unsubscribePendingSales =
    pendingSalesStore.subscribe(
      triggerIfNeeded
    );

  /*
   * También intenta sincronizar inmediatamente por si la sesión empezó
   * teniendo internet y ya había ventas pendientes.
   */
  triggerIfNeeded();
}

/**
 * Detiene la sincronización automática.
 *
 * Debe utilizarse al cerrar sesión o cambiar de contexto de negocio.
 */
export function stopOfflineSalesSync(): void {
  unsubscribeConnection?.();
  unsubscribePendingSales?.();

  unsubscribeConnection =
    null;

  unsubscribePendingSales =
    null;

  syncPromise =
    null;
}