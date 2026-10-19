import React from "react";
import { ArrowLeft, Download, Minus, Receipt, TrendingDown, TrendingUp } from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import { SkeletonCards } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";
import { useTranslation } from "../../../core/i18n/useTranslation";
import type { MonthListItem, MonthReport } from "../../../core/services/monthlyReports";
import { changeTrend, formatChangePct } from "../../../core/services/monthlyReportsDownload";

interface Props {
  loading: boolean;
  error: string | null;
  downloadError: string | null;
  months: MonthListItem[];
  openReport: MonthReport | null;
  canExport: boolean;
  onOpen: (monthKey: string) => void;
  onBack: () => void;
  onDownloadMonth: (monthKey: string) => void;
  onDownloadWeek: (monthKey: string, weekIndex: number) => void;
}

export function MonthlyReportsSection({
  loading,
  error,
  downloadError,
  months,
  openReport,
  canExport,
  onOpen,
  onBack,
  onDownloadMonth,
  onDownloadWeek
}: Props) {
  const { money } = useTranslation();

  const alerts = (
    <>
      {error && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}
      {downloadError && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {downloadError}
        </div>
      )}
    </>
  );

  if (loading) {
    return (
      <div className="space-y-4">
        <SkeletonCards count={4} />
      </div>
    );
  }

  /* ───────────── Detalle de un mes: sus semanas ───────────── */
  if (openReport) {
    const hasSales = openReport.summary.tickets > 0;
    return (
      <div className="space-y-4">
        {alerts}
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <button
              type="button"
              onClick={onBack}
              className="flex items-center gap-1.5 text-sm text-vimdy-text-secondary hover:text-vimdy-text mb-2"
            >
              <ArrowLeft size={16} />
              Todos los meses
            </button>
            <h2 className="text-2xl font-bold text-vimdy-text">{openReport.label}</h2>
            <p className="text-vimdy-text-secondary text-sm mt-1">
              {money(openReport.summary.sales)} · {openReport.summary.tickets}{" "}
              {openReport.summary.tickets === 1 ? "venta" : "ventas"}
            </p>
            <div className="mt-1">
              <Change pct={openReport.changePct} />
            </div>
          </div>
          {canExport && (
            <VimdyButton
              variant="secondary"
              size="sm"
              icon={<Download size={16} />}
              disabled={!hasSales}
              onClick={() => onDownloadMonth(openReport.monthKey)}
              className="self-start sm:self-auto"
            >
              Descargar mes
            </VimdyButton>
          )}
        </div>

        <p className="text-vimdy-text-tertiary text-xs">
          Las semanas van de lunes a domingo. La primera y la última se recortan al mes, así que su suma
          es exactamente el total del mes.
        </p>

        <div className="space-y-2">
          {openReport.weeks.map((week) => (
            <div
              key={week.index}
              className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover px-4 py-3 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3"
            >
              <div className="min-w-0">
                <p className="text-vimdy-text font-semibold">{week.label}</p>
                <p className="text-vimdy-text-secondary text-sm">
                  {money(week.summary.sales)} · {week.summary.tickets}{" "}
                  {week.summary.tickets === 1 ? "venta" : "ventas"}
                </p>
              </div>
              {canExport && (
                <VimdyButton
                  variant="secondary"
                  size="sm"
                  icon={<Download size={16} />}
                  disabled={week.summary.tickets === 0}
                  onClick={() => onDownloadWeek(openReport.monthKey, week.index)}
                  className="self-start sm:self-auto"
                >
                  Descargar
                </VimdyButton>
              )}
            </div>
          ))}
        </div>
      </div>
    );
  }

  /* ───────────── Lista de meses: una tarjeta por mes ───────────── */
  if (months.length === 0) {
    return (
      <EmptyState
        icon={<Receipt size={28} />}
        title="Todavía no hay meses para mostrar."
        description="Cuando registres tu primera venta desde Caja, aparecerá aquí su mes."
      />
    );
  }

  return (
    <div className="space-y-4">
      {alerts}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
        {months.map((m) => (
          <div
            key={m.monthKey}
            className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-4 flex flex-col gap-2"
          >
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-vimdy-text font-bold">{m.label}</h3>
              {m.isCurrent && (
                <span className="text-xs font-semibold text-vimdy-accent">En curso</span>
              )}
            </div>
            <p className="text-vimdy-text text-xl font-bold truncate">{money(m.sales)}</p>
            <p className="text-vimdy-text-secondary text-sm">
              {m.tickets} {m.tickets === 1 ? "venta" : "ventas"}
            </p>
            <Change pct={m.changePct} />
            <div className="flex items-center gap-2 mt-1">
              <VimdyButton variant="ghost" size="sm" onClick={() => onOpen(m.monthKey)}>
                Ver semanas
              </VimdyButton>
              {canExport && (
                <VimdyButton
                  variant="secondary"
                  size="sm"
                  icon={<Download size={16} />}
                  disabled={m.tickets === 0}
                  onClick={() => onDownloadMonth(m.monthKey)}
                >
                  Descargar
                </VimdyButton>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Change({ pct }: { pct: number | null }) {
  const text = formatChangePct(pct);
  const trend = changeTrend(pct);
  if (text === null || trend === null) {
    return <span className="text-xs text-vimdy-text-tertiary">Sin mes anterior para comparar</span>;
  }
  const Icon = trend === "up" ? TrendingUp : trend === "down" ? TrendingDown : Minus;
  const color =
    trend === "up" ? "text-vimdy-success" : trend === "down" ? "text-vimdy-danger" : "text-vimdy-text-secondary";
  return (
    <span className={`flex items-center gap-1 text-xs font-semibold ${color}`}>
      <Icon size={13} />
      {text} vs. mes anterior
    </span>
  );
}
