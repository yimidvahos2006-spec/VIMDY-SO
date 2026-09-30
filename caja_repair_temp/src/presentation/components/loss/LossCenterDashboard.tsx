import React from "react";
import { useNavigate } from "react-router-dom";
import {
  AlertTriangle,
  ShieldAlert,
  TrendingDown,
  Wallet,
  CalendarDays,
  CalendarRange,
  CalendarClock,
  PackageX,
  Trophy,
  Lightbulb,
  Eye,
  ClipboardList,
  Boxes,
  Plus,
  History
} from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";

import {
  useLossCenter,
  LossRange,
  LOSS_RANGE_LABEL,
  RISK_LEVEL_LABEL,
  LossProductRow
} from "../../../core/store/useLossCenter";
import { LOSS_CATEGORY_LABEL, LOSS_CATEGORY_ORDER } from "../../../core/engines/lossCategoryLabels";
import { LossCategory } from "../../../core/entities/Entities";

const money = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;
const RANGES: LossRange[] = ["hoy", "semana", "mes", "año", "todo"];

const RISK_CLASS: Record<string, string> = {
  BAJO: "text-vimdy-success border-vimdy-success/30 bg-vimdy-success/10",
  MEDIO: "text-vimdy-warning border-vimdy-warning/30 bg-vimdy-warning/10",
  ALTO: "text-vimdy-danger border-vimdy-danger/30 bg-vimdy-danger/10"
};

export function LossCenterDashboard() {
  const navigate = useNavigate();
  const {
    loading,
    error,
    filters,
    setRange,
    setCategory,
    setProductId,
    setEmployeeId,
    categories,
    products,
    employeeNames,
    alwaysOnSummary,
    filteredSummary,
    lossByCategory,
    topAffectedProducts,
    alerts,
    recommendations,
    history,
    lossTimeSeries,
    monthlyComparison,
    lossByProductChart,
    hasAnyData,
    hasFilteredData
  } = useLossCenter();

  const goToInventory = () => navigate("/inventario");

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-11 w-36 rounded-xl" />
        </div>
        <SkeletonCards count={4} />
        <SkeletonCards count={4} />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <SkeletonPanel />
          <SkeletonPanel />
        </div>
      </div>
    );
  }

  const maxTime = Math.max(1, ...lossTimeSeries.map((b) => Math.abs(b.value)));
  const maxCategory = Math.max(1, ...lossByCategory.map((b) => Math.abs(b.value)));
  const maxProduct = Math.max(1, ...lossByProductChart.map((b) => Math.abs(b.value)));
  const maxMonth = Math.max(1, ...monthlyComparison.map((b) => Math.abs(b.value)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-vimdy-text">Centro de Pérdidas</h1>
        <p className="text-vimdy-text-secondary text-sm mt-1">
          Dónde está perdiendo dinero el negocio, por qué, y qué hacer al respecto.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {!hasAnyData ? (
        <EmptyState
          icon={<ShieldAlert size={28} />}
          title="Todavía no hay pérdidas registradas."
          description="Cuando registres una merma, un vencimiento u otra salida sin venta desde Inventario, aquí verás exactamente cuánto te cuesta y por qué."
        />
      ) : (
        <>
          {/* Resumen general — siempre visible */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard icon={<CalendarDays size={20} className="text-vimdy-danger" />} label="Pérdidas del día" value={money(alwaysOnSummary.day)} negative />
            <KpiCard icon={<CalendarRange size={20} className="text-vimdy-warning" />} label="Pérdidas de la semana" value={money(alwaysOnSummary.week)} negative />
            <KpiCard icon={<CalendarClock size={20} className="text-vimdy-warning" />} label="Pérdidas del mes" value={money(alwaysOnSummary.month)} negative />
            <KpiCard icon={<TrendingDown size={20} className="text-vimdy-danger" />} label="Pérdidas del año" value={money(alwaysOnSummary.year)} negative />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <KpiCard icon={<Wallet size={20} className="text-vimdy-accent" />} label="Dinero recuperable (evitable, del mes)" value={money(alwaysOnSummary.recoverable)} />
            <div className={`rounded-2xl border p-4 flex items-center gap-3 ${RISK_CLASS[alwaysOnSummary.riskLevel]}`}>
              <ShieldAlert size={20} />
              <div>
                <p className="text-xs opacity-80">Nivel de riesgo</p>
                <p className="text-xl font-bold">{RISK_LEVEL_LABEL[alwaysOnSummary.riskLevel]}</p>
              </div>
            </div>
          </div>

          {/* Filtros */}
          <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-4 space-y-3">
            <div className="flex flex-wrap gap-2">
              {RANGES.map((r) => (
                <button
                  key={r}
                  onClick={() => setRange(r)}
                  className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
                    filters.range === r
                      ? "bg-vimdy-danger text-white border-vimdy-danger"
                      : "bg-vimdy-surface text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-danger/50"
                  }`}
                >
                  {LOSS_RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FilterSelect
                label="Motivo"
                value={filters.category}
                onChange={(v) => setCategory(v as LossCategory | "all")}
                options={[
                  { value: "all", label: "Todos" },
                  ...LOSS_CATEGORY_ORDER.map((c) => ({ value: c, label: LOSS_CATEGORY_LABEL[c] }))
                ]}
              />
              <FilterSelect
                label="Producto"
                value={filters.productId}
                onChange={setProductId}
                options={[{ value: "all", label: "Todos" }, ...products.map((p) => ({ value: p.id, label: p.name }))]}
              />
              <FilterSelect
                label="Empleado"
                value={filters.employeeId}
                onChange={setEmployeeId}
                options={[{ value: "all", label: "Todos" }, ...employeeNames.map((name) => ({ value: name, label: name }))]}
              />
            </div>
          </div>

          {!hasFilteredData ? (
            <EmptyState
              icon={<ShieldAlert size={28} />}
              title="Sin pérdidas para estos filtros."
              description="Ajusta el rango, el motivo, el producto o el empleado para ver resultados."
            />
          ) : (
            <>
              {/* Resumen del alcance filtrado */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <KpiCard icon={<Wallet size={20} className="text-vimdy-danger" />} label="Valor perdido" value={money(filteredSummary.totalValue)} negative />
                <KpiCard icon={<PackageX size={20} className="text-vimdy-warning" />} label="Unidades perdidas" value={filteredSummary.totalQuantity.toString()} />
                <KpiCard icon={<History size={20} className="text-vimdy-accent" />} label="Movimientos" value={filteredSummary.movementsCount.toString()} />
              </div>

              {/* Alertas */}
              {alerts.length > 0 && (
                <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <AlertTriangle size={18} className="text-vimdy-warning" />
                    <h3 className="text-vimdy-text font-bold">Alertas</h3>
                  </div>
                  <div className="space-y-2">
                    {alerts.map((alert, i) => (
                      <div
                        key={i}
                        className={`flex items-start gap-2 text-sm px-3 py-2 rounded-xl border ${
                          alert.level === "RED"
                            ? "border-vimdy-danger/30 bg-vimdy-danger/10 text-vimdy-danger"
                            : alert.level === "ORANGE"
                            ? "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning"
                            : "border-vimdy-warning/30 bg-vimdy-warning/10 text-vimdy-warning"
                        }`}
                      >
                        <span>{alert.icon}</span>
                        <span>{alert.message}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Recomendaciones */}
              {recommendations.length > 0 && (
                <div className="rounded-2xl border border-vimdy-accent/20 bg-vimdy-accent/5 p-5">
                  <div className="flex items-center gap-2 mb-3">
                    <Lightbulb size={18} className="text-vimdy-accent" />
                    <h3 className="text-vimdy-text font-bold">Recomendaciones</h3>
                  </div>
                  <div className="space-y-2">
                    {recommendations.map((rec, i) => (
                      <p key={i} className="text-sm text-vimdy-text-secondary">
                        <span className="text-vimdy-accent font-semibold">{rec.productName}:</span> {rec.action}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Productos más afectados */}
              <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
                <div className="p-4 border-b border-vimdy-border flex items-center gap-2">
                  <Trophy size={16} className="text-vimdy-danger" />
                  <h3 className="text-vimdy-text font-bold">Top 10 productos más afectados</h3>
                </div>
                {topAffectedProducts.length === 0 ? (
                  <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos para este filtro.</p>
                ) : (
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-left text-vimdy-text-secondary border-b border-vimdy-border">
                        <th className="px-4 py-2 font-medium">Producto</th>
                        <th className="px-4 py-2 font-medium">Cantidad perdida</th>
                        <th className="px-4 py-2 font-medium">Valor perdido</th>
                        <th className="px-4 py-2 font-medium">Motivo principal</th>
                        <th className="px-4 py-2 font-medium"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {topAffectedProducts.map((row: LossProductRow, i) => (
                        <tr key={row.productId} className="border-b border-vimdy-border-subtle last:border-0">
                          <td className="px-4 py-2.5 text-vimdy-text font-medium">
                            <span className="text-vimdy-text-tertiary mr-2">#{i + 1}</span>
                            {row.name}
                            {row.costUnreliable && (
                              <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded-md bg-vimdy-warning/15 text-vimdy-warning border border-vimdy-warning/30">
                                Costo no confiable
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-2.5 text-vimdy-text-secondary">{row.quantityLost}</td>
                          <td className="px-4 py-2.5 font-semibold text-vimdy-danger">{money(row.valueLost)}</td>
                          <td className="px-4 py-2.5 text-vimdy-text-secondary">{row.mainReasonLabel}</td>
                          <td className="px-4 py-2.5 text-right">
                            <button
                              onClick={goToInventory}
                              aria-label="Ver en Inventario"
                              className="text-vimdy-text-tertiary hover:text-vimdy-accent transition-colors"
                            >
                              <Eye size={14} />
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>

              {/* Gráficas */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Pérdidas en el tiempo</h3>
                  {lossTimeSeries.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-16">Sin datos en este periodo.</p>
                  ) : (
                    <div className="flex items-end gap-1.5 h-[220px] overflow-x-auto">
                      {lossTimeSeries.map((bucket, index) => (
                        <div
                          key={index}
                          className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full"
                          title={`${bucket.label}: ${money(bucket.value)}`}
                        >
                          <div
                            className="w-full rounded-t-lg transition-all duration-500 hover:brightness-125"
                            style={{
                              height: `${Math.max((Math.abs(bucket.value) / maxTime) * 180, bucket.value !== 0 ? 4 : 0)}px`,
                              background:
                                // Fase 3 (5.2): antes 3 hex sueltos sin relación con
                                // la paleta oficial (#7f1d1d/#ef4444/#fca5a5). Ahora
                                // los 3 tonos se derivan de UN solo token
                                // (--vimdy-danger) con color-mix(), mismo patrón que
                                // el degradado de Ganancias.
                                "linear-gradient(to top, color-mix(in srgb, var(--vimdy-danger) 55%, black), var(--vimdy-danger), color-mix(in srgb, var(--vimdy-danger) 55%, white))"
                            }}
                          />
                          <span className="text-[10px] text-vimdy-text-tertiary mt-1 whitespace-nowrap">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Pérdidas por motivo</h3>
                  {lossByCategory.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
                  ) : (
                    <div className="space-y-3">
                      {lossByCategory.map(({ label, value }) => {
                        const pct = (Math.abs(value) / maxCategory) * 100;
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-vimdy-text-secondary truncate">{label}</span>
                              <span className="font-semibold text-vimdy-danger">{money(value)}</span>
                            </div>
                            <div className="h-2 rounded-full bg-vimdy-surface overflow-hidden">
                              <div className="h-full rounded-full bg-vimdy-danger" style={{ width: `${pct}%` }} />
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Pérdidas por producto (top 8)</h3>
                  {lossByProductChart.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
                  ) : (
                    <div className="flex items-end gap-3 h-[160px]">
                      {lossByProductChart.map((bucket) => (
                        <div
                          key={bucket.label}
                          className="flex-1 flex flex-col items-center justify-end h-full"
                          title={`${bucket.label}: ${money(bucket.value)}`}
                        >
                          <div
                            className="w-full rounded-t-lg bg-vimdy-danger/70 hover:bg-vimdy-danger-hover transition-colors"
                            style={{ height: `${Math.max((Math.abs(bucket.value) / maxProduct) * 130, 3)}px` }}
                          />
                          <span className="text-[10px] text-vimdy-text-tertiary mt-1 text-center truncate w-full">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Comparación entre meses</h3>
                  {monthlyComparison.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
                  ) : (
                    <div className="flex items-end gap-3 h-[160px]">
                      {monthlyComparison.map((bucket) => (
                        <div
                          key={bucket.label}
                          className="flex-1 flex flex-col items-center justify-end h-full"
                          title={`${bucket.label}: ${money(bucket.value)}`}
                        >
                          <div
                            className="w-full rounded-t-lg bg-vimdy-warning/70 hover:bg-vimdy-warning-hover transition-colors"
                            style={{ height: `${Math.max((Math.abs(bucket.value) / maxMonth) * 130, 3)}px` }}
                          />
                          <span className="text-[10px] text-vimdy-text-tertiary mt-1 text-center truncate w-full">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>

              {/* Historial */}
              <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
                <div className="p-4 border-b border-vimdy-border flex items-center gap-2">
                  <History size={16} className="text-vimdy-accent" />
                  <h3 className="text-vimdy-text font-bold">Historial</h3>
                </div>
                {history.length === 0 ? (
                  <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin movimientos para este filtro.</p>
                ) : (
                  <ul className="max-h-80 overflow-y-auto divide-y divide-vimdy-border-subtle">
                    {history.slice(0, 50).map((h) => (
                      <li key={h.id} className="flex items-center justify-between text-sm px-4 py-2.5">
                        <div className="min-w-0">
                          <p className="text-vimdy-text font-medium truncate">{h.productName}</p>
                          <p className="text-vimdy-text-tertiary text-xs truncate">
                            {h.reason} · {h.lossCategoryLabel} {h.performedBy ? `· ${h.performedBy}` : ""}
                          </p>
                        </div>
                        <div className="text-right flex-shrink-0 ml-3">
                          <p className="text-vimdy-danger font-semibold">-{h.quantity}</p>
                          <p className="text-vimdy-text-tertiary text-xs">{h.date.toLocaleDateString("es-CO")}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                )}
              </div>

              {/* Accesos rápidos */}
              <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5 flex flex-wrap gap-3">
                <VimdyButton variant="secondary" icon={<ClipboardList size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Ver Kardex
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<Eye size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Ver producto
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<Boxes size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Ver inventario
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<PackageX size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Registrar ajuste
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<Plus size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Crear compra
                </VimdyButton>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

function KpiCard({
  icon,
  label,
  value,
  negative
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  negative?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-vimdy-text-secondary text-xs">{label}</p>
          <p className={`text-xl font-bold truncate ${negative ? "text-vimdy-danger" : "text-vimdy-text"}`}>{value}</p>
        </div>
      </div>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="block">
      <span className="text-vimdy-text-secondary text-xs">{label}</span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="mt-1 w-full bg-vimdy-surface border border-vimdy-border rounded-xl px-3 py-2 text-sm text-vimdy-text focus:outline-none focus:border-vimdy-danger"
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    </label>
  );
}