import React from "react";
import { X, ChefHat, User, Clock3, MessageSquareText, AlertTriangle, ArrowUpCircle } from "lucide-react";

import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { OrderPriority } from "../../../../core/entities/Entities";
import { KitchenOrderTimer } from "./KitchenOrderTimer";
import { VimdyButton } from "../../ui/VimdyButton";

interface Props {
  order: KitchenOrderView;
  onClose: () => void;
}

const PRIORITY_LABEL: Record<OrderPriority, { text: string; className: string; icon?: React.ReactNode }> = {
  URGENT: {
    text: "URGENTE",
    className: "bg-vimdy-danger/15 text-vimdy-danger border-vimdy-danger/50",
    icon: <AlertTriangle size={16} />
  },
  HIGH: {
    text: "ALTA",
    className: "bg-vimdy-warning/15 text-vimdy-warning border-vimdy-warning/50",
    icon: <ArrowUpCircle size={16} />
  },
  NORMAL: {
    text: "NORMAL",
    className: "bg-vimdy-surface-hover text-vimdy-text-secondary border-vimdy-border"
  }
};

/**
 * Vista ampliada de una comanda, pensada para que el cocinero confirme
 * detalles sin tener que entrecerrar los ojos frente a la card chica.
 * Ocupa ~75% de la pantalla con tipografía grande, tal como se acordó.
 *
 * Nota: no muestra "modificaciones por producto" ni "alérgenos" porque
 * esos datos no existen todavía en el modelo (SaleItem/Product no los
 * tienen) — solo se muestran las notas generales del pedido, que sí
 * vienen de Sale.notes.
 */
export function KitchenOrderDetailDialog({ order, onClose }: Props) {
  const priority = PRIORITY_LABEL[order.priority ?? "NORMAL"];

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50 p-6">
      <div className="bg-vimdy-surface border border-vimdy-border rounded-3xl w-full max-w-5xl max-h-[85vh] flex flex-col overflow-hidden">

        {/* Header */}
        <div className="flex items-start justify-between px-8 py-6 border-b border-vimdy-border flex-shrink-0">
          <div className="flex items-center gap-4">
            <div className="bg-vimdy-accent/10 border border-vimdy-accent/30 rounded-2xl p-3">
              <ChefHat size={32} className="text-vimdy-accent" />
            </div>
            <div>
              <div className="flex items-center gap-3 flex-wrap">
                <h2 className="text-3xl font-bold text-vimdy-text">{order.origin ?? "Pedido"}</h2>
                <span
                  className={`flex items-center gap-1 rounded-lg border font-bold uppercase tracking-wide text-xs px-3 py-1.5 ${priority.className}`}
                >
                  {priority.icon}
                  {priority.text}
                </span>
              </div>
              <p className="text-vimdy-text-secondary mt-1">
                Pedido #{order.orderNumber ?? order.id.slice(0, 8)}
              </p>
            </div>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-tertiary hover:text-vimdy-text">
            <X size={28} />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-8 py-6 space-y-6">

          {/* Datos generales */}
          <div className="grid grid-cols-2 gap-4">
            {order.waiterName && (
              <div className="flex items-center gap-3 bg-vimdy-surface-hover rounded-2xl px-5 py-4">
                <User size={22} className="text-vimdy-accent" />
                <div>
                  <p className="text-vimdy-text-secondary text-xs">Mesero</p>
                  <p className="text-vimdy-text font-bold text-lg">{order.waiterName}</p>
                </div>
              </div>
            )}
            <div className="flex items-center gap-3 bg-vimdy-surface-hover rounded-2xl px-5 py-4">
              <Clock3 size={22} className="text-vimdy-accent" />
              <div>
                <p className="text-vimdy-text-secondary text-xs">Tiempo transcurrido</p>
                <KitchenOrderTimer createdAt={order.createdAt} tvMode />
              </div>
            </div>
          </div>

          {/* Notas generales */}
          {order.notes && (
            <div className="flex items-start gap-3 bg-vimdy-warning/10 border border-vimdy-warning/30 rounded-2xl px-5 py-4">
              <MessageSquareText size={22} className="text-vimdy-warning mt-0.5 shrink-0" />
              <div>
                <p className="text-vimdy-warning/80 text-xs font-semibold mb-1">Notas del pedido</p>
                <p className="text-vimdy-warning text-lg">{order.notes}</p>
              </div>
            </div>
          )}

          {/* Productos */}
          <div>
            <p className="text-vimdy-text-secondary text-sm font-semibold mb-3">
              {order.items.length} producto{order.items.length !== 1 ? "s" : ""}
            </p>
            <div className="space-y-3">
              {order.items.map((item, index) => (
                <div
                  key={`${item.productId}-${index}`}
                  className="flex justify-between items-center bg-vimdy-surface-hover rounded-2xl px-5 py-4"
                >
                  <p className="text-vimdy-text font-semibold text-xl">{item.productName}</p>
                  <span className="text-vimdy-accent font-bold text-xl">x{item.quantity}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Total */}
          <div className="flex justify-between items-center border-t border-vimdy-border pt-5">
            <span className="text-vimdy-text-secondary font-semibold">Total</span>
            <span className="text-vimdy-accent font-black text-2xl">
              ${order.total.toLocaleString("es-CO")}
            </span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-8 py-5 border-t border-vimdy-border flex-shrink-0">
          <VimdyButton
            onClick={onClose}
            variant="primary"
            size="lg"
            fullWidth
          >
            Cerrar
          </VimdyButton>
        </div>
      </div>
    </div>
  );
}