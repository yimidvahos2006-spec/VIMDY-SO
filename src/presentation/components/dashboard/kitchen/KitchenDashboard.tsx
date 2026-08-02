import React, { useEffect, useRef, useState } from "react";
import {
  ClipboardList,
  Clock3,
  ChefHat,
  CheckCircle2,
  Tv,
  Minimize2
} from "lucide-react";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  useDroppable,
  type DragStartEvent,
  type DragEndEvent
} from "@dnd-kit/core";

import { useKitchenOrders, KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { OrderPriority } from "../../../../core/entities/Entities";
import { KitchenCard } from "./KitchenCard";
import { CancelOrderDialog } from "./CancelOrderDialog";
import { KitchenOrderDetailDialog } from "./KitchenOrderDetailDialog";

/** Los 3 estados visibles como columnas del tablero (Entregado/Cancelado no se arrastran). */
type ActiveKitchenStatus = "PENDIENTE" | "EN_PREPARACION" | "LISTO";

/** Menor número = más arriba en la cola. Sin `priority` se trata como NORMAL. */
const PRIORITY_WEIGHT: Record<OrderPriority, number> = {
  URGENT: 0,
  HIGH: 1,
  NORMAL: 2
};

/**
 * Ordena por prioridad (URGENTE nunca queda debajo de una NORMAL) y, dentro
 * de la misma prioridad, respeta el orden en que ya venían (más antiguo
 * primero), ya que Array.prototype.sort es estable.
 */
function sortByPriority(orders: KitchenOrderView[]): KitchenOrderView[] {
  return [...orders].sort(
    (a, b) => PRIORITY_WEIGHT[a.priority ?? "NORMAL"] - PRIORITY_WEIGHT[b.priority ?? "NORMAL"]
  );
}

export function KitchenDashboard() {

  const { orders: allOrders, loading, updateStatus, cancelOrder, newOrderIds } = useKitchenOrders();
  const [orderToCancel, setOrderToCancel] = useState<KitchenOrderView | null>(null);
  const [orderToView, setOrderToView] = useState<KitchenOrderView | null>(null);
  const [activeOrder, setActiveOrder] = useState<KitchenOrderView | null>(null);
  const [tvMode, setTvMode] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // distance: 8 evita que un tap para "Ver detalle" o los botones de
  // acción disparen un drag por accidente; solo arrastra si el dedo/mouse
  // se mueve más de 8px sosteniendo el grip. Funciona igual con touch.
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } })
  );

  const orders = allOrders.filter(order => order.status !== "CANCELADO");

  const pending = sortByPriority(orders.filter(order => order.status === "PENDIENTE"));
  const preparing = sortByPriority(orders.filter(order => order.status === "EN_PREPARACION"));
  const ready = sortByPriority(orders.filter(order => order.status === "LISTO"));

  // Si el usuario sale de pantalla completa con Esc (o el navegador la
  // cierra por su cuenta), sincronizamos el estado para no quedar "atascados"
  // en Modo TV sin fullscreen real.
  useEffect(() => {
    function handleFullscreenChange() {
      if (!document.fullscreenElement) {
        setTvMode(false);
      }
    }
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", handleFullscreenChange);
  }, []);

  async function toggleTvMode() {
    if (tvMode) {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      }
      setTvMode(false);
      return;
    }

    try {
      await containerRef.current?.requestFullscreen();
    } catch {
      // El navegador puede negar fullscreen (p. ej. dentro de un iframe);
      // igual activamos el modo visual, solo sin pantalla completa real.
    }
    setTvMode(true);
  }

  async function handleConfirmCancel(reason: string) {
    if (!orderToCancel) return;
    await cancelOrder(orderToCancel.id, reason);
    setOrderToCancel(null);
  }

  function handleDragStart(event: DragStartEvent) {
    const found = orders.find(order => order.id === event.active.id);
    setActiveOrder(found ?? null);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveOrder(null);

    if (!over) return;

    const newStatus = over.id as ActiveKitchenStatus;
    const sourceStatus = active.data.current?.status as ActiveKitchenStatus | undefined;

    // Soltar en la misma columna de donde salió no debe hacer nada.
    if (!sourceStatus || sourceStatus === newStatus) return;

    updateStatus(active.id as string, newStatus);
  }

  return (
    <div
      ref={containerRef}
      className={tvMode ? "space-y-8 min-h-screen p-8" : "space-y-8"}
    >

      <div className="flex items-center justify-between gap-4">
        <div className="grid grid-cols-4 gap-6 flex-1">
          <StatCard
            title="Pedidos activos"
            value={orders.length}
            color="text-vimdy-accent"
            icon={<ClipboardList size={tvMode ? 40 : 28} />}
            tvMode={tvMode}
          />
          <StatCard
            title="Pendientes"
            value={pending.length}
            color="text-vimdy-warning"
            icon={<Clock3 size={tvMode ? 40 : 28} />}
            tvMode={tvMode}
          />
          <StatCard
            title="Preparando"
            value={preparing.length}
            color="text-vimdy-accent"
            icon={<ChefHat size={tvMode ? 40 : 28} />}
            tvMode={tvMode}
          />
          <StatCard
            title="Listos"
            value={ready.length}
            color="text-vimdy-success"
            icon={<CheckCircle2 size={tvMode ? 40 : 28} />}
            tvMode={tvMode}
          />
        </div>

        <div className="flex flex-col items-end gap-3 shrink-0">
          <button
            onClick={toggleTvMode}
            aria-pressed={tvMode}
            className={`flex items-center gap-2 rounded-2xl font-bold transition-colors ${
              tvMode
                ? "bg-vimdy-accent text-white px-6 py-4 text-lg"
                : "bg-vimdy-surface border border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text px-5 py-3"
            }`}
          >
            {tvMode ? <Minimize2 size={20} /> : <Tv size={18} />}
            {tvMode ? "Salir de Modo TV" : "Modo TV"}
          </button>
          {tvMode && <LiveClock />}
        </div>
      </div>

      {loading ? (
        <p className="text-vimdy-text-tertiary text-center py-10">Cargando comandas...</p>
      ) : (
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className={`grid xl:grid-cols-3 gap-6 ${tvMode ? "gap-8" : ""}`}>
            <Column title="Pendientes" color="border-vimdy-warning" tvMode={tvMode} dropId="PENDIENTE">
              {pending.length === 0
                ? <Empty tvMode={tvMode} />
                : pending.map(order => (
                    <KitchenCard
                      key={order.id}
                      order={order}
                      isNew={newOrderIds.has(order.id)}
                      onPreparing={() => updateStatus(order.id, "EN_PREPARACION")}
                      onCancel={() => setOrderToCancel(order)}
                      onViewDetail={() => setOrderToView(order)}
                      tvMode={tvMode}
                    />
                  ))}
            </Column>

            <Column title="Preparando" color="border-vimdy-accent" tvMode={tvMode} dropId="EN_PREPARACION">
              {preparing.length === 0
                ? <Empty tvMode={tvMode} />
                : preparing.map(order => (
                    <KitchenCard
                      key={order.id}
                      order={order}
                      onReady={() => updateStatus(order.id, "LISTO")}
                      onCancel={() => setOrderToCancel(order)}
                      onViewDetail={() => setOrderToView(order)}
                      tvMode={tvMode}
                    />
                  ))}
            </Column>

            <Column title="Listos" color="border-vimdy-success" tvMode={tvMode} dropId="LISTO">
              {ready.length === 0
                ? <Empty tvMode={tvMode} />
                : ready.map((order: KitchenOrderView) => (
                    <KitchenCard
                      key={order.id}
                      order={order}
                      onDeliver={() => updateStatus(order.id, "ENTREGADO")}
                      onCancel={() => setOrderToCancel(order)}
                      onViewDetail={() => setOrderToView(order)}
                      tvMode={tvMode}
                    />
                  ))}
            </Column>
          </div>

          <DragOverlay>
            {activeOrder && (
              <KitchenCard order={activeOrder} tvMode={tvMode} draggable={false} />
            )}
          </DragOverlay>
        </DndContext>
      )}

      {orderToCancel && (
        <CancelOrderDialog
          order={orderToCancel}
          onConfirm={handleConfirmCancel}
          onClose={() => setOrderToCancel(null)}
        />
      )}

      {orderToView && (
        <KitchenOrderDetailDialog
          order={orderToView}
          onClose={() => setOrderToView(null)}
        />
      )}

    </div>
  );
}

/** Reloj en vivo, solo visible en Modo TV, para que la cocina siempre tenga la hora a la vista. */
function LiveClock() {
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const interval = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <span className="text-vimdy-text-secondary font-mono text-xl font-bold">
      {now.toLocaleTimeString("es-CO", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        hour12: true
      })}
    </span>
  );
}

interface StatCardProps {
  title: string;
  value: number;
  color: string;
  icon: React.ReactNode;
  tvMode?: boolean;
}

function StatCard({ title, value, color, icon, tvMode = false }: StatCardProps) {
  return (
    <div className={`bg-vimdy-surface border border-vimdy-border rounded-3xl ${tvMode ? "p-8" : "p-6"}`}>
      <div className={`mb-4 ${color}`}>{icon}</div>
      <p className={`text-vimdy-text-secondary ${tvMode ? "text-lg" : ""}`}>{title}</p>
      <h2 className={`font-black mt-2 ${color} ${tvMode ? "text-6xl" : "text-4xl"}`}>{value}</h2>
    </div>
  );
}

interface ColumnProps {
  title: string;
  color: string;
  children: React.ReactNode;
  tvMode?: boolean;
  /** Estado al que se mueve una comanda si se suelta dentro de esta columna. */
  dropId: ActiveKitchenStatus;
}

function Column({ title, color, children, tvMode = false, dropId }: ColumnProps) {
  const { setNodeRef, isOver } = useDroppable({ id: dropId });

  return (
    <div
      ref={setNodeRef}
      className={`bg-vimdy-surface border-2 rounded-3xl transition-colors ${
        tvMode ? "p-7" : "p-5"
      } ${isOver ? "border-vimdy-accent bg-vimdy-surface" : color}`}
    >
      <h2 className={`font-bold text-vimdy-text mb-5 ${tvMode ? "text-4xl" : "text-2xl"}`}>{title}</h2>
      <div className={`space-y-5 ${tvMode ? "space-y-7" : ""}`}>{children}</div>
    </div>
  );
}

function Empty({ tvMode = false }: { tvMode?: boolean }) {
  return (
    <div className={`bg-vimdy-surface rounded-2xl border border-dashed border-vimdy-border text-center ${tvMode ? "p-14" : "p-10"}`}>
      <p className={`text-vimdy-text-tertiary ${tvMode ? "text-xl" : ""}`}>Sin pedidos.</p>
    </div>
  );
}