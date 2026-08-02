import React from "react";
import {
  DollarSign,
  ShoppingBag,
  Receipt,
  Clock,
  Download,
  TrendingUp,
  TrendingDown,
  Minus,
  Trophy,
  Users,
  Wallet
} from "lucide-react";
import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";

import { useReports, RANGE_LABEL, ReportRange } from "../../../core/store/useReports";
import { useTranslation } from "../../../core/i18n/useTranslation";

const RANGES: ReportRange[] = ["hoy", "7d", "30d", "mes", "todo"];

export function ReportsDashboard() {
  const { money } = useTranslation();

  const {
    loading,
    error,
    range,
    setRange,
    sales,
    summary,
    topProducts,
    topCustomers,
    dailySeries,
    hourlySeries,
    paymentMethodBreakdown,
    exportCsv
  } = useReports();

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    );
  }

  const TrendIcon =
    summary.analysis.trend === "UP" ? TrendingUp : summary.analysis.trend === "DOWN" ? TrendingDown : Minus;
  const trendColor =
    summary.analysis.trend === "UP"
      ? "text-vimdy-success"
      : summary.analysis.trend === "DOWN"
      ? "text-vimdy-danger"
      : "text-vimdy-text-secondary";

  const maxDay = Math.max(1, ...dailySeries.map((d) => d.value));
  const maxHour = Math.max(1, ...hourlySeries.map((h) => h.value));

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-vimdy-text">Reportes</h1>
          <p className="text-vimdy-text-secondary text-sm mt-1">
            Ventas, productos y clientes, calculados sobre datos reales del negocio.
          </p>
        </div>
        <VimdyButton
          onClick={exportCsv}
          disabled={sales.length === 0}
          variant="primary"
          icon={<Download size={18} />}
          className="self-start sm:self-auto"
        >
          Exportar CSV
        </VimdyButton>
      </div>

      {error && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {/* Selector de rango */}
      <div className="flex flex-wrap gap-2">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => setRange(r)}
            className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
              range === r
                ? "bg-vimdy-accent text-white border-vimdy-accent"
                : "bg-vimdy-surface-hover text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-accent/50"
            }`}
          >
            {RANGE_LABEL[r]}
          </button>
        ))}
      </div>

      {sales.length === 0 ? (
        <EmptyState
          icon={<Receipt size={28} />}
          title="No hay ventas en este período."
          description="Elige otro rango de fechas arriba, o vuelve cuando registres tu primera venta desde Caja."
        />
      ) : (
        <>
      {/* KPIs */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard
          icon={<DollarSign size={20} className="text-vimdy-success" />}
          label="Total vendido"
          value={money(summary.analysis.totalSales)}
          footer={
            <span className={`flex items-center gap-1 text-xs font-semibold ${trendColor}`}>
              <TrendIcon size={13} />
              vs. periodo anterior
            </span>
          }
        />
        <KpiCard
          icon={<Receipt size={20} className="text-vimdy-accent" />}
          label="Pedidos"
          value={summary.analysis.totalOrders.toString()}
        />
        <KpiCard
          icon={<ShoppingBag size={20} className="text-vimdy-warning" />}
          label="Ticket promedio"
          value={money(summary.analysis.averageTicket)}
        />
        <KpiCard
          icon={<Clock size={20} className="text-vimdy-ai" />}
          label="Hora pico"
          value={sales.length ? `${summary.analysis.bestHour}:00` : "—"}
        />
      </div>

      {/* Recomendación IA */}
      <div className="rounded-2xl border border-vimdy-accent/20 bg-vimdy-accent/5 px-5 py-4">
        <p className="text-vimdy-accent text-sm font-semibold">Recomendación</p>
        <p className="text-vimdy-text-secondary text-sm mt-1">{summary.recommendation}</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Ventas por día */}
        <div className="lg:col-span-2 rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
          <h3 className="text-vimdy-text font-bold mb-4">Ventas por día</h3>
          {dailySeries.length === 0 || sales.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-sm text-center py-16">
              No hay ventas registradas en este periodo.
            </p>
          ) : (
            <div className="flex items-end gap-1.5 h-[220px] overflow-x-auto">
              {dailySeries.map((day, index) => (
                <div
                  key={index}
                  className="flex-1 min-w-[8px] flex flex-col items-center justify-end h-full"
                  title={`${day.label}: ${money(day.value)}`}
                >
                  <div
                    className="w-full rounded-t-lg transition-all duration-500 hover:brightness-125"
                    style={{
                      height: `${Math.max((day.value / maxDay) * 180, day.value > 0 ? 4 : 0)}px`,
                      background:
                        // Fase 3 (5.2): antes 3 hex sueltos (#0EA5E9/#38BDF8/#A5F3FC).
                        // El del medio (#38BDF8) es justo "VIMDY BLUE" — documentado en
                        // 01_COLOR_SYSTEM.md pero nunca implementado como token real
                        // hasta ahora (agregado en tailwind.config.js + index.css como
                        // --vimdy-blue). Mismo patrón color-mix() que Ganancias/Pérdidas.
                        "linear-gradient(to top, color-mix(in srgb, var(--vimdy-blue) 55%, black), var(--vimdy-blue), color-mix(in srgb, var(--vimdy-blue) 55%, white))"
                    }}
                  />
                  <span className="text-xs text-vimdy-text-tertiary mt-1 whitespace-nowrap">{day.label}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Métodos de pago */}
        <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
          <h3 className="text-vimdy-text font-bold mb-4 flex items-center gap-2">
            <Wallet size={16} className="text-vimdy-text-secondary" />
            Métodos de pago
          </h3>
          {paymentMethodBreakdown.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
          ) : (
            <div className="space-y-3">
              {paymentMethodBreakdown.map(({ method, total }) => {
                const pct = summary.analysis.totalSales > 0 ? (total / summary.analysis.totalSales) * 100 : 0;
                return (
                  <div key={method}>
                    <div className="flex items-center justify-between text-sm mb-1">
                      <span className="text-vimdy-text-secondary capitalize">{method}</span>
                      <span className="text-vimdy-text font-semibold">{money(total)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-vimdy-surface overflow-hidden">
                      <div
                        className="h-full rounded-full bg-vimdy-accent"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Ventas por hora */}
      <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
        <h3 className="text-vimdy-text font-bold mb-4">Ventas por hora del día</h3>
        {sales.length === 0 ? (
          <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
        ) : (
          <div className="flex items-end gap-1 h-[140px]">
            {hourlySeries.map((h) => (
              <div
                key={h.hour}
                className="flex-1 flex flex-col items-center justify-end h-full"
                title={`${h.hour}:00 — ${money(h.value)}`}
              >
                <div
                  className="w-full rounded-t bg-vimdy-accent/70 hover:bg-vimdy-accent-hover transition-colors"
                  style={{ height: `${Math.max((h.value / maxHour) * 110, h.value > 0 ? 3 : 0)}px` }}
                />
                <span className="text-xs text-vimdy-text-tertiary mt-1">{h.hour}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top productos */}
        <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
          <div className="p-4 border-b border-vimdy-border flex items-center gap-2">
            <Trophy size={16} className="text-vimdy-warning" />
            <h3 className="text-vimdy-text font-bold">Productos más vendidos</h3>
          </div>
          {topProducts.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin ventas en este periodo.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-vimdy-text-secondary border-b border-vimdy-border">
                  <th className="px-4 py-2 font-medium">Producto</th>
                  <th className="px-4 py-2 font-medium">Cant.</th>
                  <th className="px-4 py-2 font-medium">Ingresos</th>
                </tr>
              </thead>
              <tbody>
                {topProducts.map((p, i) => (
                  <tr key={p.productId} className="border-b border-vimdy-border-subtle last:border-0">
                    <td className="px-4 py-2.5 text-vimdy-text font-medium">
                      <span className="text-vimdy-text-tertiary mr-2">#{i + 1}</span>
                      {p.name}
                    </td>
                    <td className="px-4 py-2.5 text-vimdy-text-secondary">{p.quantity}</td>
                    <td className="px-4 py-2.5 text-vimdy-accent font-semibold">{money(p.revenue)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* Top clientes */}
        <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
          <div className="p-4 border-b border-vimdy-border flex items-center gap-2">
            <Users size={16} className="text-vimdy-accent" />
            <h3 className="text-vimdy-text font-bold">Mejores clientes</h3>
          </div>
          {topCustomers.length === 0 ? (
            <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin clientes con compras en este periodo.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-vimdy-text-secondary border-b border-vimdy-border">
                  <th className="px-4 py-2 font-medium">Cliente</th>
                  <th className="px-4 py-2 font-medium">Total comprado</th>
                </tr>
              </thead>
              <tbody>
                {topCustomers.map((c, i) => (
                  <tr key={c.customerId} className="border-b border-vimdy-border-subtle last:border-0">
                    <td className="px-4 py-2.5 text-vimdy-text font-medium">
                      <span className="text-vimdy-text-tertiary mr-2">#{i + 1}</span>
                      {c.name}
                    </td>
                    <td className="px-4 py-2.5 text-vimdy-accent font-semibold">{money(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  footer
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  footer?: React.ReactNode;
}) {
  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-vimdy-text-secondary text-xs">{label}</p>
          <p className="text-vimdy-text text-xl font-bold truncate">{value}</p>
        </div>
      </div>
      {footer && <div className="mt-2">{footer}</div>}
    </div>
  );
}