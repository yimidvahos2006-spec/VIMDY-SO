// RUTA: /src/presentation/components/dashboard/VimdyAdminAnalyzerDashboard.tsx

import React, {
  useCallback,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import {
  BarChart3,
  Calculator,
  CircleDollarSign,
  Clock3,
  RefreshCw,
  Scale,
  TrendingUp,
  TriangleAlert,
  WalletCards,
  type LucideIcon,
} from "lucide-react";

import type { DashboardProfitSnapshot } from "../../../core/engines/BusinessAnalyzer";
import type { Shift } from "../../../core/entities/Entities";
import { vimdyCore } from "../../../core/VimdyCore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { container } from "../../../infrastructure/di/CompositionRoot";

interface MetricCardProps {
  readonly label: string;
  readonly value: string;
  readonly icon: LucideIcon;
  readonly description?: string;
  readonly iconClassName?: string;
  readonly valueClassName?: string;
}

const EMPTY_PROFITABILITY: DashboardProfitSnapshot | null = null;

function toSafeNumber(value: unknown): number {
  const numericValue = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numericValue) ? numericValue : 0;
}

function formatCurrency(value: unknown, currency: string): string {
  const amount = toSafeNumber(value);
  const safeCurrency = currency || "COP";

  try {
    return new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency: safeCurrency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount).toLocaleString("es-CO")} ${safeCurrency}`;
  }
}

function formatPercentage(value: unknown): string {
  return `${toSafeNumber(value).toFixed(1)}%`;
}

function formatDateTime(value: Date | null | undefined): string {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return "—";
  }

  return new Intl.DateTimeFormat("es-CO", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function compactShiftId(shift: Shift | null): string {
  const id = shift?.id?.trim();

  if (!id) {
    return "—";
  }

  return id.length > 18 ? `${id.slice(0, 18)}…` : id;
}

function MetricCard({
  label,
  value,
  icon: Icon,
  description,
  iconClassName = "text-vimdy-text-secondary",
  valueClassName = "text-vimdy-text",
}: MetricCardProps) {
  return (
    <article className="relative min-h-[156px] overflow-hidden rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-5 shadow-vimdy-xs">
      <div className="flex h-full items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-vimdy-micro uppercase text-vimdy-text-secondary">
            {label}
          </p>

          <p
            className={`mt-5 truncate text-2xl font-bold tracking-tight xl:text-3xl ${valueClassName}`}
            title={value}
          >
            {value}
          </p>

          {description ? (
            <p className="mt-2 max-w-[30rem] text-xs leading-5 text-vimdy-text-tertiary">
              {description}
            </p>
          ) : null}
        </div>

        <Icon
          className={`shrink-0 ${iconClassName}`}
          size={22}
          strokeWidth={1.8}
          aria-hidden="true"
        />
      </div>
    </article>
  );
}

export const VimdyAdminAnalyzerDashboard = React.memo(
  function VimdyAdminAnalyzerDashboard() {
    const currency = useSyncExternalStore(
      companyConfigStore.subscribe,
      () => companyConfigStore.get()?.currency || "COP",
      () => "COP"
    );

    const [currentShift, setCurrentShift] = useState<Shift | null>(null);
    const [profitability, setProfitability] =
      useState<DashboardProfitSnapshot | null>(EMPTY_PROFITABILITY);
    const [loading, setLoading] = useState(true);
    const [refreshing, setRefreshing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const requestIdRef = useRef(0);
    const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const loadData = useCallback(async (isRefresh = false) => {
      const requestId = ++requestIdRef.current;

      if (isRefresh) {
        setRefreshing(true);
      } else {
        setLoading(true);
      }

      setError(null);

      try {
        const activeShift =
          await container.shiftEngine.get().getCurrentShift();

        if (requestId !== requestIdRef.current) {
          return;
        }

        setCurrentShift(activeShift);

        if (!activeShift) {
          setProfitability(EMPTY_PROFITABILITY);
          return;
        }

        const snapshot = await container.businessAnalyzer
          .get()
          .computeShiftProfitability(activeShift);

        if (requestId !== requestIdRef.current) {
          return;
        }

        setProfitability(snapshot);
      } catch (cause) {
        console.error(
          "[VimdyAdminAnalyzerDashboard] No se pudo calcular la rentabilidad del turno:",
          cause
        );

        if (requestId !== requestIdRef.current) {
          return;
        }

        setProfitability(EMPTY_PROFITABILITY);
        setError(
          "No se pudo cargar la analítica financiera del turno actual."
        );
      } finally {
        if (requestId === requestIdRef.current) {
          setLoading(false);
          setRefreshing(false);
        }
      }
    }, []);

    const scheduleRefresh = useCallback(() => {
      if (refreshTimerRef.current !== null) {
        clearTimeout(refreshTimerRef.current);
      }

      refreshTimerRef.current = setTimeout(() => {
        refreshTimerRef.current = null;
        void loadData(true);
      }, 120);
    }, [loadData]);

    useEffect(() => {
      void loadData();

      return () => {
        requestIdRef.current += 1;
      };
    }, [loadData]);

    useEffect(() => {
      const unsubscribeShift = vimdyCore.on("shift", scheduleRefresh);
      const unsubscribePayment = vimdyCore.on("payment", scheduleRefresh);
      const unsubscribeInventory = vimdyCore.on(
        "inventory",
        scheduleRefresh
      );
      const unsubscribeSync = vimdyCore.on("sync", scheduleRefresh);

      return () => {
        unsubscribeShift();
        unsubscribePayment();
        unsubscribeInventory();
        unsubscribeSync();

        if (refreshTimerRef.current !== null) {
          clearTimeout(refreshTimerRef.current);
          refreshTimerRef.current = null;
        }
      };
    }, [scheduleRefresh]);

    const grossRevenue = profitability?.grossRevenue ?? 0;
    const netRevenue = profitability?.netRevenue ?? 0;
    const totalCost = profitability?.totalCost ?? 0;
    const totalProfit = profitability?.totalProfit ?? 0;
    const marginPercentage = profitability?.marginPercentage ?? 0;
    const ivaCollected = profitability?.ivaCollected ?? 0;
    const impoconsumoCollected =
      profitability?.impoconsumoCollected ?? 0;

    const unreliableCostCount = Math.max(
      0,
      Math.trunc(profitability?.unreliableCostCount ?? 0)
    );

    const safeProfit = toSafeNumber(totalProfit);
    const positiveProfit = safeProfit > 0;
    const negativeProfit = safeProfit < 0;

    if (loading) {
      return (
        <section
          className="min-h-[420px] rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs"
          aria-busy="true"
          aria-label="Cargando analítica financiera"
        >
          <div className="flex min-h-[360px] flex-col items-center justify-center gap-3 text-center">
            <RefreshCw
              className="h-6 w-6 animate-spin text-vimdy-accent"
              aria-hidden="true"
            />

            <p className="text-vimdy-small font-medium text-vimdy-text">
              Procesando analítica financiera…
            </p>

            <p className="max-w-md text-xs leading-5 text-vimdy-text-tertiary">
              Consultando el turno activo y calculando rentabilidad histórica,
              costos e impuestos.
            </p>
          </div>
        </section>
      );
    }

    return (
      <section
        className="space-y-6"
        aria-labelledby="vimdy-admin-analyzer-title"
      >
        <header className="flex flex-col gap-4 border-b border-vimdy-border pb-5 lg:flex-row lg:items-end lg:justify-between">
          <div className="min-w-0">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary">
                <BarChart3
                  className="h-5 w-5 text-vimdy-accent"
                  aria-hidden="true"
                />
              </div>

              <div className="min-w-0">
                <h1
                  id="vimdy-admin-analyzer-title"
                  className="text-vimdy-h2 text-vimdy-text"
                >
                  Analítica Financiera
                </h1>

                <p className="mt-1 max-w-3xl text-vimdy-small text-vimdy-text-secondary">
                  Rentabilidad del turno actual calculada directamente por
                  BusinessAnalyzer con costos históricos de Kardex.
                </p>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={() => void loadData(true)}
            disabled={refreshing}
            className="inline-flex min-h-10 shrink-0 items-center justify-center gap-2 rounded-vimdy-md border border-vimdy-border bg-vimdy-background-secondary px-4 py-2 text-vimdy-small font-semibold text-vimdy-text transition-colors duration-vimdy-fast hover:bg-vimdy-surface-hover disabled:cursor-not-allowed disabled:opacity-60"
            aria-label="Actualizar analítica financiera"
          >
            <RefreshCw
              className={
                refreshing
                  ? "h-4 w-4 animate-spin text-vimdy-accent"
                  : "h-4 w-4"
              }
              aria-hidden="true"
            />

            <span>{refreshing ? "Actualizando…" : "Actualizar"}</span>
          </button>
        </header>

        {error ? (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-vimdy-lg border border-vimdy-danger/30 bg-vimdy-danger-bg p-4"
          >
            <TriangleAlert
              className="mt-0.5 h-5 w-5 shrink-0 text-vimdy-danger"
              aria-hidden="true"
            />

            <div className="min-w-0">
              <p className="text-vimdy-small font-semibold text-vimdy-danger">
                Error de sincronización
              </p>

              <p className="mt-1 text-xs leading-5 text-vimdy-text-secondary">
                {error}
              </p>
            </div>
          </div>
        ) : null}

        {!currentShift ? (
          <section className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-8 shadow-vimdy-xs sm:p-10">
            <div className="mx-auto flex max-w-xl flex-col items-center text-center">
              <WalletCards
                className="h-8 w-8 text-vimdy-text-tertiary"
                aria-hidden="true"
              />

              <h2 className="mt-4 text-vimdy-h3 text-vimdy-text">
                No hay un turno activo
              </h2>

              <p className="mt-2 text-vimdy-small leading-6 text-vimdy-text-secondary">
                Abre un turno en la caja actual para que VIMDY pueda calcular y
                mostrar la rentabilidad financiera del período.
              </p>
            </div>
          </section>
        ) : (
          <>
            <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
              <div className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-5 shadow-vimdy-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-vimdy-lg bg-vimdy-background-secondary">
                    <Clock3
                      className="h-4 w-4 text-vimdy-accent"
                      aria-hidden="true"
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                      Turno activo
                    </p>

                    <p className="mt-1 text-vimdy-small font-medium text-vimdy-text">
                      Abierto {formatDateTime(currentShift.openedAt)}
                    </p>
                  </div>
                </div>
              </div>

              <div className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-5 shadow-vimdy-xs">
                <div className="flex items-center gap-3">
                  <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-vimdy-lg bg-vimdy-background-secondary">
                    <WalletCards
                      className="h-4 w-4 text-vimdy-accent"
                      aria-hidden="true"
                    />
                  </div>

                  <div className="min-w-0">
                    <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                      Identificador del turno
                    </p>

                    <p
                      className="mt-1 truncate font-mono text-vimdy-small font-medium text-vimdy-text"
                      title={currentShift.id}
                    >
                      {compactShiftId(currentShift)}
                    </p>
                  </div>
                </div>
              </div>
            </section>

            {profitability ? (
              <>
                <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  <MetricCard
                    label="Ventas brutas"
                    value={formatCurrency(grossRevenue, currency)}
                    icon={CircleDollarSign}
                    description="Ingresos brutos registrados para el turno."
                  />

                  <MetricCard
                    label="Ingresos netos"
                    value={formatCurrency(netRevenue, currency)}
                    icon={TrendingUp}
                    iconClassName="text-vimdy-accent"
                    valueClassName="text-vimdy-accent"
                    description="Ingreso utilizado como base para el margen."
                  />

                  <MetricCard
                    label="Costo histórico"
                    value={formatCurrency(totalCost, currency)}
                    icon={Scale}
                    iconClassName="text-vimdy-danger"
                    valueClassName="text-vimdy-danger"
                    description="Valorización histórica aplicada a las ventas."
                  />

                  <MetricCard
                    label="Utilidad"
                    value={formatCurrency(totalProfit, currency)}
                    icon={Calculator}
                    iconClassName={
                      negativeProfit
                        ? "text-vimdy-danger"
                        : "text-vimdy-accent"
                    }
                    valueClassName={
                      negativeProfit
                        ? "text-vimdy-danger"
                        : "text-vimdy-accent"
                    }
                    description={`Margen sobre ingreso neto: ${formatPercentage(
                      marginPercentage
                    )}.`}
                  />
                </section>

                <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                  <article className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-5 shadow-vimdy-xs xl:col-span-2">
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-vimdy-h3 text-vimdy-text">
                          Resultado del turno
                        </h2>

                        <p className="mt-1 text-vimdy-small text-vimdy-text-secondary">
                          Indicadores consolidados por el motor financiero.
                        </p>
                      </div>

                      <div
                        className={`inline-flex w-fit items-center gap-2 rounded-full border px-3 py-1.5 text-xs font-semibold ${
                          positiveProfit
                            ? "border-vimdy-success/30 bg-vimdy-success-bg text-vimdy-success"
                            : negativeProfit
                              ? "border-vimdy-danger/30 bg-vimdy-danger-bg text-vimdy-danger"
                              : "border-vimdy-border bg-vimdy-background-secondary text-vimdy-text-secondary"
                        }`}
                      >
                        <TrendingUp
                          className="h-3.5 w-3.5"
                          aria-hidden="true"
                        />

                        <span>
                          Margen {formatPercentage(marginPercentage)}
                        </span>
                      </div>
                    </div>

                    <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-3">
                      <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary p-4">
                        <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                          Ingreso bruto
                        </p>

                        <p className="mt-2 text-lg font-bold text-vimdy-text">
                          {formatCurrency(grossRevenue, currency)}
                        </p>
                      </div>

                      <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary p-4">
                        <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                          Ingreso neto
                        </p>

                        <p className="mt-2 text-lg font-bold text-vimdy-accent">
                          {formatCurrency(netRevenue, currency)}
                        </p>
                      </div>

                      <div className="rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary p-4">
                        <p className="text-vimdy-micro uppercase text-vimdy-text-tertiary">
                          Utilidad
                        </p>

                        <p
                          className={`mt-2 text-lg font-bold ${
                            negativeProfit
                              ? "text-vimdy-danger"
                              : "text-vimdy-accent"
                          }`}
                        >
                          {formatCurrency(totalProfit, currency)}
                        </p>
                      </div>
                    </div>
                  </article>

                  <article className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-5 shadow-vimdy-xs">
                    <div className="flex items-start justify-between gap-4">
                      <div>
                        <h2 className="text-vimdy-h3 text-vimdy-text">
                          Impuestos recaudados
                        </h2>

                        <p className="mt-1 text-vimdy-small text-vimdy-text-secondary">
                          Separación fiscal incluida en el contrato financiero.
                        </p>
                      </div>

                      <Calculator
                        className="h-5 w-5 shrink-0 text-vimdy-text-tertiary"
                        aria-hidden="true"
                      />
                    </div>

                    <div className="mt-5 space-y-3">
                      <div className="flex items-center justify-between gap-4 rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary p-4">
                        <span className="text-vimdy-micro uppercase text-vimdy-text-secondary">
                          IVA
                        </span>

                        <span className="font-mono text-sm font-bold tabular-nums text-vimdy-text">
                          {formatCurrency(ivaCollected, currency)}
                        </span>
                      </div>

                      <div className="flex items-center justify-between gap-4 rounded-vimdy-lg border border-vimdy-border bg-vimdy-background-secondary p-4">
                        <span className="text-vimdy-micro uppercase text-vimdy-text-secondary">
                          Impoconsumo
                        </span>

                        <span className="font-mono text-sm font-bold tabular-nums text-vimdy-text">
                          {formatCurrency(
                            impoconsumoCollected,
                            currency
                          )}
                        </span>
                      </div>
                    </div>
                  </article>
                </section>

                {unreliableCostCount > 0 ? (
                  <section
                    role="status"
                    className="rounded-vimdy-xl border border-vimdy-warning/30 bg-vimdy-warning-bg p-5 shadow-vimdy-xs"
                  >
                    <div className="flex items-start gap-3">
                      <TriangleAlert
                        className="mt-0.5 h-5 w-5 shrink-0 text-vimdy-warning"
                        aria-hidden="true"
                      />

                      <div className="min-w-0">
                        <h2 className="text-vimdy-small font-semibold text-vimdy-warning-hover">
                          Costos históricos no verificables
                        </h2>

                        <p className="mt-1 text-xs leading-5 text-vimdy-text-secondary">
                          Se detectaron{" "}
                          {unreliableCostCount.toLocaleString("es-CO")}{" "}
                          línea
                          {unreliableCostCount === 1 ? "" : "s"} con costo no
                          verificable. Estas líneas no incrementaron el costo
                          ni la utilidad calculada por el motor.
                        </p>
                      </div>
                    </div>
                  </section>
                ) : (
                  <section className="rounded-vimdy-xl border border-vimdy-success/30 bg-vimdy-success-bg p-5 shadow-vimdy-xs">
                    <div className="flex items-start gap-3">
                      <TrendingUp
                        className="mt-0.5 h-5 w-5 shrink-0 text-vimdy-success"
                        aria-hidden="true"
                      />

                      <div className="min-w-0">
                        <h2 className="text-vimdy-small font-semibold text-vimdy-success">
                          Integridad del costo verificada
                        </h2>

                        <p className="mt-1 text-xs leading-5 text-vimdy-text-secondary">
                          Todas las líneas analizadas aportaron un costo
                          verificable al resultado financiero del turno.
                        </p>
                      </div>
                    </div>
                  </section>
                )}
              </>
            ) : (
              <section className="rounded-vimdy-xl border border-vimdy-border bg-vimdy-surface p-6 shadow-vimdy-xs">
                <div className="flex items-start gap-3">
                  <TriangleAlert
                    className="mt-0.5 h-5 w-5 shrink-0 text-vimdy-text-tertiary"
                    aria-hidden="true"
                  />

                  <div>
                    <h2 className="text-vimdy-small font-semibold text-vimdy-text">
                      Sin resultado financiero
                    </h2>

                    <p className="mt-1 text-xs leading-5 text-vimdy-text-secondary">
                      El turno está activo, pero todavía no existe un snapshot
                      financiero disponible para mostrar.
                    </p>
                  </div>
                </div>
              </section>
            )}
          </>
        )}
      </section>
    );
  }
);

VimdyAdminAnalyzerDashboard.displayName =
  "VimdyAdminAnalyzerDashboard";