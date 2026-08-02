import React from "react";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";

import { useTranslation } from "../../../core/i18n/useTranslation";

interface Props {
  current: number;
  previous: number;
  /** Si es true, invierte los colores (útil para métricas donde bajar es bueno). */
  invert?: boolean;
  /**
   * PASO 1.3 (KPIs): las tarjetas de indicadores solo permiten
   * título + valor + una línea de variación, sin ícono. El resto de usos
   * de TrendBadge conserva el ícono por defecto.
   */
  hideIcon?: boolean;
}

/**
 * Muestra el cambio porcentual real entre el valor actual y el de ayer,
 * con color e ícono según si el rendimiento fue positivo, negativo o
 * neutro. Si todavía no hay dato de ayer (primer día usando VIMDY),
 * lo dice en vez de inventar un porcentaje.
 */
export function TrendBadge({ current, previous, invert = false, hideIcon = false }: Props) {
  const { t } = useTranslation();

  if (previous === 0) {
    if (current === 0) {
      return (
        <span className="inline-flex items-center gap-1.5 text-vimdy-text-tertiary text-sm">
          {!hideIcon && <Minus size={16} />}
          {t("dashboard.indicator.trend.noYesterdayData")}
        </span>
      );
    }

    return (
      <span className="inline-flex items-center gap-1.5 text-vimdy-accent text-sm font-semibold">
        {!hideIcon && <TrendingUp size={16} />}
        {t("dashboard.indicator.trend.newToday")}
      </span>
    );
  }

  const change = ((current - previous) / previous) * 100;
  const isFlat = Math.abs(change) < 0.5;
  const isPositive = invert ? change < 0 : change > 0;

  const colorClass = isFlat
    ? "text-vimdy-text-secondary"
    : isPositive
    ? "text-vimdy-success"
    : "text-vimdy-danger";

  const Icon = isFlat ? Minus : change > 0 ? TrendingUp : TrendingDown;

  return (
    <span className={`inline-flex items-center gap-1.5 text-sm font-bold ${colorClass}`}>
      {!hideIcon && <Icon size={16} />}
      {isFlat
        ? t("dashboard.indicator.trend.sameAsYesterday")
        : t("dashboard.indicator.trend.vsYesterday", { change: `${change > 0 ? "+" : ""}${change.toFixed(1)}%` })}
    </span>
  );
}