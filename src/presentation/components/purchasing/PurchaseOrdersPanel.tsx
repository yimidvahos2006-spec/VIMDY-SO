import React, { useState } from "react";
import { ClipboardList, CheckCircle2, Clock, XCircle, Eye, Sparkles } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { EmptyState } from "../ui/EmptyState";
import { PostponeOrderModal } from "./PostponeOrderModal";
import { SupplierDetailsModal } from "./SupplierDetailsModal";

import { PurchaseOrder, PurchaseOrderItem, Supplier, Product } from "../../../core/entities/Entities";
import { remainingQuantity } from "../../../core/engines/PurchaseOrderEngine";
import { UsePurchaseOrdersResult } from "../../../hooks/usePurchaseOrders";
import { confirmDialog } from "../../../core/store/confirmStore";

interface PurchaseOrdersPanelProps {
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  products: Product[];
  actions: Pick<UsePurchaseOrdersResult, "markAsPurchased" | "postponeOrder" | "cancelOrder">;
}

const STATUS_BADGE: Record<string, string> = {
  PENDIENTE: "border-vimdy-accent/30 bg-vimdy-accent/10 text-vimdy-accent",
  POSPUESTO: "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning",
  PARCIAL: "border-vimdy-success/30 bg-vimdy-success/10 text-vimdy-success"
};

const STATUS_TEXT: Record<string, string> = {
  PENDIENTE: "PENDIENTE",
  POSPUESTO: "POSPUESTO",
  PARCIAL: "RECIBIDA EN PARTE"
};

/** Acepta "12", "12,5" y "12.5". Devuelve NaN si no es un número. */
function parseQuantity(text: string): number {
  const normalized = text.trim().replace(",", ".");
  return /^\d*\.?\d+$/.test(normalized) ? Number(normalized) : Number.NaN;
}

function formatDate(date?: Date): string {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
}

/**
 * PurchaseOrdersPanel — PASO 2.7 (Compras Inteligentes, ejecución).
 * ---------------------------------------------------------------------------
 * Administra las órdenes abiertas desde VIMDY: marcar como comprado (lo que
 * de verdad descarga inventario), posponer o cancelar. Tras registrar una
 * compra, muestra en pantalla los mensajes del Gerente Inteligente además
 * de los toasts.
 */
export function PurchaseOrdersPanel({ orders, suppliers, products, actions }: PurchaseOrdersPanelProps) {
  const [postponeTarget, setPostponeTarget] = useState<PurchaseOrder | null>(null);
  const [supplierView, setSupplierView] = useState<Supplier | null>(null);
  const [managerMessages, setManagerMessages] = useState<{ orderId: string; messages: string[] } | null>(null);
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [receivingOrderId, setReceivingOrderId] = useState<string | null>(null);
  const [receiveInputs, setReceiveInputs] = useState<Record<string, string>>({});
  const [receiveError, setReceiveError] = useState<string | null>(null);

  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.id, p]));

  /** Abre el formulario de recepción con lo que falta de cada producto ya escrito. */
  function openReceiveForm(order: PurchaseOrder) {
    const inputs: Record<string, string> = {};
    for (const item of order.items) {
      const remaining = remainingQuantity(order, item);
      if (remaining > 0) inputs[item.productId] = String(remaining);
    }
    setReceiveInputs(inputs);
    setReceiveError(null);
    setReceivingOrderId(order.id);
  }

  async function handleConfirmReceipt(order: PurchaseOrder) {
    const received: PurchaseOrderItem[] = [];
    for (const item of order.items) {
      const remaining = remainingQuantity(order, item);
      if (remaining <= 0) continue;
      const raw = receiveInputs[item.productId] ?? "";
      if (raw.trim() === "") continue;
      const quantity = parseQuantity(raw);
      const name = productById.get(item.productId)?.name ?? "Producto";
      if (!Number.isFinite(quantity) || quantity < 0) {
        setReceiveError(`La cantidad de "${name}" no es válida.`);
        return;
      }
      if (quantity > remaining + 1e-9) {
        setReceiveError(`De "${name}" solo faltan ${remaining} por recibir.`);
        return;
      }
      if (quantity > 0) received.push({ ...item, quantity });
    }
    if (received.length === 0) {
      setReceiveError("Escribe cuánto llegó de al menos un producto.");
      return;
    }

    setReceiveError(null);
    setBusyOrderId(order.id);
    const messages = await actions.markAsPurchased(order.id, received);
    setBusyOrderId(null);
    if (messages) {
      setReceivingOrderId(null);
      setManagerMessages({ orderId: order.id, messages });
    }
  }

  async function handleCancel(order: PurchaseOrder) {
    const accepted = await confirmDialog({
      title: "Cancelar orden",
      message: "¿Cancelar esta orden? Queda guardada en el historial como CANCELADO.",
      confirmLabel: "Cancelar orden",
      cancelLabel: "Volver",
      danger: true
    });
    if (!accepted) return;
    setBusyOrderId(order.id);
    await actions.cancelOrder(order.id);
    setBusyOrderId(null);
  }

  if (orders.length === 0) {
    return (
      <EmptyState
        icon={<ClipboardList size={28} />}
        title="No tienes órdenes de compra abiertas."
        description="Crea una desde una recomendación de arriba para empezar a administrar tus compras dentro de VIMDY."
      />
    );
  }

  return (
    <div className="space-y-3">
      {orders.map((order) => {
        const supplier = supplierById.get(order.supplierId);
        const messagesForThisOrder = managerMessages?.orderId === order.id ? managerMessages.messages : null;

        return (
          <div key={order.id} className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-5">
            <div className="flex items-start justify-between gap-4 flex-wrap">
              <div>
                <div className="flex items-center gap-2 mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-vimdy-sm border ${STATUS_BADGE[order.status]}`}>
                    {STATUS_TEXT[order.status] ?? order.status}
                  </span>
                  <span className="text-vimdy-text-tertiary text-xs">Creada el {formatDate(order.createdAt)}</span>
                </div>
                <ul className="text-sm text-vimdy-text space-y-0.5">
                  {order.items.map((item) => (
                    <li key={item.productId}>
                      {productById.get(item.productId)?.name ?? "Producto"} — {item.quantity}{" "}
                      {productById.get(item.productId)?.unit ?? "unidad(es)"}
                      {item.unitPrice ? ` · $${item.unitPrice.toLocaleString("es-CO")} c/u` : ""}
                      {(order.receivedQuantities?.[item.productId] ?? 0) > 0
                        ? ` · recibido ${order.receivedQuantities?.[item.productId]}, falta ${remainingQuantity(order, item)}`
                        : ""}
                    </li>
                  ))}
                </ul>
                {order.expectedDeliveryDate && (
                  <p className="text-xs text-vimdy-text-tertiary mt-1 flex items-center gap-1">
                    <Clock size={12} /> Entrega estimada: {formatDate(order.expectedDeliveryDate)}
                  </p>
                )}
                {order.statusNote && <p className="text-xs text-vimdy-text-tertiary mt-1">Nota: {order.statusNote}</p>}
              </div>

              <div className="flex items-center gap-2 flex-wrap">
                <VimdyButton
                  variant="ghost"
                  className="!px-4 !py-2 text-xs"
                  icon={<Eye size={14} />}
                  onClick={() => supplier && setSupplierView(supplier)}
                  disabled={!supplier}
                >
                  Ver proveedor
                </VimdyButton>
                <VimdyButton
                  variant="secondary"
                  className="!px-4 !py-2 text-xs"
                  icon={<Clock size={14} />}
                  onClick={() => setPostponeTarget(order)}
                  disabled={busyOrderId === order.id}
                >
                  Posponer
                </VimdyButton>
                <VimdyButton
                  variant="ghost"
                  className="!px-4 !py-2 text-xs !text-vimdy-danger !border-vimdy-danger/30 hover:!border-vimdy-danger"
                  icon={<XCircle size={14} />}
                  onClick={() => handleCancel(order)}
                  disabled={busyOrderId === order.id}
                >
                  Cancelar
                </VimdyButton>
                <VimdyButton
                  className="!px-4 !py-2 text-xs"
                  icon={<CheckCircle2 size={14} />}
                  onClick={() => openReceiveForm(order)}
                  disabled={busyOrderId === order.id}
                >
                  {busyOrderId === order.id ? "Procesando..." : "Recibir mercancía"}
                </VimdyButton>
              </div>
            </div>

            {receivingOrderId === order.id && (
              <div className="mt-4 rounded-vimdy-md border border-vimdy-border bg-vimdy-background p-4 space-y-3">
                <p className="text-sm text-vimdy-text font-semibold">¿Cuánto llegó de cada producto?</p>
                <p className="text-xs text-vimdy-text-tertiary">
                  Si llegó menos de lo pedido, la orden queda abierta y puedes recibir el resto después.
                </p>
                {order.items
                  .filter((item) => remainingQuantity(order, item) > 0)
                  .map((item) => (
                    <label key={item.productId} className="flex items-center justify-between gap-3 text-sm text-vimdy-text">
                      <span className="flex-1 min-w-0 truncate">
                        {productById.get(item.productId)?.name ?? "Producto"}
                        <span className="text-vimdy-text-tertiary text-xs">
                          {" "}
                          (falta {remainingQuantity(order, item)} {productById.get(item.productId)?.unit ?? ""})
                        </span>
                      </span>
                      <input
                        type="text"
                        inputMode="decimal"
                        value={receiveInputs[item.productId] ?? ""}
                        onChange={(e) =>
                          setReceiveInputs((prev) => ({ ...prev, [item.productId]: e.target.value }))
                        }
                        className="w-24 h-9 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm focus:outline-none focus:border-vimdy-accent"
                      />
                    </label>
                  ))}
                {receiveError && <p className="text-xs text-vimdy-danger">{receiveError}</p>}
                <div className="flex items-center gap-2 justify-end">
                  <VimdyButton
                    variant="ghost"
                    className="!px-4 !py-2 text-xs"
                    onClick={() => setReceivingOrderId(null)}
                    disabled={busyOrderId === order.id}
                  >
                    Cerrar
                  </VimdyButton>
                  <VimdyButton
                    className="!px-4 !py-2 text-xs"
                    icon={<CheckCircle2 size={14} />}
                    onClick={() => handleConfirmReceipt(order)}
                    disabled={busyOrderId === order.id}
                  >
                    {busyOrderId === order.id ? "Procesando..." : "Confirmar recepción"}
                  </VimdyButton>
                </div>
              </div>
            )}

            {messagesForThisOrder && (
              <div className="mt-4 rounded-vimdy-md border border-vimdy-accent/30 bg-vimdy-accent/10 p-4 space-y-1">
                <div className="flex items-center gap-2 text-vimdy-accent text-xs font-semibold uppercase tracking-wide mb-1">
                  <Sparkles size={14} />
                  Gerente Inteligente
                </div>
                {messagesForThisOrder.map((message, i) => (
                  <p key={i} className="text-sm text-vimdy-text">
                    {message}
                  </p>
                ))}
              </div>
            )}
          </div>
        );
      })}

      <PostponeOrderModal
        open={!!postponeTarget}
        onClose={() => setPostponeTarget(null)}
        onConfirm={(date, note) => actions.postponeOrder(postponeTarget!.id, date, note)}
      />
      <SupplierDetailsModal open={!!supplierView} onClose={() => setSupplierView(null)} supplier={supplierView} />
    </div>
  );
}