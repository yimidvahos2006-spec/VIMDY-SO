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

import { useTranslation } from "../../../../core/i18n/useTranslation";
import { KitchenOrderView } from "../../../../hooks/useKitchenOrders";
import { OrderPriority } from "../../../../core/entities/Entities";
import { KitchenOrderTimer } from "./KitchenOrderTimer";
import { useKitchenDelayLevel } from "../../../../hooks/useKitchenClock";
import { groupOrderItemsByStation } from "../../../../core/services/kitchenTicketGrouping";
import {
  classifyKitchenNote,
  splitOrigin,
  KitchenNoteSeverity
} from "../../../../core/services/kitchenCardContent";
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

/**
 * Estilo del recuadro de una nota según lo que dice el texto (ver
 * classifyKitchenNote): alergia = rojo sólido, restricción ("sin cebolla")
 * = ámbar, cualquier otra nota = neutro con borde.
 */
const NOTE_STYLES: Record<KitchenNoteSeverity, string> = {
  allergy: "bg-vimdy-danger text-white border-vimdy-danger",
  restriction: "bg-vimdy-warning/20 text-vimdy-warning border-vimdy-warning",
  info: "bg-vimdy-surface text-vimdy-text border-vimdy-border"
};

/** Recuadro resaltado para notas especiales, en mayúsculas para leerse a distancia. */
function NoteBox({ text, tvMode }: { text: string; tvMode: boolean }) {
  const severity = classifyKitchenNote(text);
  const Icon = severity === "allergy" ? AlertTriangle : MessageSquareText;

  return (
    <div
      role={severity === "allergy" ? "alert" : undefined}
      className={`flex items-start gap-2 rounded-xl border-2 font-black uppercase tracking-wide break-words ${
        NOTE_STYLES[severity]
      } ${tvMode ? "px-4 py-3 text-2xl" : "px-3 py-2 text-sm"}`}
    >
      <Icon size={tvMode ? 28 : 18} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{text}</span>
    </div>
  );
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
  const { t, money } = useTranslation();
  const priority: OrderPriority = order.priority ?? "NORMAL";
  const priorityStyle = PRIORITY_STYLES[priority];
  const origin = splitOrigin(order.origin, t("kitchen.card.defaultOrigin"));

  // Nivel de demora según el tiempo estimado de ESTE pedido. Solo vuelve a
  // dibujar la tarjeta cuando el nivel cambia, no cada segundo.
  const delayLevel = useKitchenDelayLevel(order.createdAt, order.estimatedPrepMinutes);

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
          estimatedPrepMinutes: item.estimatedPrepMinutes,
          note: item.note
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
  // La demora también se ve en el borde de la tarjeta (no solo en el
  // cronómetro): se distingue a distancia sin leer el número.
  const delayBorder =
    delayLevel === "DELAYED"
      ? "border-vimdy-danger ring-2 ring-vimdy-danger/40"
      : delayLevel === "WARNING" && priority === "NORMAL"
      ? "border-vimdy-warning"
      : "";

  const borderClass = isNew
    ? "border-vimdy-warning animate-kitchen-order-in animate-kitchen-order-glow"
    : `${delayBorder || priorityStyle.border} ${priorityStyle.pulse ? "animate-pulse" : ""}`;

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
        <div className={`flex items-center min-w-0 ${tvMode ? "gap-5" : "gap-3"}`}>
          {/* Mesa (o mostrador/domicilio) en grande a la izquierda. */}
          <div
            className={`shrink-0 flex flex-col items-center justify-center rounded-2xl border-2 border-vimdy-accent/40 bg-vimdy-accent/10 text-center ${
              tvMode ? "min-w-[8rem] px-5 py-3" : "min-w-[5rem] px-3 py-2"
            }`}
          >
            {origin.label && (
              <span className={`font-bold tracking-widest text-vimdy-accent ${tvMode ? "text-base" : "text-[0.65rem]"}`}>
                {origin.label}
              </span>
            )}
            <h2
              className={`font-black leading-none text-vimdy-text break-words ${
                origin.label ? (tvMode ? "text-6xl" : "text-4xl") : tvMode ? "text-3xl" : "text-xl"
              }`}
            >
              {origin.value}
            </h2>
          </div>
          <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
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
             {t("kitchen.card.orderNumber", { number: order.orderNumber ?? order.id.slice(0, 8) })}
           </p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          {draggable && (
            <button
              {...attributes}
              {...listeners}
              type="button"
               aria-label={t("kitchen.card.dragAria")}
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
             {t("kitchen.card.viewDetail")}
          </button>
        )}
        <button
          onClick={handlePrintTicket}
             title={t("kitchen.card.printTitle")}
          className={`mt-3 flex items-center gap-2 text-vimdy-text-secondary hover:text-vimdy-accent font-semibold ${
            tvMode ? "text-base" : "text-xs"
          }`}
        >
           <Printer size={tvMode ? 18 : 14} />
           {t("kitchen.card.print")}
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
        <div className="mt-3">
          <NoteBox text={order.notes} tvMode={tvMode} />
        </div>
      )}

      <div className="mt-6">
        <KitchenOrderTimer
          createdAt={order.createdAt}
          estimatedMinutes={order.estimatedPrepMinutes}
          tvMode={tvMode}
        />
      </div>

      <div className={`mt-6 space-y-3 ${tvMode ? "space-y-4" : ""}`}>
        {order.items.map((item, index) => {
          // Si la vista no trae baseName (comanda armada por otro camino) se
          // cae al nombre completo, igual que antes de este rediseño.
          const name = item.baseName ?? item.productName;
          const extras = item.extraNames ?? [];
          const chipClass = `rounded-lg border font-bold ${tvMode ? "px-3 py-1.5 text-xl" : "px-2 py-0.5 text-xs"}`;

          return (
            <div
              key={`${item.productId}-${index}`}
              className={`flex items-stretch bg-vimdy-surface-hover rounded-xl ${tvMode ? "gap-5 p-4" : "gap-3 p-3"}`}
            >
              {/* Cantidad en grande a la izquierda. */}
              <div
                className={`shrink-0 flex items-center justify-center rounded-xl border border-vimdy-accent/40 bg-vimdy-accent/15 font-black leading-none tabular-nums text-vimdy-accent ${
                  tvMode ? "min-w-[6.5rem] px-3 text-7xl" : "min-w-[3.5rem] px-2 text-4xl"
                }`}
              >
                {item.quantity}×
              </div>

              <div className="flex-1 min-w-0 space-y-2 py-0.5">
                <p className={`text-vimdy-text font-bold leading-tight break-words ${tvMode ? "text-3xl" : "text-lg"}`}>
                  {name}
                  {!!item.estimatedPrepMinutes && (
                    <span className={`ml-2 text-vimdy-accent font-normal ${tvMode ? "text-base" : "text-xs"}`}>
                      {t("kitchen.card.estimatedTime", { minutes: item.estimatedPrepMinutes })}
                    </span>
                  )}
                </p>

                {(item.sizeName || extras.length > 0) && (
                  <div className="flex flex-wrap gap-2">
                    {item.sizeName && (
                      <span className={`${chipClass} border-vimdy-border bg-vimdy-surface text-vimdy-text`}>
                        {item.sizeName}
                      </span>
                    )}
                    {extras.map((extra, extraIndex) => (
                      <span
                        key={`${extra}-${extraIndex}`}
                        className={`${chipClass} border-vimdy-accent/50 bg-vimdy-accent/10 text-vimdy-accent`}
                      >
                        + {extra}
                      </span>
                    ))}
                  </div>
                )}

                {item.note && <NoteBox text={item.note} tvMode={tvMode} />}
              </div>
            </div>
          );
        })}
      </div>

      <div className={`mt-6 flex justify-between ${tvMode ? "text-lg" : "text-sm"}`}>
        <span className="text-vimdy-text-secondary">
          {order.items.length === 1
            ? t("kitchen.card.productCount_one", { count: order.items.length })
            : t("kitchen.card.productCount_other", { count: order.items.length })}
        </span>
        <span className="text-vimdy-accent font-bold">
          {money(order.total)}
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
             {t("kitchen.card.action.prepare")}
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
             {t("kitchen.card.action.ready")}
           </button>
        )}
        {onDeliver && (
          <VimdyButton
            onClick={onDeliver}
            variant="primary"
            size={tvMode ? "xl" : "lg"}
            icon={<CheckCircle2 size={tvMode ? 26 : 18} />}
          >
            {t("kitchen.card.action.deliver")}
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
            {t("kitchen.card.action.cancel")}
          </VimdyButton>
        )}
      </div>

    </div>
  );
}