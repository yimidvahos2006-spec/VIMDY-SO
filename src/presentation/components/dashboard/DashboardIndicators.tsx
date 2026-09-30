import React, { type ReactNode } from "react";

import { useDashboard } from "../../../core/store/useDashboard";
import { useTranslation } from "../../../core/i18n/useTranslation";
import { useDashboardAdaptive } from "../../../core/dashboard/adaptive/useDashboardAdaptive";
import { getVisibleDashboardIndicators, type DashboardIndicatorId } from "../../../core/dashboard/adaptive/DashboardAdaptiveView";
import { TrendBadge } from "../ui/TrendBadge";
import { healthColorClass, healthLabel } from "./managerPriorities";
import type { BusinessSnapshot } from "../../../core/types/CopilotTypes";

function money(value: number, currency: string): string {
  return `${Math.round(value).toLocaleString("es-CO")} ${currency}`;
}

export const DashboardIndicators = React.memo(function DashboardIndicators({ snapshot, hasEnoughData }: { snapshot: BusinessSnapshot | null; hasEnoughData: boolean }) {
  const { data, yesterday } = useDashboard();
  const adaptive = useDashboardAdaptive();
  const { t, language } = useTranslation();
  const currency = snapshot?.currency ?? "COP";
  const locale = language === "en" ? "en-US" : language === "pt" ? "pt-BR" : "es-CO";
  const visible = getVisibleDashboardIndicators(adaptive);

  const cards: Record<DashboardIndicatorId, ReactNode> = {
    sales: (
      <IndicatorCard
        title={t("dashboard.indicator.sales")}
        value={money(data.sales, currency)}
        variation={<TrendBadge current={data.sales} previous={yesterday.sales} hideIcon />}
      />
    ),
    profit: (
      <IndicatorCard
        title={t("dashboard.indicator.profit")}
        value={snapshot ? money(snapshot.todayProfit, currency) : "—"}
        variation={<span className="text-vimdy-text-tertiary">{t("dashboard.indicator.profitToday")}</span>}
      />
    ),
    cash: (
      <IndicatorCard
        title={t("dashboard.indicator.cash")}
        value={data.cashStatus === "CLOSED" && data.cashCountedAmount !== null
          ? money(data.cashCountedAmount, currency)
          : "—"}
        variation={
          <span className="text-vimdy-text-tertiary">
            {data.cashStatus === "CLOSED" && data.cashDifference !== null
              ? t("dashboard.indicator.cashMovedToday", { amount: money(data.cashDifference, currency) })
              : "—"}
          </span>
        }
      />
    ),
    orders: (
      <IndicatorCard
        title={t("dashboard.indicator.orders")}
        value={data.orders.toLocaleString(locale)}
        variation={<TrendBadge current={data.orders} previous={yesterday.orders} hideIcon />}
      />
    ),
    health: (
      <IndicatorCard
        title={t("dashboard.indicator.health")}
        value={snapshot ? `${snapshot.healthScore}/100` : "—"}
        variation={
          <span className={snapshot ? healthColorClass(snapshot.healthScore) : "text-vimdy-text-tertiary"}>
            {snapshot ? healthLabel(snapshot.healthScore, t) : t("dashboard.indicator.analyzing")}
          </span>
        }
      />
    ),
  };

  if (!adaptive.isReady) return null;
  if (visible.length === 0) {
    return (
      <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background/40 px-5 py-6 text-sm text-vimdy-text-tertiary">
        {hasEnoughData ? t("dashboard.indicator.analyzing") : t("dashboard.gerente.notEnoughData1")}
      </div>
    );
  }

  return (
    <div className={`grid grid-cols-1 gap-6 sm:grid-cols-2 ${visible.length >= 4 ? "xl:grid-cols-4" : visible.length === 3 ? "xl:grid-cols-3" : "xl:grid-cols-2"}`}>
      {visible.map((id) => <React.Fragment key={id}>{cards[id]}</React.Fragment>)}
    </div>
  );
});

interface IndicatorCardProps {
  title: string;
  value: string;
  variation: ReactNode;
}

const IndicatorCard = React.memo(function IndicatorCard({ title, value, variation }: IndicatorCardProps) {
  return (
    <div className="h-[172px] flex flex-col justify-between rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface shadow-vimdy-xs p-6">
      <p className="text-xs font-semibold tracking-widest text-vimdy-text-secondary uppercase">{title}</p>
      <p className="text-3xl font-bold text-vimdy-text truncate">{value}</p>
      <p className="text-sm font-medium">{variation}</p>
    </div>
  );
});