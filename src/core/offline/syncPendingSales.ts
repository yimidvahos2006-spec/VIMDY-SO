import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { isNetworkFailure } from "../services/offlineSale";
import { pendingSalesStore } from "./pendingSalesStore";
import { pendingCustomerOperationsStore } from "./pendingCustomerOperationsStore";
import { syncPendingCustomerOperations } from "./syncPendingCustomerOperations";
import {
  loadCustomerIdAliases,
  peekCanonicalCustomerId
} from "./customerIdAliases";
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

  await loadCustomerIdAliases();

  const canonicalCustomerId =
    peekCanonicalCustomerId(
      pending.createSaleInput
        .customerId
    );

  const createSaleInput =
    canonicalCustomerId !==
    pending.createSaleInput
      .customerId
      ? {
          ...pending.createSaleInput,
          customerId:
            canonicalCustomerId
        }
      : pending.createSaleInput;

  let sale: Sale;
  try {
    sale = await container.salesEngine
      .get()
      .createSale(
        createSaleInput
      );
  } catch (error: any) {
    const errCode = error?.code || error?.status;
    const errMsg = error?.message || String(error);

    // BLINDAJE DE IDEMPOTENCIA:
    // Si Supabase rechaza por llave única duplicada (código 23505),
    // la venta ya se había registrado y recuperamos el objeto de forma segura.
    if (
      errCode === '23505' ||
      errMsg.includes('23505') ||
      errMsg.toLowerCase().includes('unique constraint') ||
      errMsg.toLowerCase().includes('duplicate key')
    ) {
      sale = {
        id: createSaleInput.id,
        businessId: currentBusinessId,
        branchId: currentBranchId,
        total: (createSaleInput as any).total ?? 0,
        items: (createSaleInput as any).items ?? [],
        createdAt: (createSaleInput as any).createdAt || new Date().toISOString()
      } as unknown as Sale;
    } else {
      throw error;
    }
  }

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
            pending.payment.cashRegisterId,

          cashierName:
            pending.cashierName
        }
      );
  }

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

let unsubscribePendingCustomers:
  (() => void) | null = null;

let syncBackoffUntil = 0;

function isWaitingForCustomer(
  pending: PendingSale
): boolean {
  const customerId =
    pending.createSaleInput
      .customerId;

  if (!customerId) {
    return false;
  }

  if (
    peekCanonicalCustomerId(
      customerId
    ) !== customerId
  ) {
    return false;
  }

  return pendingCustomerOperationsStore
    .list()
    .some(
      (op) =>
        op.id === customerId &&
        (op.status ===
          "PENDING_SYNC" ||
          op.status ===
            "SYNCING")
    );
}

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

      try {
        await syncPendingCustomerOperations();
      } catch (error) {
        logError(
          "Fallo inesperado sincronizando clientes antes de las ventas",
          {
            category: "offline",
            context: { error: String(error) }
          }
        );
      }

      await loadCustomerIdAliases();

      if (
        !connectionStore.isOnline()
      ) {
        return;
      }

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
        for (
          const pending of queue
        ) {
          if (
            !connectionStore.isOnline()
          ) {
            break;
          }

          if (
            isWaitingForCustomer(
              pending
            )
          ) {
            continue;
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

            await pendingSalesStore
              .remove(
                pending.id
              );

            syncedCount +=
              1;
          } catch (error) {
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

              break;
            }

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
        syncPromise =
          null;
      }

      if (
        syncedCount > 0
      ) {
        syncBackoffUntil =
          0;

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
    })().finally(() => {
      syncPromise = null;
    });

  return syncPromise;
}

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

export function startOfflineSalesSync(): void {
  if (
    unsubscribeConnection ||
    unsubscribePendingSales ||
    unsubscribePendingCustomers
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

  unsubscribePendingCustomers =
    pendingCustomerOperationsStore.subscribe(
      triggerIfNeeded
    );

  triggerIfNeeded();
}

export function stopOfflineSalesSync(): void {
  unsubscribeConnection?.();
  unsubscribePendingSales?.();
  unsubscribePendingCustomers?.();

  unsubscribeConnection =
    null;

  unsubscribePendingSales =
    null;

  unsubscribePendingCustomers =
    null;

  syncPromise =
    null;
}