import { useId, useMemo, useState } from "react";
import type { ReactNode } from "react";

/**
 * LossCenterDashboard.tsx — Centro de Pérdidas (interfaz visual)
 * ---------------------------------------------------------------------------
 * Componente 100 % presentacional y autocontenido:
 *  - No lee stores, repositorios ni rutas. Recibe todo por props.
 *  - Estilos internos (<style> con prefijo `lcd-`), sin Tailwind ni CSS externo.
 *  - Íconos SVG propios: la única dependencia es React.
 *  - Modo oscuro por defecto, leyendo los tokens --vimdy-* de la app con
 *    valores de respaldo, así se ve bien aunque el token no exista.
 *
 * Fuente única de verdad: los totales, el desglose por categoría, el
 * porcentaje de pérdida y la categoría dominante se DERIVAN de `rows`.
 * Por eso `rows` debe traer todos los ítems con pérdida del período
 * (no solo un top N), o los totales quedarían subestimados.
 *
 * Sin props, el componente muestra el estado vacío.
 */

/* ═══════════════════════════════ Tipos públicos ═══════════════════════════════ */

export type LossCategoryKey =
  | "vencimiento"
  | "desperdicio"
  | "merma_preparacion"
  | "cortesia"
  | "faltante";

export type LossPeriod = "today" | "week" | "month" | "quarter" | "year";

/** Pérdida de un ítem dentro de UNA categoría, en el período seleccionado. */
export interface LossBucket {
  /** Costo de lo perdido (en la moneda de `currency`). */
  readonly cost: number;
  /** Cantidad perdida, en la unidad del ítem. */
  readonly quantity: number;
  /** Cuántas veces ocurrió (movimientos registrados). */
  readonly incidents: number;
}

export interface LossRow {
  readonly id: string;
  readonly name: string;
  readonly kind: "producto" | "insumo";
  /** Unidad de medida para mostrar: "und", "kg", "g", "l"… */
  readonly unit: string;
  /** Stock actual (puede ser 0 o negativo si el negocio vende sin stock). */
  readonly currentStock: number;
  /**
   * Cantidad que estuvo disponible en el período (stock inicial + ingresos).
   * Es la base del "% de pérdida sobre lo disponible".
   */
  readonly availableQuantity: number;
  readonly byCategory: Partial<Record<LossCategoryKey, LossBucket>>;
  /** Fecha del último evento de pérdida (Date o texto ISO). */
  readonly lastIncidentAt?: Date | string | null;
}

/** Producto (o lote) con stock que vence pronto. Misma forma que `ExpiryRiskItem` de lossEngine. */
export interface ExpiryAlert {
  readonly itemId: string;
  readonly itemName: string;
  readonly unit: string | null;
  /** Existencias que vencen. */
  readonly stock: number;
  /** Días enteros hasta vencer: 0 = hoy, negativo = ya vencido con stock. */
  readonly daysLeft: number;
  /** Costo de lo que está en riesgo (0 si no hay costo confiable). */
  readonly valueAtRisk: number;
}

export interface LossCenterDashboardProps {
  readonly rows?: readonly LossRow[];
  /** Productos por vencer (pérdida potencial). Se muestran aunque no haya pérdidas en el período. */
  readonly expiryRisk?: readonly ExpiryAlert[];
  /** Días de anticipación con los que se calculó `expiryRisk`, solo para el texto. */
  readonly expiryWarningDays?: number;
  /** Período activo (modo controlado). Si no se envía, el componente lo maneja. */
  readonly period?: LossPeriod;
  /** Período inicial cuando no es controlado. Por defecto "month". */
  readonly defaultPeriod?: LossPeriod;
  readonly onPeriodChange?: (period: LossPeriod) => void;
  /** Ingresos del período, para mostrar la pérdida como % de ellos. */
  readonly revenue?: number | null;
  /** Costo total del período anterior, para mostrar la tendencia. */
  readonly previousTotalCost?: number | null;
  /** Código ISO de moneda. Por defecto "COP". */
  readonly currency?: string;
  /** Veces mínimas para marcar un ítem como reincidente. Por defecto 3. */
  readonly recurrenceThreshold?: number;
  readonly loading?: boolean;
  readonly error?: string | null;
  /** Abre el flujo de registro de merma / salida sin venta. */
  readonly onRegisterLoss?: () => void;
  /** Se invoca al pulsar una fila (ej. abrir el detalle del producto). */
  readonly onSelectRow?: (row: LossRow) => void;
  readonly className?: string;
}

/* ═══════════════════════════════ Configuración ═══════════════════════════════ */

type IconName =
  | "alert"
  | "clock"
  | "trash"
  | "scissors"
  | "gift"
  | "packageMinus"
  | "search"
  | "arrowUp"
  | "arrowDown"
  | "repeat"
  | "plus"
  | "x"
  | "trendingDown"
  | "chevron";

const LOSS_CATEGORY_KEYS: readonly LossCategoryKey[] = [
  "vencimiento",
  "desperdicio",
  "merma_preparacion",
  "cortesia",
  "faltante"
];

const CATEGORY_META: Record<LossCategoryKey, { label: string; hint: string; icon: IconName }> = {
  vencimiento: { label: "Vencimiento", hint: "Producto caducado", icon: "clock" },
  desperdicio: { label: "Desperdicio", hint: "Descartado o dañado", icon: "trash" },
  merma_preparacion: { label: "Merma de preparación", hint: "Pérdida al preparar", icon: "scissors" },
  cortesia: { label: "Cortesía", hint: "Entregado sin cobro", icon: "gift" },
  faltante: { label: "Faltante", hint: "Diferencia de inventario", icon: "packageMinus" }
};

const PERIODS: readonly { value: LossPeriod; label: string; sentence: string }[] = [
  { value: "today", label: "Hoy", sentence: "hoy" },
  { value: "week", label: "Esta semana", sentence: "esta semana" },
  { value: "month", label: "Este mes", sentence: "este mes" },
  { value: "quarter", label: "Trimestre", sentence: "en el trimestre" },
  { value: "year", label: "Este año", sentence: "este año" }
];

/** Umbrales del % de pérdida sobre lo disponible (semáforo del medidor). */
const PCT_WARNING = 5;
const PCT_DANGER = 10;

type SortKey = "name" | "stock" | "quantity" | "pct" | "cost" | "incidents";
type SortDir = "asc" | "desc";

/* ═══════════════════════════════ Utilidades ═══════════════════════════════ */

const safe = (n: number): number => (Number.isFinite(n) && n > 0 ? n : 0);

const fmtQty = (n: number): string =>
  n.toLocaleString("es-CO", { maximumFractionDigits: 2 });

const fmtPct = (n: number): string =>
  `${n.toLocaleString("es-CO", { maximumFractionDigits: 1, minimumFractionDigits: 0 })}%`;

const fmtDate = (value: Date | string | null | undefined): string | null => {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("es-CO", { day: "numeric", month: "short" });
};

const times = (n: number): string => (n === 1 ? "1 vez" : `${n} veces`);

interface DominantCategory {
  readonly key: LossCategoryKey;
  readonly share: number;
}

interface ViewRow {
  readonly row: LossRow;
  readonly cost: number;
  readonly quantity: number;
  readonly incidents: number;
  readonly pct: number | null;
  readonly dominant: DominantCategory | null;
}

function buildViewRow(row: LossRow, only: LossCategoryKey | null): ViewRow {
  const keys = only ? [only] : LOSS_CATEGORY_KEYS;
  let cost = 0;
  let quantity = 0;
  let incidents = 0;
  let topKey: LossCategoryKey | null = null;
  let topCost = -1;
  let topQty = -1;

  for (const key of keys) {
    const b = row.byCategory[key];
    if (!b) continue;
    const bCost = safe(b.cost);
    const bQty = safe(b.quantity);
    cost += bCost;
    quantity += bQty;
    incidents += Math.max(0, Math.round(safe(b.incidents)));
    if (bCost > topCost || (bCost === topCost && bQty > topQty)) {
      topKey = key;
      topCost = bCost;
      topQty = bQty;
    }
  }

  const available = safe(row.availableQuantity);
  const pct = available > 0 ? Math.min(100, (quantity / available) * 100) : null;
  const dominant: DominantCategory | null =
    topKey === null ? null : { key: topKey, share: cost > 0 ? topCost / cost : 1 };

  return { row, cost, quantity, incidents, pct, dominant };
}

const hasLoss = (v: ViewRow): boolean => v.cost > 0 || v.quantity > 0 || v.incidents > 0;

function severity(pct: number | null): "none" | "ok" | "warn" | "danger" {
  if (pct === null) return "none";
  if (pct >= PCT_DANGER) return "danger";
  if (pct >= PCT_WARNING) return "warn";
  return "ok";
}

/* ═══════════════════════════════ Íconos ═══════════════════════════════ */

const ICON_PATHS: Record<IconName, ReactNode> = {
  alert: (
    <>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="10" />
      <polyline points="12 6 12 12 16 14" />
    </>
  ),
  trash: (
    <>
      <path d="M3 6h18" />
      <path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6" />
      <path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2" />
      <line x1="10" x2="10" y1="11" y2="17" />
      <line x1="14" x2="14" y1="11" y2="17" />
    </>
  ),
  scissors: (
    <>
      <circle cx="6" cy="6" r="3" />
      <path d="M8.12 8.12 12 12" />
      <path d="M20 4 8.12 15.88" />
      <circle cx="6" cy="18" r="3" />
      <path d="M14.8 14.8 20 20" />
    </>
  ),
  gift: (
    <>
      <rect x="3" y="8" width="18" height="4" rx="1" />
      <path d="M12 8v13" />
      <path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7" />
      <path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5" />
    </>
  ),
  packageMinus: (
    <>
      <path d="M16 16h6" />
      <path d="M21 10V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l2-1.14" />
      <path d="m7.5 4.27 9 5.15" />
      <polyline points="3.29 7 12 12 20.71 7" />
      <line x1="12" x2="12" y1="22" y2="12" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>
  ),
  arrowUp: (
    <>
      <path d="m5 12 7-7 7 7" />
      <path d="M12 19V5" />
    </>
  ),
  arrowDown: (
    <>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </>
  ),
  repeat: (
    <>
      <path d="m17 2 4 4-4 4" />
      <path d="M3 11v-1a4 4 0 0 1 4-4h14" />
      <path d="m7 22-4-4 4-4" />
      <path d="M21 13v1a4 4 0 0 1-4 4H3" />
    </>
  ),
  plus: (
    <>
      <path d="M5 12h14" />
      <path d="M12 5v14" />
    </>
  ),
  x: (
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>
  ),
  trendingDown: (
    <>
      <polyline points="22 17 13.5 8.5 8.5 13.5 2 7" />
      <polyline points="16 17 22 17 22 11" />
    </>
  ),
  chevron: <path d="m6 9 6 6 6-6" />
};

function Icon({ name, size = 18 }: { name: IconName; size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {ICON_PATHS[name]}
    </svg>
  );
}

/* ═══════════════════════════════ Productos por vencer ═══════════════════════════════ */

function expiryLabel(daysLeft: number): string {
  if (daysLeft < 0) {
    const d = Math.abs(daysLeft);
    return `Vencido hace ${d} ${d === 1 ? "día" : "días"}`;
  }
  if (daysLeft === 0) return "Vence hoy";
  return `Vence en ${daysLeft} ${daysLeft === 1 ? "día" : "días"}`;
}

function ExpiryRiskPanel({
  items,
  warningDays,
  money
}: {
  readonly items: readonly ExpiryAlert[];
  readonly warningDays: number;
  readonly money: (n: number) => string;
}) {
  const expired = items.filter((i) => i.daysLeft < 0).length;
  const atRisk = items.reduce((sum, i) => sum + safe(i.valueAtRisk), 0);
  const MAX_VISIBLE = 6;
  const visible = items.slice(0, MAX_VISIBLE);
  const hidden = items.length - visible.length;

  return (
    <section className="lcd-expiry" aria-label="Productos próximos a vencer" role="status">
      <div className="lcd-expiry-head">
        <Icon name="clock" size={18} />
        <div>
          <p className="lcd-expiry-title">
            {items.length} {items.length === 1 ? "producto vence" : "productos vencen"} en {warningDays}{" "}
            {warningDays === 1 ? "día" : "días"} o menos
            {expired > 0 ? ` · ${expired} ya vencido${expired === 1 ? "" : "s"}` : ""}
          </p>
          <p className="lcd-expiry-sub">
            {atRisk > 0 ? `Valor en riesgo: ${money(atRisk)}. ` : ""}
            Véndelos, úsalos en producción o regístralos como vencimiento antes de perderlos.
          </p>
        </div>
      </div>
      <ul className="lcd-expiry-list">
        {visible.map((item, index) => (
          <li key={`${item.itemId}-${index}`} className="lcd-expiry-item" data-tone={item.daysLeft < 0 ? "danger" : "warn"}>
            <span className="lcd-expiry-name">{item.itemName}</span>
            <span className="lcd-expiry-qty">
              {item.stock} {item.unit ?? ""}
            </span>
            <span className="lcd-expiry-when">{expiryLabel(item.daysLeft)}</span>
            {item.valueAtRisk > 0 && <span className="lcd-expiry-value">{money(item.valueAtRisk)}</span>}
          </li>
        ))}
      </ul>
      {hidden > 0 && <p className="lcd-expiry-more">y {hidden} más…</p>}
    </section>
  );
}

/* ═══════════════════════════════ Componente principal ═══════════════════════════════ */

export function LossCenterDashboard({
  rows = [],
  expiryRisk = [],
  expiryWarningDays = 3,
  period,
  defaultPeriod = "month",
  onPeriodChange,
  revenue = null,
  previousTotalCost = null,
  currency = "COP",
  recurrenceThreshold = 3,
  loading = false,
  error = null,
  onRegisterLoss,
  onSelectRow,
  className
}: LossCenterDashboardProps) {
  const titleId = useId();
  const emptyTitleId = useId();

  const [internalPeriod, setInternalPeriod] = useState<LossPeriod>(defaultPeriod);
  const activePeriod = period ?? internalPeriod;
  const periodMeta = PERIODS.find((p) => p.value === activePeriod) ?? PERIODS[2];

  const [query, setQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<LossCategoryKey | null>(null);
  const [onlyRecurrent, setOnlyRecurrent] = useState(false);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "cost", dir: "desc" });

  const threshold = Math.max(2, Math.round(recurrenceThreshold));
  const critical = threshold * 2;

  const money = useMemo(() => {
    const fmt = new Intl.NumberFormat("es-CO", {
      style: "currency",
      currency,
      maximumFractionDigits: 0
    });
    return (n: number): string => fmt.format(Math.round(n));
  }, [currency]);

  /** Resumen global (sin filtros): alimenta las tarjetas, que a su vez son el filtro. */
  const summary = useMemo(() => {
    const perCategory = {} as Record<LossCategoryKey, { cost: number; incidents: number }>;
    for (const k of LOSS_CATEGORY_KEYS) perCategory[k] = { cost: 0, incidents: 0 };
    let affected = 0;
    for (const row of rows) {
      let any = false;
      for (const k of LOSS_CATEGORY_KEYS) {
        const b = row.byCategory[k];
        if (!b) continue;
        const c = safe(b.cost);
        const i = Math.round(safe(b.incidents));
        perCategory[k].cost += c;
        perCategory[k].incidents += i;
        if (c > 0 || safe(b.quantity) > 0 || i > 0) any = true;
      }
      if (any) affected += 1;
    }
    const total = LOSS_CATEGORY_KEYS.reduce((acc, k) => acc + perCategory[k].cost, 0);
    const events = LOSS_CATEGORY_KEYS.reduce((acc, k) => acc + perCategory[k].incidents, 0);
    return { perCategory, total, events, affected };
  }, [rows]);

  const isEmpty = summary.affected === 0;

  /** Filas de la tabla: filtro por categoría → (conteo de reincidentes) → búsqueda → orden. */
  const { visibleRows, recurrentCount, baseCount } = useMemo(() => {
    const base = rows.map((r) => buildViewRow(r, categoryFilter)).filter(hasLoss);
    const recurrent = base.filter((v) => v.incidents >= threshold);
    const q = query.trim().toLocaleLowerCase("es-CO");

    let list = onlyRecurrent ? recurrent : base;
    if (q) list = list.filter((v) => v.row.name.toLocaleLowerCase("es-CO").includes(q));

    const dir = sort.dir === "asc" ? 1 : -1;
    const sorted = [...list].sort((a, b) => {
      switch (sort.key) {
        case "name":
          return a.row.name.localeCompare(b.row.name, "es-CO") * dir;
        case "stock":
          return (a.row.currentStock - b.row.currentStock) * dir;
        case "quantity":
          return (a.quantity - b.quantity) * dir;
        case "incidents":
          return (a.incidents - b.incidents) * dir;
        case "pct": {
          // Los ítems sin base de cálculo van siempre al final.
          if (a.pct === null && b.pct === null) return 0;
          if (a.pct === null) return 1;
          if (b.pct === null) return -1;
          return (a.pct - b.pct) * dir;
        }
        case "cost":
        default:
          return (a.cost - b.cost) * dir;
      }
    });
    return { visibleRows: sorted, recurrentCount: recurrent.length, baseCount: base.length };
  }, [rows, categoryFilter, query, onlyRecurrent, sort, threshold]);

  const handleSort = (key: SortKey) => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === "desc" ? "asc" : "desc" }
        : { key, dir: key === "name" ? "asc" : "desc" }
    );
  };

  const handlePeriod = (value: LossPeriod) => {
    setInternalPeriod(value);
    onPeriodChange?.(value);
  };

  const clearFilters = () => {
    setQuery("");
    setCategoryFilter(null);
    setOnlyRecurrent(false);
  };

  const filtersActive = query.trim() !== "" || categoryFilter !== null || onlyRecurrent;

  /* Indicadores del hero */
  const revenueShare =
    revenue !== null && revenue > 0 && summary.total > 0 ? (summary.total / revenue) * 100 : null;
  const hasPrev = previousTotalCost !== null && previousTotalCost > 0;
  const delta = hasPrev ? ((summary.total - previousTotalCost) / previousTotalCost) * 100 : null;

  const rootClass = className ? `lcd ${className}` : "lcd";

  return (
    <div className={rootClass} aria-busy={loading || undefined}>
      <style>{CSS}</style>

      <header className="lcd-header">
        <div className="lcd-header-text">
          <h1 id={titleId} className="lcd-title">
            Centro de Pérdidas
          </h1>
          <p className="lcd-subtitle">
            Cuánto dinero se fuga del negocio, por qué motivo y en qué productos.
          </p>
        </div>
        <div className="lcd-header-actions">
          <div className="lcd-periods" role="group" aria-label="Período de análisis">
            {PERIODS.map((p) => (
              <button
                key={p.value}
                type="button"
                className="lcd-period"
                aria-pressed={activePeriod === p.value}
                onClick={() => handlePeriod(p.value)}
              >
                {p.label}
              </button>
            ))}
          </div>
          {onRegisterLoss && !isEmpty && !loading && (
            <button type="button" className="lcd-btn lcd-btn-primary" onClick={onRegisterLoss}>
              <Icon name="plus" size={16} />
              Registrar pérdida
            </button>
          )}
        </div>
      </header>

      {error && (
        <div className="lcd-error" role="alert">
          <Icon name="alert" size={18} />
          <span>{error}</span>
        </div>
      )}

      {!loading && expiryRisk.length > 0 && (
        <ExpiryRiskPanel items={expiryRisk} warningDays={expiryWarningDays} money={money} />
      )}

      {loading ? (
        <LoadingSkeleton />
      ) : isEmpty ? (
        <section className="lcd-empty" aria-labelledby={emptyTitleId}>
          <div className="lcd-empty-icon">
            <Icon name="alert" size={34} />
          </div>
          <h2 id={emptyTitleId} className="lcd-empty-title">
            Sin pérdidas registradas {periodMeta.sentence}
          </h2>
          <p className="lcd-empty-text">
            Registra mermas, vencimientos, cortesías o cualquier salida sin venta para ver cuánto te
            cuesta y en dónde se fuga el dinero. Mientras más al día esté el registro, más precisos
            serán los números.
          </p>
          {onRegisterLoss && (
            <button type="button" className="lcd-btn lcd-btn-primary lcd-btn-lg" onClick={onRegisterLoss}>
              <Icon name="plus" size={18} />
              Registrar merma o salida sin venta
            </button>
          )}
          <ul className="lcd-empty-chips" aria-label="Tipos de pérdida que puedes registrar">
            {LOSS_CATEGORY_KEYS.map((k) => (
              <li key={k} className="lcd-chip" data-cat={k}>
                <Icon name={CATEGORY_META[k].icon} size={14} />
                {CATEGORY_META[k].label}
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <>
          {/* ─────────── 1. Resumen ejecutivo ─────────── */}
          <section className="lcd-impact" aria-label="Resumen de pérdidas">
            <article className="lcd-hero">
              <div className="lcd-hero-top">
                <span className="lcd-hero-icon">
                  <Icon name="trendingDown" size={22} />
                </span>
                <div>
                  <p className="lcd-eyebrow">Costo total de pérdidas · {periodMeta.label}</p>
                  <p className="lcd-hero-value">{money(summary.total)}</p>
                </div>
              </div>

              <div className="lcd-hero-meta">
                {revenueShare !== null ? (
                  <span className="lcd-meta-pill" data-tone={revenueShare >= 5 ? "danger" : "warn"}>
                    {fmtPct(revenueShare)} de los ingresos
                  </span>
                ) : (
                  <span className="lcd-meta-pill" data-tone="muted">
                    % de ingresos no disponible
                  </span>
                )}
                {delta !== null && (
                  <span className="lcd-meta-pill" data-tone={delta > 0 ? "danger" : "success"}>
                    <Icon name={delta > 0 ? "arrowUp" : "arrowDown"} size={12} />
                    {fmtPct(Math.abs(delta))} vs. período anterior
                  </span>
                )}
                <span className="lcd-meta-text">
                  {summary.affected} {summary.affected === 1 ? "ítem afectado" : "ítems afectados"} ·{" "}
                  {summary.events} {summary.events === 1 ? "evento" : "eventos"}
                </span>
              </div>

              <div
                className="lcd-stack"
                role="img"
                aria-label={`Distribución del costo por categoría: ${LOSS_CATEGORY_KEYS.filter(
                  (k) => summary.perCategory[k].cost > 0
                )
                  .map((k) => `${CATEGORY_META[k].label} ${fmtPct((summary.perCategory[k].cost / summary.total) * 100)}`)
                  .join(", ")}`}
              >
                {summary.total > 0 ? (
                  LOSS_CATEGORY_KEYS.filter((k) => summary.perCategory[k].cost > 0).map((k) => (
                    <span
                      key={k}
                      className="lcd-stack-seg"
                      data-cat={k}
                      style={{ width: `${(summary.perCategory[k].cost / summary.total) * 100}%` }}
                    />
                  ))
                ) : (
                  <span className="lcd-stack-seg" data-cat="none" style={{ width: "100%" }} />
                )}
              </div>
            </article>

            {LOSS_CATEGORY_KEYS.map((k) => {
              const meta = CATEGORY_META[k];
              const { cost, incidents } = summary.perCategory[k];
              const share = summary.total > 0 ? (cost / summary.total) * 100 : 0;
              const active = categoryFilter === k;
              return (
                <button
                  key={k}
                  type="button"
                  className="lcd-card"
                  data-cat={k}
                  aria-pressed={active}
                  onClick={() => setCategoryFilter(active ? null : k)}
                  title={active ? "Quitar filtro" : `Filtrar la tabla por ${meta.label.toLocaleLowerCase("es-CO")}`}
                >
                  <span className="lcd-card-head">
                    <span className="lcd-card-icon">
                      <Icon name={meta.icon} size={18} />
                    </span>
                    <span className="lcd-card-share">{cost > 0 ? fmtPct(share) : "—"}</span>
                  </span>
                  <span className="lcd-card-label">{meta.label}</span>
                  <span className="lcd-card-value">{money(cost)}</span>
                  <span className="lcd-card-hint">
                    {incidents > 0 ? `${times(incidents)} · ${meta.hint}` : meta.hint}
                  </span>
                  <span className="lcd-card-bar" aria-hidden="true">
                    <span style={{ width: `${share}%` }} />
                  </span>
                </button>
              );
            })}
          </section>

          {/* ─────────── 2. Tabla analítica ─────────── */}
          <section className="lcd-panel" aria-label="Detalle de pérdidas por producto o insumo">
            <div className="lcd-panel-head">
              <div>
                <h2 className="lcd-panel-title">Detalle por producto o insumo</h2>
                <p className="lcd-panel-sub">
                  {categoryFilter ? (
                    <>
                      Filtrado por <strong>{CATEGORY_META[categoryFilter].label}</strong> ·{" "}
                    </>
                  ) : null}
                  {visibleRows.length} de {baseCount} {baseCount === 1 ? "ítem" : "ítems"}
                </p>
              </div>
              <div className="lcd-tools">
                <label className="lcd-search">
                  <Icon name="search" size={16} />
                  <input
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Buscar producto o insumo"
                    aria-label="Buscar producto o insumo"
                  />
                </label>
                {filtersActive && (
                  <button type="button" className="lcd-btn lcd-btn-ghost" onClick={clearFilters}>
                    <Icon name="x" size={14} />
                    Limpiar filtros
                  </button>
                )}
              </div>
            </div>

            {recurrentCount > 0 && (
              <div className="lcd-recurrence" role="status">
                <span className="lcd-recurrence-icon">
                  <Icon name="repeat" size={18} />
                </span>
                <p>
                  <strong>
                    {recurrentCount} {recurrentCount === 1 ? "ítem reincidente" : "ítems reincidentes"}
                  </strong>
                  : la misma pérdida se repitió {threshold} o más veces {periodMeta.sentence}. Suele
                  indicar un problema de proceso, no mala suerte.
                </p>
                <button
                  type="button"
                  className="lcd-btn lcd-btn-ghost"
                  aria-pressed={onlyRecurrent}
                  onClick={() => setOnlyRecurrent((v) => !v)}
                >
                  {onlyRecurrent ? "Ver todos" : "Ver solo reincidentes"}
                </button>
              </div>
            )}

            <div className="lcd-table-wrap">
              <table className="lcd-table">
                <caption className="lcd-sr">
                  Pérdidas por producto o insumo en {periodMeta.label.toLocaleLowerCase("es-CO")}
                </caption>
                <thead>
                  <tr>
                    <SortHeader label="Producto / insumo" k="name" sort={sort} onSort={handleSort} />
                    <SortHeader label="Stock actual" k="stock" sort={sort} onSort={handleSort} align="end" />
                    <SortHeader label="Cant. perdida" k="quantity" sort={sort} onSort={handleSort} align="end" />
                    <SortHeader label="% sobre disponible" k="pct" sort={sort} onSort={handleSort} />
                    <th scope="col">Categoría dominante</th>
                    <SortHeader label="Costo" k="cost" sort={sort} onSort={handleSort} align="end" />
                    <SortHeader label="Reincidencia" k="incidents" sort={sort} onSort={handleSort} />
                  </tr>
                </thead>
                <tbody>
                  {visibleRows.length === 0 ? (
                    <tr className="lcd-row-empty">
                      <td colSpan={7}>
                        <p>No hay ítems que coincidan con los filtros.</p>
                        <button type="button" className="lcd-btn lcd-btn-ghost" onClick={clearFilters}>
                          Limpiar filtros
                        </button>
                      </td>
                    </tr>
                  ) : (
                    visibleRows.map((v) => (
                      <LossTableRow
                        key={v.row.id}
                        view={v}
                        money={money}
                        threshold={threshold}
                        critical={critical}
                        onSelect={onSelectRow}
                      />
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}

/* ═══════════════════════════════ Piezas internas ═══════════════════════════════ */

function SortHeader({
  label,
  k,
  sort,
  onSort,
  align
}: {
  label: string;
  k: SortKey;
  sort: { key: SortKey; dir: SortDir };
  onSort: (key: SortKey) => void;
  align?: "end";
}) {
  const active = sort.key === k;
  const ariaSort = active ? (sort.dir === "asc" ? "ascending" : "descending") : "none";
  return (
    <th scope="col" aria-sort={ariaSort} data-align={align}>
      <button type="button" className="lcd-sort" data-active={active} onClick={() => onSort(k)}>
        {label}
        <span className="lcd-sort-icon" data-dir={active ? sort.dir : undefined}>
          <Icon name="chevron" size={14} />
        </span>
      </button>
    </th>
  );
}

function LossTableRow({
  view,
  money,
  threshold,
  critical,
  onSelect
}: {
  view: ViewRow;
  money: (n: number) => string;
  threshold: number;
  critical: number;
  onSelect?: (row: LossRow) => void;
}) {
  const { row, cost, quantity, incidents, pct, dominant } = view;
  const sev = severity(pct);
  const stockOut = row.currentStock <= 0;
  const last = fmtDate(row.lastIncidentAt);
  const level = incidents >= critical ? "critical" : incidents >= threshold ? "recurrent" : "normal";

  return (
    <tr
      className="lcd-row"
      data-clickable={onSelect ? "true" : undefined}
      onClick={onSelect ? () => onSelect(row) : undefined}
    >
      <th scope="row" className="lcd-cell-name" data-label="Producto / insumo">
        {onSelect ? (
          <button
            type="button"
            className="lcd-name-btn"
            onClick={(e) => {
              e.stopPropagation();
              onSelect(row);
            }}
          >
            {row.name}
          </button>
        ) : (
          <span className="lcd-name">{row.name}</span>
        )}
        <span className="lcd-kind">{row.kind === "insumo" ? "Insumo" : "Producto"}</span>
      </th>

      <td data-label="Stock actual" data-align="end">
        <span className={stockOut ? "lcd-stock lcd-stock-out" : "lcd-stock"}>
          {fmtQty(row.currentStock)} <small>{row.unit}</small>
        </span>
        {stockOut && <span className="lcd-tag" data-tone="danger">{row.currentStock < 0 ? "Negativo" : "Agotado"}</span>}
      </td>

      <td data-label="Cant. perdida" data-align="end">
        {fmtQty(quantity)} <small>{row.unit}</small>
      </td>

      <td data-label="% sobre disponible">
        {pct === null ? (
          <span className="lcd-muted" title="No hay cantidad disponible registrada para calcularlo">
            Sin base
          </span>
        ) : (
          <div className="lcd-meter" data-sev={sev}>
            <span className="lcd-meter-track" aria-hidden="true">
              <span className="lcd-meter-fill" style={{ width: `${Math.max(pct, pct > 0 ? 3 : 0)}%` }} />
            </span>
            <span className="lcd-meter-value">{fmtPct(pct)}</span>
          </div>
        )}
      </td>

      <td data-label="Categoría dominante">
        {dominant ? (
          <span className="lcd-chip" data-cat={dominant.key}>
            <Icon name={CATEGORY_META[dominant.key].icon} size={14} />
            {CATEGORY_META[dominant.key].label}
            {dominant.share < 0.995 && <em>{fmtPct(dominant.share * 100)}</em>}
          </span>
        ) : (
          <span className="lcd-muted">—</span>
        )}
      </td>

      <td data-label="Costo" data-align="end" className="lcd-cost">
        {money(cost)}
      </td>

      <td data-label="Reincidencia">
        {level === "normal" ? (
          <span className="lcd-muted">{incidents > 0 ? times(incidents) : "—"}</span>
        ) : (
          <span className="lcd-tag" data-tone={level === "critical" ? "danger" : "warn"}>
            <Icon name="repeat" size={12} />
            {level === "critical" ? "Crítica" : "Reincidente"} · {times(incidents)}
          </span>
        )}
        {last && <span className="lcd-last">Último: {last}</span>}
      </td>
    </tr>
  );
}

function LoadingSkeleton() {
  return (
    <div className="lcd-skeleton" role="status" aria-live="polite">
      <span className="lcd-sr">Cargando pérdidas…</span>
      <div className="lcd-sk lcd-sk-hero" />
      <div className="lcd-sk-grid">
        {LOSS_CATEGORY_KEYS.map((k) => (
          <div key={k} className="lcd-sk lcd-sk-card" />
        ))}
      </div>
      <div className="lcd-sk lcd-sk-table" />
    </div>
  );
}

/* ═══════════════════════════════ Estilos internos ═══════════════════════════════ */

const CSS = `
.lcd {
  --lcd-bg: var(--vimdy-background, #0a0a0c);
  --lcd-surface: var(--vimdy-surface, #18181b);
  --lcd-surface-2: var(--vimdy-surface-hover, #1f1f23);
  --lcd-surface-3: var(--vimdy-surface-active, #232327);
  --lcd-border: var(--vimdy-border, #27272f);
  --lcd-border-soft: var(--vimdy-border-subtle, #1c1c21);
  --lcd-text: var(--vimdy-text, #f5f5f4);
  --lcd-muted: var(--vimdy-text-secondary, #a1a1aa);
  --lcd-accent: var(--vimdy-accent, #2563eb);
  --lcd-accent-hover: var(--vimdy-accent-hover, #3b82f6);
  --lcd-danger: var(--vimdy-danger, #ef4444);
  --lcd-warning: var(--vimdy-warning, #f59e0b);
  --lcd-success: var(--vimdy-success, #22c55e);
  --lcd-radius: 16px;

  color-scheme: dark;
  color: var(--lcd-text);
  font-family: var(--vimdy-font, 'Inter', 'Segoe UI', system-ui, -apple-system, sans-serif);
  font-size: 14px;
  line-height: 1.45;
  display: grid;
  grid-template-columns: minmax(0, 1fr);
  gap: 20px;
  width: 100%;
  max-width: 1280px;
  margin-inline: auto;
}
.lcd *, .lcd *::before, .lcd *::after { box-sizing: border-box; }
.lcd button, .lcd input { font: inherit; color: inherit; }
.lcd button { cursor: pointer; }
.lcd :focus-visible { outline: 2px solid var(--lcd-accent-hover); outline-offset: 2px; }
.lcd-sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
.lcd-muted { color: var(--lcd-muted); }
.lcd small { color: var(--lcd-muted); font-size: 12px; }

/* Categorías: un solo color por categoría, reutilizado en chips, tarjetas y barras */
.lcd [data-cat="vencimiento"] { --c: #f59e0b; }
.lcd [data-cat="desperdicio"] { --c: #ef4444; }
.lcd [data-cat="merma_preparacion"] { --c: #f97316; }
.lcd [data-cat="cortesia"] { --c: #38bdf8; }
.lcd [data-cat="faltante"] { --c: #a855f7; }
.lcd [data-cat="none"] { --c: var(--lcd-border); }

/* Encabezado */
.lcd-header { display: flex; flex-wrap: wrap; align-items: flex-end; justify-content: space-between; gap: 16px; }
.lcd-title { margin: 0; font-size: 30px; line-height: 1.15; font-weight: 700; letter-spacing: -0.01em; }
.lcd-subtitle { margin: 6px 0 0; color: var(--lcd-muted); font-size: 14px; }
.lcd-header-text { min-width: 0; }
.lcd-header-actions { min-width: 0; display: flex; flex-wrap: wrap; align-items: center; gap: 12px; max-width: 100%; }

.lcd-periods {
  min-width: 0; display: flex; gap: 2px; padding: 3px; max-width: 100%; overflow-x: auto;
  background: var(--lcd-surface); border: 1px solid var(--lcd-border); border-radius: 12px;
  scrollbar-width: none;
}
.lcd-periods::-webkit-scrollbar { display: none; }
.lcd-period {
  flex: none; height: 34px; padding: 0 14px; border: 0; border-radius: 9px; background: transparent;
  color: var(--lcd-muted); font-weight: 600; font-size: 13px; white-space: nowrap;
  transition: background 150ms ease, color 150ms ease;
}
.lcd-period:hover { color: var(--lcd-text); background: var(--lcd-surface-2); }
.lcd-period[aria-pressed="true"] { background: var(--lcd-accent); color: #fff; }

/* Botones */
.lcd-btn {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  height: 38px; padding: 0 16px; border-radius: 10px; border: 1px solid transparent;
  font-weight: 600; font-size: 13px; white-space: nowrap;
  transition: background 150ms ease, border-color 150ms ease, color 150ms ease;
}
.lcd-btn-primary { background: var(--lcd-accent); color: #fff; }
.lcd-btn-primary:hover { background: var(--lcd-accent-hover); }
.lcd-btn-lg { height: 46px; padding: 0 24px; font-size: 14px; border-radius: 12px; }
.lcd-btn-ghost { background: var(--lcd-surface-2); border-color: var(--lcd-border); color: var(--lcd-text); }
.lcd-btn-ghost:hover { background: var(--lcd-surface-3); }
.lcd-btn-ghost[aria-pressed="true"] { border-color: var(--lcd-accent); color: var(--lcd-accent-hover); }

/* Error */
.lcd-expiry {
  display: grid; gap: 10px; padding: 14px 16px; margin-bottom: 16px; border-radius: 14px;
  color: var(--lcd-warning); background: color-mix(in srgb, var(--lcd-warning) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--lcd-warning) 35%, transparent);
}
.lcd-expiry-head { display: flex; gap: 10px; align-items: flex-start; }
.lcd-expiry-title { margin: 0; font-weight: 700; }
.lcd-expiry-sub { margin: 2px 0 0; font-size: 13px; opacity: 0.85; }
.lcd-expiry-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.lcd-expiry-item { display: flex; flex-wrap: wrap; gap: 4px 12px; align-items: baseline; font-size: 13px; }
.lcd-expiry-item[data-tone="danger"] { color: var(--lcd-danger); }
.lcd-expiry-name { font-weight: 600; }
.lcd-expiry-qty, .lcd-expiry-when, .lcd-expiry-value { opacity: 0.9; }
.lcd-expiry-more { margin: 0; font-size: 12px; opacity: 0.8; }
.lcd-error {
  display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-radius: 12px;
  color: var(--lcd-danger); background: color-mix(in srgb, var(--lcd-danger) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--lcd-danger) 35%, transparent);
}

/* ───── Resumen ejecutivo ───── */
.lcd-impact { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.lcd-hero {
  grid-column: 1 / -1; display: grid; gap: 16px; padding: 22px; border-radius: 20px;
  border: 1px solid var(--lcd-border);
  background:
    radial-gradient(120% 140% at 0% 0%, color-mix(in srgb, var(--lcd-danger) 14%, transparent), transparent 55%),
    var(--lcd-surface);
}
.lcd-hero-top { display: flex; align-items: center; gap: 16px; }
.lcd-hero-icon {
  flex: none; width: 48px; height: 48px; display: grid; place-items: center; border-radius: 14px;
  color: var(--lcd-danger); background: color-mix(in srgb, var(--lcd-danger) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--lcd-danger) 30%, transparent);
}
.lcd-eyebrow { margin: 0; color: var(--lcd-muted); font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.lcd-hero-value { margin: 2px 0 0; font-size: clamp(30px, 5vw, 44px); line-height: 1.1; font-weight: 800; letter-spacing: -0.02em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lcd-hero-meta { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 10px; }
.lcd-meta-text { color: var(--lcd-muted); font-size: 13px; }
.lcd-meta-pill {
  display: inline-flex; align-items: center; gap: 5px; padding: 4px 10px; border-radius: 999px;
  font-size: 12px; font-weight: 700; border: 1px solid transparent;
}
.lcd-meta-pill[data-tone="danger"] { color: var(--lcd-danger); background: color-mix(in srgb, var(--lcd-danger) 12%, transparent); border-color: color-mix(in srgb, var(--lcd-danger) 30%, transparent); }
.lcd-meta-pill[data-tone="warn"] { color: var(--lcd-warning); background: color-mix(in srgb, var(--lcd-warning) 12%, transparent); border-color: color-mix(in srgb, var(--lcd-warning) 30%, transparent); }
.lcd-meta-pill[data-tone="success"] { color: var(--lcd-success); background: color-mix(in srgb, var(--lcd-success) 12%, transparent); border-color: color-mix(in srgb, var(--lcd-success) 30%, transparent); }
.lcd-meta-pill[data-tone="muted"] { color: var(--lcd-muted); background: var(--lcd-surface-2); border-color: var(--lcd-border); font-weight: 600; }

.lcd-stack { display: flex; gap: 3px; height: 10px; }
.lcd-stack-seg { display: block; height: 100%; min-width: 4px; border-radius: 999px; background: var(--c); transition: width 500ms ease; }

/* Tarjetas por categoría (también funcionan como filtro de la tabla) */
.lcd-card {
  position: relative; display: flex; flex-direction: column; gap: 4px; padding: 16px; text-align: left;
  background: var(--lcd-surface); border: 1px solid var(--lcd-border); border-radius: var(--lcd-radius);
  transition: border-color 150ms ease, background 150ms ease, transform 150ms ease;
}
.lcd-card:hover { background: var(--lcd-surface-2); border-color: color-mix(in srgb, var(--c) 55%, var(--lcd-border)); }
.lcd-card[aria-pressed="true"] {
  border-color: var(--c); background: color-mix(in srgb, var(--c) 9%, var(--lcd-surface));
  box-shadow: 0 0 0 3px color-mix(in srgb, var(--c) 22%, transparent);
}
.lcd-card-head { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6px; }
.lcd-card-icon {
  width: 36px; height: 36px; display: grid; place-items: center; border-radius: 10px; color: var(--c);
  background: color-mix(in srgb, var(--c) 14%, transparent);
}
.lcd-card-share { color: var(--lcd-muted); font-size: 12px; font-weight: 700; font-variant-numeric: tabular-nums; }
.lcd-card-label { color: var(--lcd-muted); font-size: 13px; font-weight: 600; }
.lcd-card-value { font-size: 22px; font-weight: 800; letter-spacing: -0.01em; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.lcd-card-hint { color: var(--lcd-muted); font-size: 12px; }
.lcd-card-bar { display: block; height: 4px; margin-top: 10px; border-radius: 999px; background: var(--lcd-surface-3); overflow: hidden; }
.lcd-card-bar > span { display: block; height: 100%; border-radius: inherit; background: var(--c); transition: width 500ms ease; }

/* ───── Panel y tabla ───── */
.lcd-panel { background: var(--lcd-surface); border: 1px solid var(--lcd-border); border-radius: 20px; overflow: hidden; }
.lcd-panel-head { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 18px 20px; border-bottom: 1px solid var(--lcd-border); }
.lcd-panel-title { margin: 0; font-size: 17px; font-weight: 700; }
.lcd-panel-sub { margin: 2px 0 0; color: var(--lcd-muted); font-size: 13px; }
.lcd-panel-sub strong { color: var(--lcd-text); }
.lcd-tools { display: flex; flex-wrap: wrap; align-items: center; gap: 8px; }
.lcd-search {
  display: flex; align-items: center; gap: 8px; height: 38px; padding: 0 12px; width: 260px; max-width: 100%;
  color: var(--lcd-muted); background: var(--lcd-bg); border: 1px solid var(--lcd-border); border-radius: 10px;
}
.lcd-search:focus-within { border-color: var(--lcd-accent); box-shadow: 0 0 0 3px color-mix(in srgb, var(--lcd-accent) 25%, transparent); }
.lcd-search input { flex: 1; min-width: 0; border: 0; outline: 0; background: transparent; font-size: 13px; }
.lcd-search input::placeholder { color: var(--lcd-muted); opacity: 0.8; }

.lcd-recurrence {
  display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin: 16px 20px 0; padding: 12px 14px; border-radius: 12px;
  background: color-mix(in srgb, var(--lcd-warning) 9%, transparent);
  border: 1px solid color-mix(in srgb, var(--lcd-warning) 32%, transparent);
}
.lcd-recurrence-icon { flex: none; display: grid; place-items: center; color: var(--lcd-warning); }
.lcd-recurrence p { flex: 1 1 260px; margin: 0; color: var(--lcd-muted); font-size: 13px; }
.lcd-recurrence strong { color: var(--lcd-warning); }

.lcd-table-wrap { overflow-x: auto; }
.lcd-table { width: 100%; min-width: 900px; border-collapse: collapse; font-variant-numeric: tabular-nums; }
.lcd-table caption { text-align: left; }
.lcd-table th, .lcd-table td { padding: 12px 16px; text-align: left; vertical-align: middle; border-bottom: 1px solid var(--lcd-border-soft); }
.lcd-table thead th { padding-block: 10px; color: var(--lcd-muted); font-size: 12px; font-weight: 600; white-space: nowrap; background: var(--lcd-bg); border-bottom: 1px solid var(--lcd-border); }
.lcd-table [data-align="end"] { text-align: right; }
.lcd-table tbody tr:last-child > * { border-bottom: 0; }
.lcd-row { transition: background 120ms ease; }
.lcd-row:hover { background: var(--lcd-surface-2); }
.lcd-row[data-clickable="true"] { cursor: pointer; }

.lcd-sort { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; background: transparent; color: inherit; font-size: inherit; font-weight: inherit; white-space: nowrap; }
.lcd-sort:hover, .lcd-sort[data-active="true"] { color: var(--lcd-text); }
.lcd-table [data-align="end"] .lcd-sort { flex-direction: row-reverse; }
.lcd-sort-icon { display: inline-grid; opacity: 0; transition: transform 150ms ease, opacity 150ms ease; }
.lcd-sort:hover .lcd-sort-icon { opacity: 0.5; }
.lcd-sort-icon[data-dir] { opacity: 1; color: var(--lcd-accent-hover); }
.lcd-sort-icon[data-dir="asc"] { transform: rotate(180deg); }

.lcd-cell-name { font-weight: 600; }
.lcd-cell-name .lcd-name, .lcd-name-btn { display: block; max-width: 280px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.lcd-name-btn { padding: 0; border: 0; background: transparent; font-weight: 600; text-align: left; }
.lcd-name-btn:hover { color: var(--lcd-accent-hover); text-decoration: underline; }
.lcd-kind { display: block; margin-top: 2px; color: var(--lcd-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; }
.lcd-stock { font-weight: 600; }
.lcd-stock-out { color: var(--lcd-danger); }
.lcd-cost { color: var(--lcd-danger); font-weight: 700; }
.lcd-last { display: block; margin-top: 3px; color: var(--lcd-muted); font-size: 11px; }

.lcd-chip {
  display: inline-flex; align-items: center; gap: 6px; padding: 4px 10px; border-radius: 999px; list-style: none;
  color: var(--c); font-size: 12px; font-weight: 600; white-space: nowrap;
  background: color-mix(in srgb, var(--c) 12%, transparent); border: 1px solid color-mix(in srgb, var(--c) 30%, transparent);
}
.lcd-chip em { font-style: normal; color: var(--lcd-muted); font-weight: 600; }

.lcd-tag {
  display: inline-flex; align-items: center; gap: 5px; padding: 3px 9px; border-radius: 999px;
  font-size: 11px; font-weight: 700; white-space: nowrap; border: 1px solid transparent;
}
.lcd-stock + .lcd-tag { margin-left: 6px; }
.lcd-tag[data-tone="danger"] { color: var(--lcd-danger); background: color-mix(in srgb, var(--lcd-danger) 12%, transparent); border-color: color-mix(in srgb, var(--lcd-danger) 32%, transparent); }
.lcd-tag[data-tone="warn"] { color: var(--lcd-warning); background: color-mix(in srgb, var(--lcd-warning) 12%, transparent); border-color: color-mix(in srgb, var(--lcd-warning) 32%, transparent); }

.lcd-meter { display: flex; align-items: center; gap: 10px; min-width: 130px; }
.lcd-meter-track { flex: 1; height: 6px; border-radius: 999px; background: var(--lcd-surface-3); overflow: hidden; }
.lcd-meter-fill { display: block; height: 100%; border-radius: inherit; background: var(--lcd-success); transition: width 500ms ease; }
.lcd-meter[data-sev="warn"] .lcd-meter-fill { background: var(--lcd-warning); }
.lcd-meter[data-sev="danger"] .lcd-meter-fill { background: var(--lcd-danger); }
.lcd-meter-value { min-width: 46px; text-align: right; font-weight: 700; font-size: 13px; }
.lcd-meter[data-sev="warn"] .lcd-meter-value { color: var(--lcd-warning); }
.lcd-meter[data-sev="danger"] .lcd-meter-value { color: var(--lcd-danger); }

.lcd-row-empty td { padding: 40px 16px; text-align: center; color: var(--lcd-muted); }
.lcd-row-empty p { margin: 0 0 12px; }

/* ───── Estado vacío ───── */
.lcd-empty {
  display: flex; flex-direction: column; align-items: center; text-align: center; gap: 12px;
  padding: 64px 24px; border-radius: 24px; border: 1px dashed var(--lcd-border);
  background:
    radial-gradient(60% 70% at 50% 0%, color-mix(in srgb, var(--lcd-warning) 8%, transparent), transparent 70%),
    var(--lcd-surface);
}
.lcd-empty-icon {
  width: 76px; height: 76px; display: grid; place-items: center; margin-bottom: 4px; border-radius: 24px;
  color: var(--lcd-warning); background: color-mix(in srgb, var(--lcd-warning) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--lcd-warning) 32%, transparent);
  box-shadow: 0 0 40px color-mix(in srgb, var(--lcd-warning) 14%, transparent);
}
.lcd-empty-title { margin: 0; font-size: 22px; font-weight: 700; letter-spacing: -0.01em; }
.lcd-empty-text { margin: 0 0 8px; max-width: 480px; color: var(--lcd-muted); font-size: 14px; line-height: 1.6; }
.lcd-empty-chips { display: flex; flex-wrap: wrap; justify-content: center; gap: 8px; margin: 12px 0 0; padding: 0; }

/* ───── Carga ───── */
.lcd-skeleton { display: grid; gap: 12px; }
.lcd-sk { border-radius: var(--lcd-radius); background: linear-gradient(90deg, var(--lcd-surface) 25%, var(--lcd-surface-2) 50%, var(--lcd-surface) 75%); background-size: 200% 100%; animation: lcd-shimmer 1.4s linear infinite; }
.lcd-sk-hero { height: 150px; border-radius: 20px; }
.lcd-sk-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(190px, 1fr)); gap: 12px; }
.lcd-sk-card { height: 128px; }
.lcd-sk-table { height: 320px; border-radius: 20px; }
@keyframes lcd-shimmer { to { background-position: -200% 0; } }

/* ───── Responsive ───── */
@media (max-width: 760px) {
  .lcd-title { font-size: 24px; }
  .lcd-header-actions { width: 100%; }
  .lcd-hero { padding: 18px; }
  .lcd-panel-head { padding: 16px; }
  .lcd-search { width: 100%; }
  .lcd-tools { width: 100%; }
  .lcd-recurrence { margin: 12px 16px 0; }
  .lcd-empty { padding: 44px 18px; }

  /* La tabla se convierte en tarjetas apiladas */
  .lcd-table { min-width: 0; }
  .lcd-table thead { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); }
  .lcd-table, .lcd-table tbody { display: block; }
  .lcd-row { display: grid; grid-template-columns: 1fr 1fr; gap: 10px 12px; padding: 14px 16px; border-bottom: 1px solid var(--lcd-border-soft); }
  .lcd-table tbody tr:last-child { border-bottom: 0; }
  .lcd-table th, .lcd-table td { padding: 0; border: 0; }
  .lcd-table [data-align="end"] { text-align: left; }
  .lcd-row > .lcd-cell-name { grid-column: 1 / -1; }
  .lcd-row > td[data-label]::before {
    content: attr(data-label); display: block; margin-bottom: 2px;
    color: var(--lcd-muted); font-size: 11px; font-weight: 600; letter-spacing: 0.03em; text-transform: uppercase;
  }
  .lcd-cell-name .lcd-name, .lcd-name-btn { max-width: 100%; }
  .lcd-row-empty { display: block; padding: 0; }
}

@media (prefers-reduced-motion: reduce) {
  .lcd *, .lcd *::before, .lcd *::after { animation: none !important; transition: none !important; }
}
`;