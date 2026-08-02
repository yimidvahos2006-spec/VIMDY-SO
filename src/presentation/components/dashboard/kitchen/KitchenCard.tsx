import React from "react";
import {
  ChefHat,
  CheckCircle2,
  UtensilsCrossed,
  User,
  Clock3,
  MessageSquareText,
  Ban,
  AlertTriangle,
  ArrowUpCircle,
  Eye,
  GripVertical,
  Timer,
  Printer
} from "lucide-react";
import { useDraggable } from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";

import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { OrderPriority } from "../../../../core/entities/Entities";
import { KitchenOrderTimer } from "./KitchenOrderTimer";
import { groupOrderItemsByStation } from "../../../../core/services/kitchenTicketGrouping";
import { printKitchenTicketDocument } from "../../../utils/printKitchenTicketDocument";
import { VimdyButton } from "../../ui/VimdyButton";

interface Props {
  order: KitchenOrderView;
  onPreparing?: () => void;
  onReady?: () => void;
  onDeliver?: () => void;
  onCancel?: () => void;
  /** Abre el modal de detalle ampliado de esta comanda. */
  onViewDetail?: () => void;
  /** true durante unos segundos justo después de que la comanda llega. */
  isNew?: boolean;
  /** true en Modo TV: tipografía y botones más grandes para verse a distancia. */
  tvMode?: boolean;
  /**
   * true si esta card se puede arrastrar entre columnas (Pendiente /
   * Preparando / Listo). Por defecto true; se desactiva en pantallas donde
   * no aplica (ej. Historial de entregados, que reusa otro componente).
   */
  draggable?: boolean;
}

/** Hora del pedido en formato local (ej. "7:42 PM"). */
function formatOrderTime(date: Date): string {
  return new Date(date).toLocaleTimeString("es-CO", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

/**
 * Estilos por prioridad. Sin `priority` (comandas viejas) se trata como
 * NORMAL. URGENT siempre se ve primero (ver sort en KitchenDashboard) y
 * pulsa para que no pase inadvertida entre las demás tarjetas.
 */
const PRIORITY_STYLES: Record<
  OrderPriority,
  { border: string; badge: string; label: string; pulse?: boolean }
> = {
  URGENT: {
    border: "border-vimdy-danger",
    badge: "bg-vimdy-danger/15 text-vimdy-danger border-vimdy-danger/50",
    label: "URGENTE",
    pulse: true
  },
  HIGH: {
    border: "border-vimdy-warning",
    badge: "bg-vimdy-warning/15 text-vimdy-warning border-vimdy-warning/50",
    label: "ALTA"
  },
  NORMAL: {
    border: "border-vimdy-border hover:border-vimdy-accent",
    badge: "",
    label: "NORMAL"
  }
};

export function KitchenCard({
  order,
  onPreparing,
  onReady,
  onDeliver,
  onCancel,
  onViewDetail,
  isNew = false,
  tvMode = false,
  draggable = true
}: Props) {
  const priority: OrderPriority = order.priority ?? "NORMAL";
  const priorityStyle = PRIORITY_STYLES[priority];

  /**
   * Imprime UN ticket por cada estación real de la comanda ("Bebidas" a
   * Barra, "Pizzas" a Cocina, etc. — ver Category.printStation), sin que
   * nadie tenga que separar los items a mano. Si el negocio no configuró
   * ninguna estación, cae todo en un único ticket "Cocina" (ver
   * DEFAULT_PRINT_STATION), igual que si esta función no existiera.
   */
  function handlePrintTicket() {
    const grouped = groupOrderItemsByStation(order.items);

    for (const [station, items] of grouped) {
      printKitchenTicketDocument(
        station,
        items.map((item) => ({
          name: item.productName,
          quantity: item.quantity,
          estimatedPrepMinutes: item.estimatedPrepMinutes
        })),
        {
          orderNumber: order.orderNumber ? `#${order.orderNumber}` : undefined,
          origin: order.origin,
          waiterName: order.waiterName,
          notes: order.notes
        }
      );
    }
  }

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: order.id,
    disabled: !draggable,
    // El destino (columna) usa esto para saber a qué estado mover la
    // comanda al soltar, sin tener que volver a buscarla en la lista.
    data: { status: order.status }
  });

  // El glow de "pedido nuevo" es temporal (unos segundos); la prioridad
  // URGENTE/ALTA es un estado que dura mientras el pedido está activo, así
  // que manda sobre el resaltado de "nuevo" en cuanto a color de borde.
  const borderClass = isNew
    ? "border-vimdy-warning animate-kitchen-order-in animate-kitchen-order-glow"
    : `${priorityStyle.border} ${priorityStyle.pulse ? "animate-pulse" : ""}`;

  return (
    <div
      ref={setNodeRef}
      style={{
        transform: CSS.Translate.toString(transform),
        // Mientras se arrastra, la card original se atenúa: la copia que
        // sigue al cursor la pinta DragOverlay en KitchenDashboard.
        opacity: isDragging ? 0.35 : 1
      }}
      className={`bg-vimdy-surface border transition-all duration-300 ${
        tvMode ? "rounded-[2rem] p-8" : "rounded-3xl p-6"
      } ${borderClass}`}
    >

      <div className="flex justify-between items-center">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className={`font-bold text-vimdy-text ${tvMode ? "text-4xl" : "text-2xl"}`}>
              {order.origin ?? "Pedido"}
            </h2>
            {priority !== "NORMAL" && (
              <span
                className={`flex items-center gap-1 rounded-lg border font-bold uppercase tracking-wide ${priorityStyle.badge} ${
                  tvMode ? "text-sm px-3 py-1.5" : "text-xs px-2 py-1"
                }`}
              >
                {priority === "URGENT" ? (
                  <AlertTriangle size={tvMode ? 16 : 12} />
                ) : (
                  <ArrowUpCircle size={tvMode ? 16 : 12} />
                )}
                {priorityStyle.label}
              </span>
            )}
          </div>
          <p className={`text-vimdy-text-secondary ${tvMode ? "text-base" : "text-xs"}`}>
            Pedido #{order.orderNumber ?? order.id.slice(0, 8)}
          </p>
        </div>

        <div className="flex items-center gap-1">
          {draggable && (
            <button
              {...attributes}
              {...listeners}
              type="button"
              aria-label="Arrastrar para cambiar de estado"
              className={`text-vimdy-text-tertiary hover:text-vimdy-text-secondary touch-none ${
                isDragging ? "cursor-grabbing" : "cursor-grab"
              }`}
            >
              <GripVertical size={tvMode ? 30 : 20} />
            </button>
          )}
          <ChefHat size={tvMode ? 52 : 34} className="text-vimdy-accent" />
        </div>
      </div>

      <div className="flex items-center gap-4">
        {onViewDetail && (
          <button
            onClick={onViewDetail}
            className={`mt-3 flex items-center gap-2 text-vimdy-text-secondary hover:text-vimdy-accent font-semibold ${
              tvMode ? "text-base" : "text-xs"
            }`}
          >
            <Eye size={tvMode ? 18 : 14} />
            Ver detalle
          </button>
        )}
        <button
          onClick={handlePrintTicket}
          title="Imprime un ticket por cada estación (Barra, Cocina, Pastelería...) sin separar nada a mano."
          className={`mt-3 flex items-center gap-2 text-vimdy-text-secondary hover:text-vimdy-accent font-semibold ${
            tvMode ? "text-base" : "text-xs"
          }`}
        >
          <Printer size={tvMode ? 18 : 14} />
          Imprimir
        </button>
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-2 ${tvMode ? "gap-3" : ""}`}>
        {order.waiterName && (
          <div className={`flex items-center gap-2 bg-vimdy-surface-hover rounded-xl w-fit ${tvMode ? "px-4 py-3" : "px-3 py-2"}`}>
            <User size={tvMode ? 22 : 16} className="text-vimdy-accent" />
            <span className={`text-vimdy-text font-semibold ${tvMode ? "text-lg" : "text-sm"}`}>
              {order.waiterName}
            </span>
          </div>
        )}

        <div className={`flex items-center gap-2 bg-vimdy-surface-hover rounded-xl w-fit ${tvMode ? "px-4 py-3" : "px-3 py-2"}`}>
          <Clock3 size={tvMode ? 22 : 16} className="text-vimdy-accent" />
          <span className={`text-vimdy-text font-semibold ${tvMode ? "text-lg" : "text-sm"}`}>
            {formatOrderTime(order.createdAt)}
          </span>
        </div>

        {!!order.estimatedPrepMinutes && (
          <div className={`flex items-center gap-2 bg-vimdy-surface-hover rounded-xl w-fit ${tvMode ? "px-4 py-3" : "px-3 py-2"}`}>
            <Timer size={tvMode ? 22 : 16} className="text-vimdy-accent" />
            <span className={`text-vimdy-text font-semibold ${tvMode ? "text-lg" : "text-sm"}`}>
              ~{order.estimatedPrepMinutes} min
            </span>
          </div>
        )}
      </div>

      {order.notes && (
        <div className={`mt-3 flex items-start gap-2 bg-vimdy-warning/10 border border-vimdy-warning/30 rounded-xl ${tvMode ? "px-4 py-3" : "px-3 py-2"}`}>
          <MessageSquareText size={tvMode ? 22 : 16} className="text-vimdy-warning mt-0.5 shrink-0" />
          <span className={`text-vimdy-warning ${tvMode ? "text-lg" : "text-sm"}`}>
            {order.notes}
          </span>
        </div>
      )}

      <div className="mt-6">
        <KitchenOrderTimer createdAt={order.createdAt} tvMode={tvMode} />
      </div>

      <div className={`mt-6 space-y-3 ${tvMode ? "space-y-4" : ""}`}>
        {order.items.map((item, index) => (
          <div
            key={`${item.productId}-${index}`}
            className={`flex justify-between bg-vimdy-surface-hover rounded-xl ${tvMode ? "p-5" : "p-3"}`}
          >
            <p className={`text-vimdy-text font-semibold ${tvMode ? "text-2xl" : ""}`}>
              {item.productName}
              {!!item.estimatedPrepMinutes && (
                <span className={`ml-2 text-vimdy-accent font-normal ${tvMode ? "text-base" : "text-xs"}`}>
                  ~{item.estimatedPrepMinutes} min
                </span>
              )}
            </p>
            <span className={`text-vimdy-accent font-bold ${tvMode ? "text-2xl" : ""}`}>
              x{item.quantity}
            </span>
          </div>
        ))}
      </div>

      <div className={`mt-6 flex justify-between ${tvMode ? "text-lg" : "text-sm"}`}>
        <span className="text-vimdy-text-secondary">
          {order.items.length} producto{order.items.length !== 1 ? "s" : ""}
        </span>
        <span className="text-vimdy-accent font-bold">
          ${order.total.toLocaleString("es-CO")}
        </span>
      </div>

      <div className={`grid grid-cols-2 gap-3 mt-6 ${tvMode ? "gap-4" : ""}`}>
        {onPreparing && (
          <VimdyButton
            onClick={onPreparing}
            variant="primary"
            size={tvMode ? "xl" : "lg"}
            icon={<UtensilsCrossed size={tvMode ? 26 : 18} />}
          >
            Preparar
          </VimdyButton>
        )}
        {onReady && (
          // "Listo" se queda con su verde de estado (vimdy-success) a
          // propósito -- es una señal de estado (pedido listo), no una
          // acción neutra, igual criterio que otros botones de estado
          // ya documentados en el sistema (ver Selector/Toggle y Acento
          // de Función Especial en 09_BUTTON_SYSTEM.md).
          <button
            onClick={onReady}
            className={`bg-vimdy-success hover:bg-vimdy-success/90 rounded-xl font-bold text-white flex items-center justify-center gap-2 ${
              tvMode ? "py-5 text-xl" : "py-3"
            }`}
          >
            <CheckCircle2 size={tvMode ? 26 : 18} />
            Listo
          </button>
        )}
        {onDeliver && (
          <VimdyButton
            onClick={onDeliver}
            variant="primary"
            size={tvMode ? "xl" : "lg"}
            icon={<CheckCircle2 size={tvMode ? 26 : 18} />}
            className="col-span-2"
          >
            Entregar
          </VimdyButton>
        )}
        {onCancel && (
          <VimdyButton
            onClick={onCancel}
            variant="danger"
            size={tvMode ? "xl" : "sm"}
            icon={<Ban size={tvMode ? 20 : 16} />}
            className="col-span-2 border border-vimdy-danger/40"
          >
            Cancelar
          </VimdyButton>
        )}
      </div>

    </div>
  );
}