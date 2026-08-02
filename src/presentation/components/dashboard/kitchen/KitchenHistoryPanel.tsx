import React from "react";
import { PackageCheck, User } from "lucide-react";

import { useKitchenHistory } from "../../../../hooks/useKitchenHistory";
import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";

/** "1h 04m" si pasa de una hora, "12m 30s" en el resto de los casos. */
function formatDuration(ms: number): string {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  }

  return `${minutes}m ${String(seconds).padStart(2, "0")}s`;
}

function formatTime(date: Date): string {
  return new Date(date).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

export function KitchenHistoryPanel() {
  const { orders, loading } = useKitchenHistory();

  if (loading) {
    return <p className="text-vimdy-text-tertiary text-center py-10">Cargando historial...</p>;
  }

  if (orders.length === 0) {
    return (
      <div className="bg-vimdy-surface rounded-2xl border border-dashed border-vimdy-border p-10 text-center">
        <p className="text-vimdy-text-tertiary">Todavía no hay comandas entregadas.</p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {orders.map(order => (
        <HistoryRow key={order.id} order={order} />
      ))}
    </div>
  );
}

function HistoryRow({ order }: { order: KitchenOrderView }) {
  const durationMs =
    new Date(order.deliveredAt ?? order.createdAt).getTime() -
    new Date(order.createdAt).getTime();

  return (
    <div className="bg-vimdy-surface border border-vimdy-border rounded-2xl p-5 flex flex-wrap items-center gap-x-8 gap-y-3">
      <div className="min-w-[120px]">
        <h3 className="text-vimdy-text font-bold">{order.origin ?? "Pedido"}</h3>
        <p className="text-vimdy-text-tertiary text-xs">Pedido #{order.orderNumber ?? order.id.slice(0, 8)}</p>
      </div>

      <div className="min-w-[110px]">
        <p className="text-vimdy-text-tertiary text-xs uppercase tracking-wide">Hora</p>
        <p className="text-vimdy-text text-sm font-semibold">{formatTime(order.createdAt)}</p>
      </div>

      <div className="min-w-[100px]">
        <p className="text-vimdy-text-tertiary text-xs uppercase tracking-wide">Tiempo</p>
        <p className="text-vimdy-accent text-sm font-bold">{formatDuration(durationMs)}</p>
      </div>

      <div className="min-w-[140px] flex items-center gap-2">
        <User size={14} className="text-vimdy-text-tertiary shrink-0" />
        <div>
          <p className="text-vimdy-text-tertiary text-xs uppercase tracking-wide leading-none">Mesero</p>
          <p className="text-vimdy-text text-sm font-semibold leading-tight mt-0.5">
            {order.waiterName ?? "Sin asignar"}
          </p>
        </div>
      </div>

      <div className="flex-1 min-w-[200px]">
        <p className="text-vimdy-text-tertiary text-xs uppercase tracking-wide mb-1">Productos</p>
        <p className="text-vimdy-text-secondary text-sm truncate">
          {order.items.map(item => `${item.quantity}x ${item.productName}`).join(", ")}
        </p>
      </div>

      <div className="flex items-center gap-1.5 bg-vimdy-success/10 border border-vimdy-success/30 rounded-full px-3 py-1.5 shrink-0">
        <PackageCheck size={14} className="text-vimdy-success" />
        <span className="text-vimdy-success text-xs font-bold">Entregado</span>
      </div>
    </div>
  );
}