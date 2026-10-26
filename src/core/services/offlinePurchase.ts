import type { PurchaseOrderItem } from "../entities/Entities";
import type { PurchaseReceiptResult } from "../engines/PurchaseOrderEngine";
import { connectionStore } from "../store/connectionStore";
import { pendingPurchasesStore } from "../offline/pendingPurchasesStore";
import {
  PendingPurchaseKind,
  buildPurchaseFingerprint
} from "../offline/PendingPurchase";
import {
  executePendingPurchase,
  isPermanentPurchaseError
} from "../offline/syncPendingPurchases";
import { isNetworkFailure } from "./offlineSale";

/**
 * offlinePurchase.ts
 * ---------------------------------------------------------------------------
 * Punto único de entrada para REGISTRAR una compra (directa o recepción de una
 * orden). Equivalente de offlineSale.ts / offlineInventory.ts para Compras.
 *
 * Patrón "outbox": la compra se guarda PRIMERO en la cola persistente
 * (IndexedDB) con su clave de idempotencia (`id` = p_operation_id del
 * servidor) y solo después se intenta enviar. Así, si no hay internet, o la
 * respuesta se pierde, o el navegador se cierra a mitad de la llamada, la
 * compra no se pierde y el reintento usa EXACTAMENTE el mismo id: el servidor
 * responde "idempotent" y no suma el stock dos veces.
 *
 * Resultados (SubmitPurchaseOutcome):
 *   - COMPLETED      : el servidor la confirmó ahora mismo.
 *   - QUEUED         : quedó guardada y se sincronizará sola (sin internet, o
 *                      error de red al enviar).
 *   - ALREADY_QUEUED : la misma compra ya estaba en cola o en envío (doble
 *                      clic, o se registró otra vez): no se duplica.
 *
 * Los rechazos de negocio (factura repetida, sin permiso, orden cerrada…) NO
 * se encolan: la compra se descarta de la cola y el error se relanza para que
 * la pantalla lo muestre.
 */

export interface SubmitPurchaseInput {
  readonly kind: PendingPurchaseKind;
  readonly items: readonly PurchaseOrderItem[];
  /** Solo DIRECT. */
  readonly supplierId?: string;
  readonly invoiceNumber?: string;
  /** Solo RECEIPT. */
  readonly purchaseOrderId?: string;
  readonly note?: string;
  readonly performedBy?: string;
}

export type SubmitPurchaseOutcome =
  | {
      readonly status: "COMPLETED";
      readonly pendingId: string;
      readonly result: PurchaseReceiptResult;
    }
  | {
      readonly status: "QUEUED";
      readonly pendingId: string;
      readonly reason: "OFFLINE" | "NETWORK_ERROR";
    }
  | {
      readonly status: "ALREADY_QUEUED";
      readonly pendingId: string;
    };

/**
 * Compras que se están registrando ahora mismo en ESTA pestaña, por huella.
 * Se consulta de forma síncrona (antes de cualquier await) para que un doble
 * clic no pase dos veces por la lectura de IndexedDB antes de que la primera
 * llamada alcance a guardar.
 */
const inFlight = new Map<string, Promise<string>>();

function buildSummary(kind: PendingPurchaseKind, itemCount: number): string {
  const label = kind === "DIRECT" ? "Compra directa" : "Recepción de orden";
  return `${label} · ${itemCount} ${itemCount === 1 ? "producto" : "productos"}`;
}

function validate(input: SubmitPurchaseInput): void {
  if (!input.items || input.items.length === 0) {
    throw new Error("ITEMS_REQUIRED");
  }
  if (input.kind === "DIRECT" && !input.supplierId) {
    throw new Error("SUPPLIER_REQUIRED");
  }
  if (input.kind === "RECEIPT" && !input.purchaseOrderId) {
    throw new Error("PURCHASE_ORDER_NOT_FOUND");
  }
}

export async function submitPurchase(input: SubmitPurchaseInput): Promise<SubmitPurchaseOutcome> {
  validate(input);

  const fingerprint = buildPurchaseFingerprint(input);

  const running = inFlight.get(fingerprint);
  if (running) {
    return { status: "ALREADY_QUEUED", pendingId: await running };
  }

  let resolveId!: (id: string) => void;
  inFlight.set(
    fingerprint,
    new Promise<string>((resolve) => {
      resolveId = resolve;
    })
  );

  let pendingId = "";

  try {
    const reusable = await pendingPurchasesStore.findReusable(fingerprint);

    // La misma compra ya espera turno (o se está enviando): el ciclo de
    // sincronización la enviará con su id. Solo una FAILED se reintenta ya.
    if (reusable && reusable.status !== "FAILED") {
      pendingId = reusable.id;
      resolveId(pendingId);
      return { status: "ALREADY_QUEUED", pendingId };
    }

    pendingId = reusable?.id ?? crypto.randomUUID();
    resolveId(pendingId);

    const online = connectionStore.isOnline();

    const pending = await pendingPurchasesStore.enqueue({
      id: pendingId,
      kind: input.kind,
      items: input.items,
      supplierId: input.supplierId,
      invoiceNumber: input.invoiceNumber,
      purchaseOrderId: input.purchaseOrderId,
      note: input.note,
      performedBy: input.performedBy,
      summary: buildSummary(input.kind, input.items.length),
      // Si hay internet la envía quien la registra ahora; marcarla SYNCING
      // evita que el ciclo automático la envíe al mismo tiempo.
      startSyncing: online
    });

    if (!online) {
      return { status: "QUEUED", pendingId, reason: "OFFLINE" };
    }

    try {
      const result = await executePendingPurchase(pending);
      await pendingPurchasesStore.remove(pendingId);
      return { status: "COMPLETED", pendingId, result };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      // Rechazo de negocio: repetirlo daría el mismo error. Se descarta de la
      // cola y se muestra a la persona.
      if (isPermanentPurchaseError(error)) {
        await pendingPurchasesStore.remove(pendingId);
        throw error;
      }

      // Red caída o respuesta perdida: la compra y su id se conservan.
      if (isNetworkFailure(error)) {
        await pendingPurchasesStore.requeue(pendingId, message);
        return { status: "QUEUED", pendingId, reason: "NETWORK_ERROR" };
      }

      await pendingPurchasesStore.markFailed(pendingId, message);
      throw error;
    }
  } finally {
    resolveId(pendingId);
    inFlight.delete(fingerprint);
  }
}