// src/hooks/usePurchaseOrders.ts
import { useCallback, useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { PurchaseOrder, PurchaseOrderItem } from "../core/entities/Entities";
import { vimdyCore } from "../core/VimdyCore";
import { useVimdyEvent } from "./useVimdyCore";
import { userSessionStore } from "../core/store/userSessionStore";
import { toast } from "../core/store/toastStore";

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

  /** Marca como comprado y actualiza inventario. Devuelve los mensajes del Gerente Inteligente. */
  markAsPurchased: (
    orderId: string,
    receivedNow?: PurchaseOrderItem[]
  ) => Promise<string[] | null>;

  postponeOrder: (orderId: string, newExpectedDate: Date, note?: string) => Promise<boolean>;
  cancelOrder: (orderId: string, note?: string) => Promise<boolean>;
}

function friendlyError(message: string): string {
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
  if (/failed to fetch|network|load failed/i.test(message)) {
    return "Necesitas internet para recibir una compra. El inventario no se modificó.";
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
    async (orderId: string, receivedNow?: PurchaseOrderItem[]): Promise<string[] | null> => {
      setError(null);
      try {
        const session = userSessionStore.get();
        const result = await container.purchaseOrderEngine.get().markAsPurchased(
          orderId,
          session.logged ? session.name : undefined,
          receivedNow
        );
        await reload();
        // Toda compra debe actualizar automáticamente el inventario: avisa
        // al resto de VIMDY (Inventario, Compras Inteligentes, Dashboard).
        vimdyCore.emit("inventory");

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
    postponeOrder,
    cancelOrder
  };
}