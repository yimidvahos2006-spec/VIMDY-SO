import React from "react";
import { AlertTriangle, Clock3 } from "lucide-react";

import { useTranslation } from "../../../../core/i18n/useTranslation";
import { splitElapsed } from "../../../../core/services/kitchenDelay";
import { useKitchenDelay } from "../../../../hooks/useKitchenClock";

interface Props {
  createdAt: Date;

  /**
   * Meta de este pedido en minutos (el tiempo del plato más demorado).
   * Sin valor se usa la meta por defecto de 15 minutos.
   */
  estimatedMinutes?: number;

  /** true en Modo TV: número de temporizador más grande, visible a distancia. */
  tvMode?: boolean;
}

/**
 * Cronómetro del pedido. El tiempo viene del reloj compartido de Cocina
 * (useKitchenClock): se calcula desde el primer dibujo, así que nunca
 * aparece "0m 0s" de pasada, y avanza al mismo ritmo en todas las tarjetas.
 *
 * El color NO es la única señal: cuando el pedido está por vencer o ya
 * va demorado también aparece un texto ("POR VENCER", "DEMORADO +3 min").
 */
export function KitchenOrderTimer({ createdAt, estimatedMinutes, tvMode = false }: Props) {
  const { t } = useTranslation();
  const { level, elapsedSeconds, overdueSeconds } = useKitchenDelay(createdAt, estimatedMinutes);
  const { minutes, seconds } = splitElapsed(elapsedSeconds);

  const color =
    level === "DELAYED"
      ? "text-vimdy-danger"
      : level === "WARNING"
      ? "text-vimdy-warning"
      : "text-vimdy-success";

  const overdueMinutes = Math.floor(overdueSeconds / 60);

  const label =
    level === "DELAYED"
      ? overdueMinutes > 0
        ? t("kitchen.timer.delayedBy", { minutes: overdueMinutes })
        : t("kitchen.timer.delayed")
      : level === "WARNING"
      ? t("kitchen.timer.warning")
      : null;

  return (
    <div className="flex items-center gap-3 flex-wrap">
      <div className="flex items-center gap-2">
        <Clock3 size={tvMode ? 26 : 18} className={color} />

        {/* tabular-nums: todos los dígitos miden lo mismo, así el número no
            "baila" de ancho cada segundo. */}
        <span className={`font-bold tabular-nums ${color} ${tvMode ? "text-3xl" : ""}`}>
          {t("kitchen.timer.format", {
            minutes,
            seconds: String(seconds).padStart(2, "0")
          })}
        </span>
      </div>

      {label && (
        <span
          className={`flex items-center gap-1 rounded-lg border font-bold uppercase tracking-wide ${color} ${
            level === "DELAYED"
              ? "bg-vimdy-danger/15 border-vimdy-danger/50"
              : "bg-vimdy-warning/15 border-vimdy-warning/50"
          } ${tvMode ? "text-base px-3 py-1.5" : "text-xs px-2 py-1"}`}
        >
          <AlertTriangle size={tvMode ? 18 : 12} />
          {label}
        </span>
      )}
    </div>
  );
}