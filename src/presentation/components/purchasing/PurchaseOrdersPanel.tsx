import React, { useState } from "react";
import { ClipboardList, CheckCircle2, Clock, XCircle, Eye, Sparkles } from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { EmptyState } from "../ui/EmptyState";
import { PostponeOrderModal } from "./PostponeOrderModal";
import { SupplierDetailsModal } from "./SupplierDetailsModal";

import { PurchaseOrder, Supplier, Product } from "../../../core/entities/Entities";
import { UsePurchaseOrdersResult } from "../../../hooks/usePurchaseOrders";

interface PurchaseOrdersPanelProps {
  orders: PurchaseOrder[];
  suppliers: Supplier[];
  products: Product[];
  actions: Pick<UsePurchaseOrdersResult, "markAsPurchased" | "postponeOrder" | "cancelOrder">;
}

const STATUS_BADGE: Record<string, string> = {
  PENDIENTE: "border-vimdy-accent/30 bg-vimdy-accent/10 text-vimdy-accent",
  POSPUESTO: "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning"
};

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

  const supplierById = new Map(suppliers.map((s) => [s.id, s]));
  const productById = new Map(products.map((p) => [p.id, p]));

  async function handleMarkAsPurchased(order: PurchaseOrder) {
    setBusyOrderId(order.id);
    const messages = await actions.markAsPurchased(order.id);
    setBusyOrderId(null);
    if (messages) setManagerMessages({ orderId: order.id, messages });
  }

  async function handleCancel(order: PurchaseOrder) {
    if (!window.confirm("¿Cancelar esta orden? Queda guardada en el historial como CANCELADO.")) return;
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
                    {order.status}
                  </span>
                  <span className="text-vimdy-text-tertiary text-xs">Creada el {formatDate(order.createdAt)}</span>
                </div>
                <ul className="text-sm text-vimdy-text space-y-0.5">
                  {order.items.map((item) => (
                    <li key={item.productId}>
                      {productById.get(item.productId)?.name ?? "Producto"} — {item.quantity}{" "}
                      {productById.get(item.productId)?.unit ?? "unidad(es)"}
                      {item.unitPrice ? ` · $${item.unitPrice.toLocaleString("es-CO")} c/u` : ""}
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
                  onClick={() => handleMarkAsPurchased(order)}
                  disabled={busyOrderId === order.id}
                >
                  {busyOrderId === order.id ? "Procesando..." : "Marcar como comprado"}
                </VimdyButton>
              </div>
            </div>

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