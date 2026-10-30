// src/hooks/usePurchaseOrders.ts
import { useCallback, useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { IsoDateString, PurchaseOrder, PurchaseOrderItem } from "../core/entities/Entities";
import { vimdyCore } from "../core/VimdyCore";
import { useVimdyEvent } from "./useVimdyCore";
import { userSessionStore } from "../core/store/userSessionStore";
import { toast } from "../core/store/toastStore";
import { remainingQuantity } from "../core/engines/PurchaseOrderEngine";
import { submitPurchase, SubmitPurchaseOutcome } from "../core/services/offlinePurchase";

/**
 * usePurchaseOrders — VIMDY FASE 5, PASO 2.7 (Compras Inteligentes — ejecución)
 * ---------------------------------------------------------------------------
 * Capa de React sobre PurchaseOrderEngine: crea órdenes, las marca como
 * compradas (lo que de verdad descarga a InventoryEngine), las pospone o
 * las cancela. Nunca reimplementa nada — todo el trabajo real vive en el
 * engine, esto solo lo conecta a la pantalla y traduce errores/resultados
 * a mensajes que el dueño entiende (toasts + "Gerente Inteligente").
 *
 * Regla "toda compra debe actualizar automáticamente el inventario": al
 * recibir (markAsPurchased), el engine ya llamó a
 * InventoryEngine.increaseStock() por cada item — aquí solo emitimos el
 * evento "inventory" para que el resto de la app (Inventario, Compras
 * Inteligentes PASO 2.6, Dashboard) se refresque sola, sin recargar nada.
 *
 * COLA OFFLINE DEDICADA: registrar una compra (directa o recepción) pasa por
 * offlinePurchase.submitPurchase(). La compra se guarda primero en IndexedDB
 * con su clave de idempotencia; si no hay internet, o la respuesta se pierde,
 * queda en cola y se sincroniza sola con el MISMO id (no duplica stock aunque
 * se reinicie el navegador). Ver core/offline/PendingPurchase.ts.
 */

export interface UsePurchaseOrdersResult {
  orders: PurchaseOrder[];
  /** Órdenes abiertas: PENDIENTE, PARCIAL o POSPUESTO — lo que hay que gestionar hoy. */
  openOrders: PurchaseOrder[];
  /** Historial: COMPRADO o CANCELADO — nunca se borra nada. */
  history: PurchaseOrder[];
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;

  createOrder: (input: {
    items: PurchaseOrderItem[];
    supplierId: string;
    expectedDeliveryDate?: Date;
  }) => Promise<PurchaseOrder | null>;

  /**
   * Marca como comprado y actualiza inventario. Devuelve los mensajes del Gerente Inteligente.
   * `expiryByProduct` (productId -> YYYY-MM-DD) agrega el vencimiento del lote que llegó a
   * cada línea recibida; los productos sin fecha entran igual que siempre.
   */
  markAsPurchased: (
    orderId: string,
    receivedNow?: PurchaseOrderItem[],
    expiryByProduct?: Readonly<Record<string, IsoDateString>>
  ) => Promise<string[] | null>;

  /**
   * Flujo B: registra una compra directa (factura / nota de entrega sin orden
   * previa). Usa el mismo motor del servidor que markAsPurchased.
   */
  recordDirectPurchase: (input: {
    supplierId: string;
    items: PurchaseOrderItem[];
    invoiceNumber?: string;
    note?: string;
  }) => Promise<string[] | null>;

  postponeOrder: (orderId: string, newExpectedDate: Date, note?: string) => Promise<boolean>;
  cancelOrder: (orderId: string, note?: string) => Promise<boolean>;
}

function friendlyError(message: string): string {
  if (message.includes("INVALID_EXPIRES_AT")) {
    return "La fecha de vencimiento no es válida. Revísala e intenta de nuevo.";
  }
  if (message.startsWith("DUPLICATE_PURCHASE")) {
    return message.replace("DUPLICATE_PURCHASE: ", "");
  }
  if (message.startsWith("INVALID_ITEM")) {
    return message.replace("INVALID_ITEM: ", "");
  }
  if (message.includes("PURCHASE_RECEIVED_EXCEEDS_ORDERED")) {
    return "Esa cantidad es mayor a lo que falta por recibir de esta orden.";
  }
  if (message.includes("PURCHASE_ITEM_NOT_IN_ORDER")) {
    return "Uno de los productos no pertenece a esta orden.";
  }
  if (message.includes("PURCHASE_ITEMS_INVALID") || message.includes("PURCHASE_ITEM_INVALID")) {
    return "Indica una cantidad válida mayor a 0 para recibir.";
  }
  if (message.includes("PURCHASE_RECEIVE_FORBIDDEN") || message.includes("PURCHASE_BRANCH_FORBIDDEN")) {
    return "No tienes permiso para recibir compras en este negocio o sucursal.";
  }
  if (message.includes("PURCHASE_SUBSCRIPTION_INACTIVE")) {
    return "Tu suscripción no está activa. Renuévala para registrar compras.";
  }
  if (message.includes("PURCHASE_ORDER_UPDATE_CONFLICT")) {
    return "Otra persona modificó esta orden al mismo tiempo. Recarga e intenta de nuevo.";
  }
  if (message.includes("PURCHASE_RECEIVE_UNAVAILABLE")) {
    return "Esta versión no puede recibir compras. Recarga la página.";
  }
  if (message.includes("PURCHASE_INVOICE_DUPLICATED")) {
    return "Esa factura de este proveedor ya fue registrada. Revisa el historial para no duplicar el inventario.";
  }
  if (message.includes("PURCHASE_UNIT_PRICE_REQUIRED")) {
    return "Escribe el precio unitario de cada producto (mayor a 0), tal como aparece en la factura.";
  }
  if (message.includes("PURCHASE_ITEM_DUPLICATED")) {
    return "Un producto está repetido en la lista. Déjalo en una sola línea con la cantidad total.";
  }
  if (message.includes("PURCHASE_SUPPLIER_NOT_FOUND") || message.includes("PURCHASE_SUPPLIER_REQUIRED")) {
    return "Elige un proveedor válido de tu lista.";
  }
  if (message.includes("PURCHASE_PRODUCT_NOT_IN_BUSINESS") || message.includes("PURCHASE_BRANCH_MISMATCH")) {
    return "Uno de los productos no pertenece a esta sucursal. Actualiza la lista e intenta de nuevo.";
  }
  if (message.includes("NO_BUSINESS_CONTEXT") || message.includes("PURCHASE_SCOPE_REQUIRED")) {
    return "No hay una empresa o sucursal activa. Recarga la página.";
  }
  if (message.includes("PURCHASE_RECORD_UNAVAILABLE")) {
    return "Esta versión no puede registrar compras directas. Recarga la página.";
  }
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Necesitas internet para registrar una compra. El inventario no se modificó.";
  }
  switch (message) {
    case "SUPPLIER_REQUIRED":
      return "Elige un proveedor antes de crear la orden.";
    case "ITEMS_REQUIRED":
      return "Agrega al menos un producto a la orden.";
    case "PURCHASE_ORDER_NOT_FOUND":
      return "Esta orden ya no existe.";
    default:
      if (message.startsWith("PURCHASE_ORDER_NOT_OPEN")) {
        return "Esta orden ya fue procesada — recarga la página.";
      }
      return "No se pudo completar la operación. Intenta de nuevo.";
  }
}

/** Formatea la lista de mensajes del Gerente Inteligente tras registrar una compra. */
function buildManagerMessages(
  order: PurchaseOrder,
  capacityImproved: readonly { productName: string; beforeMaxUnits: number; afterMaxUnits: number }[],
  stockoutResolved: readonly string[]
): string[] {
  const messages: string[] = [
    order.status === "PARCIAL"
      ? "✅ Inventario actualizado. La orden sigue abierta: aún falta mercancía por recibir."
      : "✅ Inventario actualizado."
  ];

  for (const item of capacityImproved) {
    messages.push(`✅ Ya puedes preparar ${item.afterMaxUnits} ${item.productName}.`);
  }

  if (stockoutResolved.length > 0) {
    messages.push("✅ Riesgo de desabastecimiento eliminado.");
  }

  return messages;
}

const OFFLINE_PURCHASE_MESSAGE =
  "Sin conexión: la compra quedó guardada en este dispositivo y se sincronizará sola cuando vuelva internet. El inventario se actualizará entonces.";

const NETWORK_PURCHASE_MESSAGE =
  "No pudimos confirmar la compra con el servidor. Quedó guardada en este dispositivo y se reintentará sola, sin duplicar el inventario.";

const ALREADY_QUEUED_PURCHASE_MESSAGE =
  "Esta compra ya estaba guardada en este dispositivo y se sincronizará sola. No se registró dos veces.";

/** Mensaje para la persona cuando la compra NO se confirmó ahora mismo pero tampoco se perdió. */
function queuedPurchaseMessage(outcome: Exclude<SubmitPurchaseOutcome, { status: "COMPLETED" }>): string {
  if (outcome.status === "ALREADY_QUEUED") return ALREADY_QUEUED_PURCHASE_MESSAGE;
  return outcome.reason === "OFFLINE" ? OFFLINE_PURCHASE_MESSAGE : NETWORK_PURCHASE_MESSAGE;
}

export function usePurchaseOrders(): UsePurchaseOrdersResult {
  const [orders, setOrders] = useState<PurchaseOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const all = await container.purchaseOrderEngine.get().listAll();
    setOrders(all);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    reload()
      .catch((e: any) => setError(e?.message ?? "No se pudieron cargar las órdenes de compra."))
      .finally(() => setLoading(false));
  }, [reload]);

  // Se refresca sola ante cambios de inventario (otra pestaña, otro usuario,
  // "Aumentar stock" manual) — igual que useSmartPurchasing (PASO 2.6).
  useVimdyEvent("inventory", () => {
    reload().catch((e: any) => setError(e?.message ?? "No se pudieron cargar las órdenes de compra."));
  });

  const createOrder = useCallback(
    async (input: {
      items: PurchaseOrderItem[];
      supplierId: string;
      expectedDeliveryDate?: Date;
    }): Promise<PurchaseOrder | null> => {
      setError(null);
      try {
        const session = userSessionStore.get();
        const created = await container.purchaseOrderEngine.get().create({
          ...input,
          createdBy: session.logged ? session.name : undefined
        });
        await reload();
        toast.success("Orden de compra creada.");
        return created;
      } catch (e: any) {
        const message = friendlyError(e?.message ?? "");
        setError(message);
        toast.error(message);
        return null;
      }
    },
    [reload]
  );

  const markAsPurchased = useCallback(
    async (
      orderId: string,
      receivedNow?: PurchaseOrderItem[],
      expiryByProduct?: Readonly<Record<string, IsoDateString>>
    ): Promise<string[] | null> => {
      setError(null);
      try {
        const session = userSessionStore.get();

        // Las líneas se resuelven AQUÍ, antes de guardar en la cola: si se
        // guardara "recibir lo que falte" y el primer intento sí llegó al
        // servidor, el reintento calcularía 0 pendiente y no podría confirmarse.
        let items: PurchaseOrderItem[];
        if (receivedNow && receivedNow.length > 0) {
          items = receivedNow.filter((item) => item.quantity > 0);
        } else {
          const fresh = await container.purchaseOrderEngine
            .get()
            .getById(orderId)
            .catch(() => null);
          const order = fresh ?? orders.find((o) => o.id === orderId) ?? null;
          if (!order) {
            throw new Error("PURCHASE_ORDER_NOT_FOUND");
          }
          items = order.items
            .map((item) => ({ ...item, quantity: remainingQuantity(order, item) }))
            .filter((item) => item.quantity > 0);
        }
        if (items.length === 0) {
          throw new Error("PURCHASE_ITEMS_INVALID");
        }
        if (expiryByProduct) {
          items = items.map((item) => {
            const expiresAt = expiryByProduct[item.productId];
            return expiresAt !== undefined ? { ...item, expiresAt } : item;
          });
        }

        const outcome = await submitPurchase({
          kind: "RECEIPT",
          purchaseOrderId: orderId,
          items,
          performedBy: session.logged ? session.name : undefined
        });

        if (outcome.status !== "COMPLETED") {
          const message = queuedPurchaseMessage(outcome);
          toast.warning(message);
          return [message];
        }

        await reload();
        // Toda compra debe actualizar automáticamente el inventario: avisa
        // al resto de VIMDY (Inventario, Compras Inteligentes, Dashboard).
        vimdyCore.emit("inventory");

        const result = outcome.result;
        const messages = buildManagerMessages(result.order, result.capacityImproved, result.stockoutResolved);
        messages.forEach((message) => toast.success(message));
        return messages;
      } catch (e: any) {
        const message = friendlyError(e?.message ?? "");
        setError(message);
        toast.error(message);
        return null;
      }
    },
    [reload, orders]
  );

  const recordDirectPurchase = useCallback(
    async (input: {
      supplierId: string;
      items: PurchaseOrderItem[];
      invoiceNumber?: string;
      note?: string;
    }): Promise<string[] | null> => {
      setError(null);
      try {
        const session = userSessionStore.get();
        const outcome = await submitPurchase({
          kind: "DIRECT",
          supplierId: input.supplierId,
          items: input.items,
          invoiceNumber: input.invoiceNumber?.trim() || undefined,
          note: input.note,
          performedBy: session.logged ? session.name : undefined
        });

        if (outcome.status !== "COMPLETED") {
          const message = queuedPurchaseMessage(outcome);
          toast.warning(message);
          return [message];
        }

        await reload();
        vimdyCore.emit("inventory");

        const result = outcome.result;
        const messages = buildManagerMessages(result.order, result.capacityImproved, result.stockoutResolved);
        messages.forEach((message) => toast.success(message));
        return messages;
      } catch (e: any) {
        const message = friendlyError(e?.message ?? "");
        setError(message);
        toast.error(message);
        return null;
      }
    },
    [reload]
  );

  const postponeOrder = useCallback(
    async (orderId: string, newExpectedDate: Date, note?: string): Promise<boolean> => {
      setError(null);
      try {
        await container.purchaseOrderEngine.get().postpone(orderId, newExpectedDate, note);
        await reload();
        toast.info("Orden pospuesta.");
        return true;
      } catch (e: any) {
        const message = friendlyError(e?.message ?? "");
        setError(message);
        toast.error(message);
        return false;
      }
    },
    [reload]
  );

  const cancelOrder = useCallback(
    async (orderId: string, note?: string): Promise<boolean> => {
      setError(null);
      try {
        await container.purchaseOrderEngine.get().cancel(orderId, note);
        await reload();
        toast.warning("Orden cancelada.");
        return true;
      } catch (e: any) {
        const message = friendlyError(e?.message ?? "");
        setError(message);
        toast.error(message);
        return false;
      }
    },
    [reload]
  );

  const OPEN = new Set(["PENDIENTE", "POSPUESTO", "PARCIAL"]);

  return {
    orders,
    openOrders: orders.filter((o) => OPEN.has(o.status)),
    history: orders.filter((o) => !OPEN.has(o.status)),
    loading,
    error,
    reload,
    createOrder,
    markAsPurchased,
    recordDirectPurchase,
    postponeOrder,
    cancelOrder
  };
}