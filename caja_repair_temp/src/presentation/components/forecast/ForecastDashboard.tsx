import React from "react";
import { useNavigate } from "react-router-dom";
import { TrendingUp, Package, AlertTriangle, CalendarDays, ShoppingCart, Sparkles, Info } from "lucide-react";

import { EmptyState } from "../ui/EmptyState";
import { Skeleton, SkeletonCards, SkeletonPanel } from "../ui/Skeleton";
import { VimdyButton } from "../ui/VimdyButton";

import { useForecast } from "../../../hooks/useForecast";

function formatCurrency(value: number): string {
  return `$${Math.round(value).toLocaleString("es-CO")}`;
}

/**
 * ForecastDashboard — VIMDY FASE 5, PASO 2.8 (Pronóstico Inteligente).
 * ---------------------------------------------------------------------------
 * Traduce ForecastEngine a pantalla: responde las 5 preguntas del negocio
 * ("cuánto venderé mañana", "qué producto va a pegar más", "qué se me va a
 * acabar primero", "cuál es mi mejor día" y "qué compra debo adelantar")
 * con la explicación de en qué datos se basó cada respuesta — nunca solo
 * el número, siempre el porqué.
 */
export function ForecastDashboard() {
  const navigate = useNavigate();
  const { summary, loading, error } = useForecast();

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-56" />
        <SkeletonCards count={3} />
        <SkeletonPanel />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-vimdy-text flex items-center gap-2">
          <Sparkles size={26} className="text-vimdy-accent" />
          Pronóstico Inteligente
        </h1>
        <p className="text-vimdy-text-secondary text-sm mt-1">
          Qué esperar mañana, calculado con tus ventas e inventario reales — nunca un número inventado.
        </p>
      </div>

      {error && (
        <div className="rounded-xl border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-4 py-3">
          {error}
        </div>
      )}

      {summary && !summary.hasEnoughData ? (
        <EmptyState
          icon={<TrendingUp size={28} />}
          title="Todavía no hay suficientes ventas para pronosticar."
          description="En cuanto registres tus primeras ventas en Caja, VIMDY va a poder decirte cuánto venderás, qué producto va a pegar más y cuál es tu mejor día."
        />
      ) : summary ? (
        <>
          {/* Tarjetas principales */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {/* Cuánto venderás mañana */}
            <div className="rounded-2xl border border-vimdy-accent/30 bg-vimdy-accent/5 p-5">
              <p className="text-vimdy-accent text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <TrendingUp size={14} /> Ventas de mañana
              </p>
              {summary.tomorrow ? (
                <>
                  <p className="text-vimdy-text text-3xl font-bold mt-1">{formatCurrency(summary.tomorrow.expectedTotal)}</p>
                  <p className="text-vimdy-text-tertiary text-xs mt-1">{summary.tomorrow.weekday}</p>
                  <p className="text-vimdy-text-tertiary text-xs mt-2">{summary.tomorrow.basis}</p>
                  <ConfidenceBar value={summary.tomorrow.confidence} />
                </>
              ) : (
                <p className="text-vimdy-text-tertiary text-sm mt-2">Sin datos suficientes todavía.</p>
              )}
            </div>

            {/* Producto de mayor demanda */}
            <div className="rounded-2xl border border-vimdy-ai/30 bg-vimdy-ai/5 p-5">
              <p className="text-vimdy-ai text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <Package size={14} /> Mayor demanda
              </p>
              {summary.topDemandProduct ? (
                <>
                  <p className="text-vimdy-text text-2xl font-bold mt-1">{summary.topDemandProduct.productName}</p>
                  <p className="text-vimdy-text-tertiary text-xs mt-1">
                    ~{summary.topDemandProduct.expectedQuantity} {summary.topDemandProduct.unit ?? "unidad(es)"} esperadas
                  </p>
                  <p className="text-vimdy-text-tertiary text-xs mt-2">{summary.topDemandProduct.basis}</p>
                </>
              ) : (
                <p className="text-vimdy-text-tertiary text-sm mt-2">Sin datos suficientes todavía.</p>
              )}
            </div>

            {/* Mejor día para vender */}
            <div className="rounded-2xl border border-vimdy-success/30 bg-vimdy-success/5 p-5">
              <p className="text-vimdy-success text-xs font-semibold uppercase tracking-wide flex items-center gap-1.5">
                <CalendarDays size={14} /> Mejor día para vender
              </p>
              {summary.bestSellingDay ? (
                <>
                  <p className="text-vimdy-text text-2xl font-bold mt-1">{summary.bestSellingDay.weekday}</p>
                  <p className="text-vimdy-text-tertiary text-xs mt-1">
                    Promedio {formatCurrency(summary.bestSellingDay.averageSales)} · próximo en{" "}
                    {summary.bestSellingDay.daysUntilNext} día(s)
                  </p>
                </>
              ) : (
                <p className="text-vimdy-text-tertiary text-sm mt-2">Sin datos suficientes todavía.</p>
              )}
            </div>
          </div>

          {/* Ingrediente que se agota primero */}
          <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle size={18} className="text-vimdy-warning" />
              <h3 className="text-vimdy-text font-bold">Qué se te va a acabar primero</h3>
            </div>
            {summary.firstIngredientToRunOut ? (
              <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                  <p className="text-vimdy-text font-medium">{summary.firstIngredientToRunOut.productName}</p>
                  <p className="text-vimdy-text-secondary text-sm">
                    {summary.firstIngredientToRunOut.daysUntilStockout} día(s) restantes ·{" "}
                    {summary.firstIngredientToRunOut.reason}
                  </p>
                </div>
                <VimdyButton
                  variant="secondary"
                  className="!px-4 !py-2 text-xs"
                  onClick={() => navigate("/compras-inteligentes")}
                >
                  Ver en Compras Inteligentes
                </VimdyButton>
              </div>
            ) : (
              <p className="text-vimdy-text-secondary text-sm">Ningún insumo tiene fecha estimada de agotamiento por ahora.</p>
            )}
          </div>

          {/* Breakdown por día de semana */}
          {summary.bestSellingDay && (
            <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover p-5">
              <div className="flex items-center gap-2 mb-4">
                <Info size={16} className="text-vimdy-accent" />
                <h3 className="text-vimdy-text font-bold">Ventas promedio por día de la semana</h3>
              </div>
              <WeekdayChart breakdown={summary.bestSellingDay.breakdown} bestIndex={summary.bestSellingDay.weekdayIndex} />
            </div>
          )}

          {/* Compras a adelantar */}
          <div className="rounded-2xl border border-vimdy-border bg-vimdy-surface-hover overflow-hidden">
            <div className="p-5 pb-0 flex items-center gap-2">
              <ShoppingCart size={16} className="text-vimdy-accent" />
              <h3 className="text-vimdy-text font-bold">Compras que deberías adelantar</h3>
            </div>
            <div className="p-5">
              {summary.purchasesToBringForward.length === 0 ? (
                <p className="text-vimdy-text-secondary text-sm">
                  No hay compras urgentes que adelantar por ahora — tu inventario alcanza para tu próximo mejor día
                  de venta.
                </p>
              ) : (
                <div className="space-y-2">
                  {summary.purchasesToBringForward.map((item) => (
                    <div
                      key={item.recommendation.productId}
                      className="flex items-start justify-between gap-3 flex-wrap rounded-xl border border-vimdy-warning/30 bg-vimdy-warning/10 px-4 py-3"
                    >
                      <div>
                        <p className="text-vimdy-text font-medium text-sm">{item.recommendation.productName}</p>
                        <p className="text-vimdy-warning/80 text-xs mt-0.5">{item.reason}</p>
                      </div>
                      <VimdyButton
                        variant="secondary"
                        className="!px-4 !py-2 text-xs"
                        onClick={() => navigate("/compras-inteligentes")}
                      >
                        Crear orden
                      </VimdyButton>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </>
      ) : null}
    </div>
  );
}

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="mt-2">
      <div className="h-1.5 w-full rounded-full bg-vimdy-surface-hover overflow-hidden">
        <div className="h-full bg-vimdy-accent" style={{ width: `${value}%` }} />
      </div>
      <p className="text-vimdy-text-tertiary text-xs mt-1">Confianza: {value}%</p>
    </div>
  );
}

function WeekdayChart({
  breakdown,
  bestIndex
}: {
  breakdown: readonly { weekday: string; weekdayIndex: number; averageSales: number; sampleSize: number }[];
  bestIndex: number;
}) {
  const max = Math.max(1, ...breakdown.map((b) => b.averageSales));

  return (
    <div className="flex items-end gap-3 h-40">
      {breakdown.map((day) => {
        const heightPercent = day.sampleSize > 0 ? Math.max(4, (day.averageSales / max) * 100) : 2;
        const isBest = day.weekdayIndex === bestIndex && day.sampleSize > 0;
        return (
          <div key={day.weekdayIndex} className="flex-1 flex flex-col items-center justify-end h-full">
            <p className="text-xs text-vimdy-text-tertiary mb-1">
              {day.sampleSize > 0 ? formatCurrency(day.averageSales) : "—"}
            </p>
            <div
              className={`w-full rounded-t-lg ${isBest ? "bg-vimdy-success" : "bg-vimdy-surface-active"}`}
              style={{ height: `${heightPercent}%` }}
            />
            <p className={`text-xs mt-2 ${isBest ? "text-vimdy-success font-semibold" : "text-vimdy-text-secondary"}`}>
              {day.weekday.slice(0, 3)}
            </p>
          </div>
        );
      })}
    </div>
  );
}