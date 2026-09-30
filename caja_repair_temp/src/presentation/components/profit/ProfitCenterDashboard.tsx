import React from "react";
import { useNavigate } from "react-router-dom";
import {
  DollarSign,
  TrendingUp,
  TrendingDown,
  Percent,
  ShoppingBag,
  Factory,
  Wallet,
  Star,
  AlertTriangle,
  Trophy,
  Medal,
  Flame,
  ThumbsDown,
  Lightbulb,
  Eye,
  Pencil,
  BookOpen,
  ClipboardList,
  Boxes
} from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";

import {
  useProfitCenter,
  ProfitRange,
  PROFIT_RANGE_LABEL,
  ProfitProductRow
} from "../../../core/store/useProfitCenter";

const money = (value: number) => `$${Math.round(value).toLocaleString("es-CO")}`;
const RANGES: ProfitRange[] = ["hoy", "semana", "mes", "año", "todo"];

export function ProfitCenterDashboard() {
  const navigate = useNavigate();
  const {
    loading,
    error,
    filters,
    setRange,
    setCategoryId,
    setProductId,
    setEmployeeId,
    categories,
    products,
    employees,
    alwaysOnSummary,
    filteredSummary,
    starProduct,
    worstProduct,
    rankings,
    recommendations,
    alerts,
    profitTimeSeries,
    profitByCategory,
    profitByProduct,
    hasAnyData,
    hasFilteredData
  } = useProfitCenter();

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

  const maxTime = Math.max(1, ...profitTimeSeries.map((b) => Math.abs(b.value)));
  const maxCategory = Math.max(1, ...profitByCategory.map((b) => Math.abs(b.value)));
  const maxProduct = Math.max(1, ...profitByProduct.map((b) => Math.abs(b.value)));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-vimdy-text">Centro de Ganancias</h1>
        <p className="text-vimdy-text-secondary text-sm mt-1">
          No solo cuánto vendiste: dónde realmente ganas dinero.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {!hasAnyData ? (
        <EmptyState
          icon={<DollarSign size={28} />}
          title="Todavía no hay ventas registradas."
          description="En cuanto registres tu primera venta desde Caja, aquí verás qué producto te hace ganar más dinero."
        />
      ) : (
        <>
          {/* Ganancia día / semana / mes / año — siempre visible, sin importar los filtros */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <KpiCard
              icon={<DollarSign size={20} className="text-vimdy-success" />}
              label="Ganancia de hoy"
              value={money(alwaysOnSummary.day)}
            />
            <KpiCard
              icon={<TrendingUp size={20} className="text-vimdy-accent" />}
              label="Ganancia de la semana"
              value={money(alwaysOnSummary.week)}
            />
            <KpiCard
              icon={<Wallet size={20} className="text-vimdy-warning" />}
              label="Ganancia del mes"
              value={money(alwaysOnSummary.month)}
            />
            <KpiCard
              icon={<Trophy size={20} className="text-vimdy-ai" />}
              label="Ganancia del año"
              value={money(alwaysOnSummary.year)}
            />
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
                      ? "bg-vimdy-accent text-white border-vimdy-accent"
                      : "bg-vimdy-surface text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-accent/50"
                  }`}
                >
                  {PROFIT_RANGE_LABEL[r]}
                </button>
              ))}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <FilterSelect
                label="Categoría"
                value={filters.categoryId}
                onChange={setCategoryId}
                options={[{ value: "all", label: "Todas" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]}
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
                options={[{ value: "all", label: "Todos" }, ...employees.map((u) => ({ value: u.id, label: u.name }))]}
              />
            </div>
          </div>

          {!hasFilteredData ? (
            <EmptyState
              icon={<DollarSign size={28} />}
              title="Sin ventas para estos filtros."
              description="Ajusta el rango, la categoría, el producto o el empleado para ver resultados."
            />
          ) : (
            <>
              {/* Resumen del alcance filtrado */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <KpiCard
                  icon={<Percent size={20} className="text-vimdy-accent" />}
                  label="Margen promedio"
                  value={`${filteredSummary.averageMarginPercent}%`}
                />
                <KpiCard
                  icon={<ShoppingBag size={20} className="text-vimdy-warning" />}
                  label="Productos vendidos"
                  value={filteredSummary.unitsSold.toString()}
                />
                <KpiCard
                  icon={<Factory size={20} className="text-vimdy-warning" />}
                  label="Costo de producción"
                  value={money(filteredSummary.productionCost)}
                />
                <KpiCard
                  icon={<Wallet size={20} className="text-vimdy-success" />}
                  label="Utilidad neta"
                  value={money(filteredSummary.netProfit)}
                  highlight={filteredSummary.netProfit < 0 ? "negative" : "positive"}
                />
              </div>

              {/* Producto estrella / menos rentable */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {starProduct && (
                  <div className="rounded-2xl border border-vimdy-success/30 bg-vimdy-success/5 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <Star size={18} className="text-vimdy-success" />
                      <h3 className="text-vimdy-text font-bold">Producto estrella</h3>
                    </div>
                    <p className="text-2xl font-bold text-vimdy-text">{starProduct.name}</p>
                    <div className="grid grid-cols-3 gap-3 mt-4 text-sm">
                      <StatBlock label="Ganancia" value={money(starProduct.profit)} />
                      <StatBlock label="Vendidos" value={starProduct.unitsSold.toString()} />
                      <StatBlock label="Margen" value={`${starProduct.marginPercent}%`} />
                    </div>
                    <VimdyButton
                      variant="secondary"
                      icon={<Eye size={16} />}
                      onClick={goToInventory}
                      className="mt-4 text-sm px-4 py-2"
                    >
                      Ver producto
                    </VimdyButton>
                  </div>
                )}

                {worstProduct && (
                  <div className="rounded-2xl border border-vimdy-danger/30 bg-vimdy-danger/5 p-5">
                    <div className="flex items-center gap-2 mb-3">
                      <ThumbsDown size={18} className="text-vimdy-danger" />
                      <h3 className="text-vimdy-text font-bold">Producto menos rentable</h3>
                    </div>
                    <p className="text-2xl font-bold text-vimdy-text">{worstProduct.name}</p>
                    <div className="grid grid-cols-2 gap-3 mt-4 text-sm">
                      <StatBlock label="Ganancia" value={money(worstProduct.profit)} />
                      <StatBlock label="Margen" value={`${worstProduct.marginPercent}%`} />
                    </div>
                    <p className="text-vimdy-danger text-sm mt-3">{worstProduct.reason}</p>
                    <VimdyButton
                      variant="secondary"
                      icon={<Eye size={16} />}
                      onClick={goToInventory}
                      className="mt-4 text-sm px-4 py-2"
                    >
                      Ver producto
                    </VimdyButton>
                  </div>
                )}
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
                            : "border-vimdy-success/30 bg-vimdy-success/10 text-vimdy-success"
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
                        <span className="text-vimdy-accent font-semibold">{rec.productName}:</span>{" "}
                        {rec.action.replace(/^[^:]*: /, "")}
                      </p>
                    ))}
                  </div>
                </div>
              )}

              {/* Gráficas */}
              <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Utilidad en el tiempo</h3>
                  {profitTimeSeries.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-16">Sin datos en este periodo.</p>
                  ) : (
                    <div className="flex items-end gap-1.5 h-[220px] overflow-x-auto">
                      {profitTimeSeries.map((bucket, index) => (
                        <div
                          key={index}
                          className="flex-1 min-w-[10px] flex flex-col items-center justify-end h-full"
                          title={`${bucket.label}: ${money(bucket.value)}`}
                        >
                          <div
                            className={`w-full rounded-t-lg transition-all duration-500 hover:brightness-125 ${
                              bucket.value < 0 ? "bg-vimdy-danger/70" : ""
                            }`}
                            style={{
                              height: `${Math.max((Math.abs(bucket.value) / maxTime) * 180, bucket.value !== 0 ? 4 : 0)}px`,
                              background:
                                bucket.value < 0
                                  ? undefined
                                  // Fase 3 (5.2): antes 3 hex sueltos sin relación con
                                  // la paleta oficial (#059669/#10B981/#6EE7B7). Ahora
                                  // los 3 tonos del degradado se derivan de UN solo
                                  // token (--vimdy-success) con color-mix(), en vez de
                                  // inventar 3 valores nuevos fuera de tailwind.config.js.
                                  : "linear-gradient(to top, color-mix(in srgb, var(--vimdy-success) 55%, black), var(--vimdy-success), color-mix(in srgb, var(--vimdy-success) 55%, white))"
                            }}
                          />
                          <span className="text-xs text-vimdy-text-tertiary mt-1 whitespace-nowrap">{bucket.label}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                  <h3 className="text-vimdy-text font-bold mb-4">Utilidad por categoría</h3>
                  {profitByCategory.length === 0 ? (
                    <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
                  ) : (
                    <div className="space-y-3">
                      {profitByCategory.map(({ label, value }) => {
                        const pct = (Math.abs(value) / maxCategory) * 100;
                        return (
                          <div key={label}>
                            <div className="flex items-center justify-between text-sm mb-1">
                              <span className="text-vimdy-text-secondary truncate">{label}</span>
                              <span className={`font-semibold ${value < 0 ? "text-vimdy-danger" : "text-vimdy-text"}`}>
                                {money(value)}
                              </span>
                            </div>
                            <div className="h-2 rounded-full bg-vimdy-surface overflow-hidden">
                              <div
                                className={`h-full rounded-full ${value < 0 ? "bg-vimdy-danger" : "bg-vimdy-success"}`}
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

              <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
                <h3 className="text-vimdy-text font-bold mb-4">Utilidad por producto (top 8)</h3>
                {profitByProduct.length === 0 ? (
                  <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos.</p>
                ) : (
                  <div className="flex items-end gap-3 h-[160px]">
                    {profitByProduct.map((bucket) => (
                      <div
                        key={bucket.label}
                        className="flex-1 flex flex-col items-center justify-end h-full"
                        title={`${bucket.label}: ${money(bucket.value)}`}
                      >
                        <div
                          className="w-full rounded-t-lg bg-vimdy-accent/70 hover:bg-vimdy-accent-hover transition-colors"
                          style={{ height: `${Math.max((Math.abs(bucket.value) / maxProduct) * 130, 3)}px` }}
                        />
                        <span className="text-xs text-vimdy-text-tertiary mt-1 text-center truncate w-full">
                          {bucket.label}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Rankings */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <RankingTable
                  title="Top 10 más rentables"
                  icon={<Trophy size={16} className="text-vimdy-warning" />}
                  rows={rankings.topProfit}
                  valueLabel="Ganancia"
                  valueOf={(r) => money(r.profit)}
                  onAction={goToInventory}
                />
                <RankingTable
                  title="Top 10 mejor margen"
                  icon={<Medal size={16} className="text-vimdy-accent" />}
                  rows={rankings.topMargin}
                  valueLabel="Margen"
                  valueOf={(r) => `${r.marginPercent}%`}
                  onAction={goToInventory}
                />
                <RankingTable
                  title="Top 10 más vendidos"
                  icon={<Flame size={16} className="text-vimdy-warning" />}
                  rows={rankings.topUnits}
                  valueLabel="Unidades"
                  valueOf={(r) => r.unitsSold.toString()}
                  onAction={goToInventory}
                />
                <RankingTable
                  title="Top 10 con menor utilidad"
                  icon={<TrendingDown size={16} className="text-vimdy-danger" />}
                  rows={rankings.lowestProfit}
                  valueLabel="Ganancia"
                  valueOf={(r) => money(r.profit)}
                  negative
                  onAction={goToInventory}
                />
              </div>

              {/* Accesos rápidos */}
              <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5 flex flex-wrap gap-3">
                <VimdyButton variant="secondary" icon={<Pencil size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Editar precio
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<BookOpen size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Editar receta
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<ClipboardList size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Ver Kardex
                </VimdyButton>
                <VimdyButton variant="secondary" icon={<Boxes size={16} />} onClick={goToInventory} className="text-sm px-4 py-2">
                  Ver inventario
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
  highlight
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  highlight?: "positive" | "negative";
}) {
  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-4">
      <div className="flex items-center gap-3">
        <div className="w-11 h-11 rounded-xl bg-vimdy-surface flex items-center justify-center flex-shrink-0">{icon}</div>
        <div className="min-w-0">
          <p className="text-vimdy-text-secondary text-xs">{label}</p>
          <p
            className={`text-xl font-bold truncate ${
              highlight === "negative" ? "text-vimdy-danger" : highlight === "positive" ? "text-vimdy-success" : "text-vimdy-text"
            }`}
          >
            {value}
          </p>
        </div>
      </div>
    </div>
  );
}

function StatBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-vimdy-text-secondary text-xs">{label}</p>
      <p className="text-vimdy-text font-semibold">{value}</p>
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
        className="mt-1 w-full bg-vimdy-surface border border-vimdy-border rounded-xl px-3 py-2 text-sm text-vimdy-text focus:outline-none focus:border-vimdy-accent"
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

function RankingTable({
  title,
  icon,
  rows,
  valueLabel,
  valueOf,
  negative,
  onAction
}: {
  title: string;
  icon: React.ReactNode;
  rows: ProfitProductRow[];
  valueLabel: string;
  valueOf: (row: ProfitProductRow) => string;
  negative?: boolean;
  onAction: () => void;
}) {
  return (
    <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
      <div className="p-4 border-b border-vimdy-border flex items-center gap-2">
        {icon}
        <h3 className="text-vimdy-text font-bold">{title}</h3>
      </div>
      {rows.length === 0 ? (
        <p className="text-vimdy-text-tertiary text-sm text-center py-10">Sin datos para este ranking.</p>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-vimdy-text-secondary border-b border-vimdy-border">
              <th className="px-4 py-2 font-medium">Producto</th>
              <th className="px-4 py-2 font-medium">{valueLabel}</th>
              <th className="px-4 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={row.productId} className="border-b border-vimdy-border-subtle last:border-0">
                <td className="px-4 py-2.5 text-vimdy-text font-medium">
                  <span className="text-vimdy-text-tertiary mr-2">#{i + 1}</span>
                  {row.name}
                </td>
                <td
                  className={`px-4 py-2.5 font-semibold ${
                    negative && row.profit < 0 ? "text-vimdy-danger" : "text-vimdy-accent"
                  }`}
                >
                  {valueOf(row)}
                </td>
                <td className="px-4 py-2.5 text-right">
                  <button
                    onClick={onAction}
                    aria-label="Ver detalle"
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
  );
}