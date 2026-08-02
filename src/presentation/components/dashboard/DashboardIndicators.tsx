import type { ReactNode } from "react";

import { useDashboard } from "../../../core/store/useDashboard";
import { useBusinessSnapshot } from "../../../hooks/useBusinessSnapshot";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { TrendBadge } from "../ui/TrendBadge";
import { healthColorClass, healthLabel } from "./managerPriorities";

function money(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString("es-CO")} ${currency}`;
}

/**
 * Bloque 2 del Dashboard (VIMDY Experience 1.0 — Dashboard V3, Paso 1.3).
 * ---------------------------------------------------------------------------
 * Cinco KPIs, cinco preguntas — no cinco tarjetas bonitas:
 *   1. Ventas    -> ¿cuánto dinero vendí hoy?
 *   2. Ganancia  -> ¿cuánto dinero realmente gané? (no ventas: ganancia real,
 *      precio - costo, ya calculada por BusinessAnalyzer).
 *   3. Caja      -> ¿cuánto efectivo tengo disponible? Balance REAL de
 *      CashEngine (snapshot.cash.balance) — antes esta tarjeta mostraba
 *      data.cashAmount, que solo acumulaba las ventas del día y por eso
 *      podía contradecir la caja real si hubo un fondo inicial, un retiro
 *      o un gasto. Ahora dice exactamente lo mismo que el módulo de Caja.
 *   4. Pedidos   -> ¿cuántos pedidos he atendido?
 *   5. Salud     -> ¿qué tan saludable está el negocio?
 *
 * Cada tarjeta muestra ÚNICAMENTE título + valor + una línea de variación,
 * sin íconos, sin gráficos, sin colores llamativos y con exactamente la
 * misma altura, ancho, padding, borde, sombra y tipografía. El componente
 * no calcula nada: todo sale ya resuelto de BusinessAnalyzer (vía
 * useBusinessSnapshot) o del DashboardEngine (vía useDashboard/dashboardStore,
 * que ya reconcilia sales/orders y su valor de ayer con datos reales).
 */
export function DashboardIndicators() {
  const { data, yesterday } = useDashboard();
  const { snapshot } = useBusinessSnapshot();
  const { t, language } = useTranslation();
  const currency = snapshot?.currency ?? "COP";
  const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-6">

      <IndicatorCard
        title={t("dashboard.indicator.sales")}
        value={money(data.sales, currency)}
        variation={<TrendBadge current={data.sales} previous={yesterday.sales} hideIcon />}
      />

      <IndicatorCard
        title={t("dashboard.indicator.profit")}
        value={snapshot ? money(snapshot.todayProfit, currency) : "—"}
        variation={<span className="text-vimdy-text-tertiary">{t("dashboard.indicator.profitToday")}</span>}
      />

      <IndicatorCard
        title={t("dashboard.indicator.cash")}
        value={snapshot ? money(snapshot.cash.balance, currency) : "—"}
        variation={
          <span className="text-vimdy-text-tertiary">
            {snapshot ? t("dashboard.indicator.cashMovedToday", { amount: money(snapshot.cash.todayBalance, currency) }) : "—"}
          </span>
        }
      />

      <IndicatorCard
        title={t("dashboard.indicator.orders")}
        value={data.orders.toLocaleString(locale)}
        variation={<TrendBadge current={data.orders} previous={yesterday.orders} hideIcon />}
      />

      <IndicatorCard
        title={t("dashboard.indicator.health")}
        value={snapshot ? `${snapshot.healthScore}/100` : "—"}
        variation={
          <span className={snapshot ? healthColorClass(snapshot.healthScore) : "text-vimdy-text-tertiary"}>
            {snapshot ? healthLabel(snapshot.healthScore, t) : t("dashboard.indicator.analyzing")}
          </span>
        }
      />

    </div>
  );
}

interface IndicatorCardProps {
  title: string;
  value: string;
  variation: ReactNode;
}

/**
 * Misma altura, ancho, padding, borde, sombra y tipografía para las 5
 * tarjetas, sin excepción. Nada de íconos ni gráficos: solo texto.
 */
function IndicatorCard({ title, value, variation }: IndicatorCardProps) {
  return (
    <div className="h-[172px] flex flex-col justify-between rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface shadow-vimdy-xs p-6">
      <p className="text-xs font-semibold tracking-widest text-vimdy-text-secondary uppercase">
        {title}
      </p>
      <p className="text-3xl font-bold text-vimdy-text truncate">{value}</p>
      <p className="text-sm font-medium">{variation}</p>
    </div>
  );
}