import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  Anchor,
  DollarSign,
  Percent,
  PiggyBank,
  Puzzle,
  Receipt,
  Star,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  Wallet,
  Zap
} from "lucide-react";

import {
  MENU_MATRIX_ADVICE,
  MENU_MATRIX_LABELS,
  buildMenuMatrix,
  computeProfitSummary,
  type MarginBasis,
  type MenuMatrixCategory,
  type MenuMatrixItem,
  type ProfitCatalogItem,
  type ProfitInput,
  type ProfitOperatingExpense,
  type ProfitSaleLine,
  type ProfitSummary
} from "../../../core/domain/profit/profitEngine";
import { container, productsReady } from "../../../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "../../../hooks/useVimdyCore";
import { companyConfigStore } from "../../../core/store/companyConfigStore";
import { getSaleNetItems, isRevenueSaleStatus } from "../../../core/utils/saleRefunds";
import { startOfBusinessDay, startOfBusinessMonth, startOfBusinessWeek, startOfBusinessYear } from "../../../core/utils/businessTime";

/* ========================================================================== */
/* Props                                                                      */
/* ========================================================================== */

export type ProfitCenterTheme = "dark" | "light" | "auto";

/** Props de la vista pura: todo llega ya resuelto por props, sin acceso a datos. */
export interface ProfitCenterViewProps {
  /** Catálogo (con recetas e insumos al costo actual), ventas del periodo y gastos operativos. */
  readonly input: ProfitInput;
  /** Muestra esqueletos de carga en lugar de cifras. */
  readonly loading?: boolean | undefined;
  /** Mensaje de error de carga (se muestra como aviso sobre el contenido). */
  readonly error?: string | null | undefined;
  /** Código ISO de la moneda. Por defecto "COP". */
  readonly currency?: string | undefined;
  /** Idioma para formatear números. Por defecto "es-CO". */
  readonly locale?: string | undefined;
  /** Medida de margen de la Matriz de Menú. Por defecto ganancia por unidad. */
  readonly marginBasis?: MarginBasis | undefined;
  /** Texto del periodo mostrado bajo el título (p. ej. "Últimos 7 días"). */
  readonly periodLabel?: string | undefined;
  /** Controles extra bajo el título (p. ej. el selector de periodo). */
  readonly periodControl?: ReactNode;
  /**
   * Tema. "dark" (por defecto) es el aspecto nativo de VIMDY; "light" fuerza
   * claro; "auto" sigue la preferencia del sistema.
   */
  readonly theme?: ProfitCenterTheme | undefined;
  /** Acción del estado vacío ("Registrar primera venta"). Si falta, no se muestra el botón. */
  readonly onRegisterSale?: (() => void) | undefined;
}

/**
 * Props del componente público. Con `input` actúa como vista pura; sin él
 * (como lo monta ProfitCenterPage) carga ventas y catálogo reales por su
 * cuenta y se refresca solo ante ventas e inventario.
 */
export interface ProfitCenterDashboardProps extends ProfitViewPassThrough {
  readonly input?: ProfitInput | undefined;
  /** Gastos operativos del periodo; sin ellos la ganancia neta es igual a la bruta. */
  readonly operatingExpenses?: readonly ProfitOperatingExpense[] | undefined;
}

type ProfitViewPassThrough = Omit<ProfitCenterViewProps, "input" | "periodControl" | "loading" | "error">;

/* ========================================================================== */
/* Estilos autocontenidos                                                     */
/* ========================================================================== */

const STYLES = `
.pcd{
  --pcd-bg:#0A0A0C;--pcd-surface:#141418;--pcd-surface-2:#1B1B20;--pcd-border:#27272F;--pcd-border-soft:#1C1C21;
  --pcd-text:#F5F5F4;--pcd-muted:#A1A1AA;--pcd-faint:#6B6B74;
  --pcd-accent:#2563EB;--pcd-accent-ink:#FFFFFF;--pcd-accent-soft:rgba(37,99,235,.16);
  --pcd-good:#22C55E;--pcd-good-soft:rgba(34,197,94,.14);
  --pcd-warn:#F59E0B;--pcd-warn-soft:rgba(245,158,11,.14);
  --pcd-bad:#EF4444;--pcd-bad-soft:rgba(239,68,68,.14);
  --pcd-star:#EAB308;--pcd-star-soft:rgba(234,179,8,.14);
  --pcd-horse:#38BDF8;--pcd-horse-soft:rgba(56,189,248,.14);
  --pcd-puzzle:#A855F7;--pcd-puzzle-soft:rgba(168,85,247,.16);
  --pcd-dog:#94A3B8;--pcd-dog-soft:rgba(148,163,184,.14);
  font-family:'Inter','Segoe UI',system-ui,-apple-system,sans-serif;
  color:var(--pcd-text);display:flex;flex-direction:column;gap:24px;width:100%;
}
.pcd[data-theme="light"]{
  --pcd-bg:#F6F7F9;--pcd-surface:#FFFFFF;--pcd-surface-2:#F1F3F6;--pcd-border:#DDE2E8;--pcd-border-soft:#E8ECF0;
  --pcd-text:#14181F;--pcd-muted:#566070;--pcd-faint:#8A94A3;
  --pcd-accent:#1D4ED8;--pcd-accent-soft:rgba(29,78,216,.10);
  --pcd-good:#15803D;--pcd-good-soft:rgba(21,128,61,.10);
  --pcd-warn:#A15C00;--pcd-warn-soft:rgba(161,92,0,.10);
  --pcd-bad:#B42318;--pcd-bad-soft:rgba(180,35,24,.09);
  --pcd-star:#946200;--pcd-star-soft:rgba(148,98,0,.10);
  --pcd-horse:#0B6A8F;--pcd-horse-soft:rgba(11,106,143,.10);
  --pcd-puzzle:#7E22CE;--pcd-puzzle-soft:rgba(126,34,206,.09);
  --pcd-dog:#546074;--pcd-dog-soft:rgba(84,96,116,.10);
}
@media (prefers-color-scheme:light){
  .pcd[data-theme="auto"]{
    --pcd-bg:#F6F7F9;--pcd-surface:#FFFFFF;--pcd-surface-2:#F1F3F6;--pcd-border:#DDE2E8;--pcd-border-soft:#E8ECF0;
    --pcd-text:#14181F;--pcd-muted:#566070;--pcd-faint:#8A94A3;
    --pcd-accent:#1D4ED8;--pcd-accent-soft:rgba(29,78,216,.10);
    --pcd-good:#15803D;--pcd-good-soft:rgba(21,128,61,.10);
    --pcd-warn:#A15C00;--pcd-warn-soft:rgba(161,92,0,.10);
    --pcd-bad:#B42318;--pcd-bad-soft:rgba(180,35,24,.09);
    --pcd-star:#946200;--pcd-star-soft:rgba(148,98,0,.10);
    --pcd-horse:#0B6A8F;--pcd-horse-soft:rgba(11,106,143,.10);
    --pcd-puzzle:#7E22CE;--pcd-puzzle-soft:rgba(126,34,206,.09);
    --pcd-dog:#546074;--pcd-dog-soft:rgba(84,96,116,.10);
  }
}
.pcd *,.pcd *::before,.pcd *::after{box-sizing:border-box}

.pcd-head h1{margin:0;font-size:1.875rem;line-height:1.15;font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:10px}
.pcd-head h1 svg{color:var(--pcd-accent);flex:none}
.pcd-head p{margin:6px 0 0;font-size:.875rem;color:var(--pcd-muted);max-width:62ch;line-height:1.5}
.pcd-period{display:inline-block;margin-top:10px;font-size:.75rem;font-weight:600;color:var(--pcd-muted);
  border:1px solid var(--pcd-border);background:var(--pcd-surface);padding:3px 10px;border-radius:999px}

.pcd-range{display:flex;flex-wrap:wrap;gap:8px;margin-top:14px}
.pcd-banner{display:flex;gap:10px;align-items:flex-start;padding:12px 14px;border-radius:12px;font-size:.875rem;line-height:1.45;
  border:1px solid color-mix(in srgb,var(--pcd-warn) 40%,transparent);background:var(--pcd-warn-soft);color:var(--pcd-warn)}
.pcd-banner svg{flex:none;margin-top:2px}

.pcd-cards{display:grid;gap:14px;grid-template-columns:repeat(2,minmax(0,1fr))}
@media (min-width:1024px){.pcd-cards{grid-template-columns:repeat(5,minmax(0,1fr))}}
@media (max-width:420px){.pcd-cards{grid-template-columns:minmax(0,1fr)}}
.pcd-card{position:relative;background:var(--pcd-surface);border:1px solid var(--pcd-border);border-radius:16px;padding:18px;
  display:flex;flex-direction:column;gap:10px;min-width:0;overflow:hidden}
.pcd-card[data-hero="true"]{background:linear-gradient(160deg,var(--pcd-accent-soft),var(--pcd-surface) 70%);
  border-color:color-mix(in srgb,var(--pcd-accent) 45%,var(--pcd-border))}
.pcd-card-top{display:flex;align-items:center;justify-content:space-between;gap:8px}
.pcd-card-label{font-size:.75rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--pcd-muted)}
.pcd-card-icon{width:32px;height:32px;border-radius:10px;display:grid;place-items:center;flex:none;
  background:var(--pcd-surface-2);color:var(--pcd-muted)}
.pcd-card-value{font-size:1.6rem;line-height:1.1;font-weight:700;letter-spacing:-.02em;font-variant-numeric:tabular-nums;
  overflow-wrap:anywhere}
@media (min-width:1024px){.pcd-card-value{font-size:1.4rem}}
.pcd-card-value[data-tone="good"]{color:var(--pcd-good)}
.pcd-card-value[data-tone="bad"]{color:var(--pcd-bad)}
.pcd-card-hint{font-size:.78rem;color:var(--pcd-muted);line-height:1.4;font-variant-numeric:tabular-nums}

.pcd-section-head{display:flex;flex-wrap:wrap;align-items:flex-end;justify-content:space-between;gap:12px;margin-bottom:14px}
.pcd-section-head h2{margin:0;font-size:1.25rem;font-weight:700;letter-spacing:-.01em}
.pcd-section-head p{margin:4px 0 0;font-size:.85rem;color:var(--pcd-muted);max-width:70ch;line-height:1.45}

.pcd-quads{display:grid;gap:14px;grid-template-columns:minmax(0,1fr)}
@media (min-width:768px){.pcd-quads{grid-template-columns:repeat(2,minmax(0,1fr))}}
.pcd-quad{background:var(--pcd-surface);border:1px solid var(--pcd-border);border-radius:16px;padding:16px;display:flex;
  flex-direction:column;gap:10px;min-width:0;border-top:3px solid var(--pcd-q)}
.pcd-quad[data-cat="ESTRELLA"]{--pcd-q:var(--pcd-star);--pcd-qs:var(--pcd-star-soft)}
.pcd-quad[data-cat="CABALLO_DE_BATALLA"]{--pcd-q:var(--pcd-horse);--pcd-qs:var(--pcd-horse-soft)}
.pcd-quad[data-cat="ROMPECABEZAS"]{--pcd-q:var(--pcd-puzzle);--pcd-qs:var(--pcd-puzzle-soft)}
.pcd-quad[data-cat="PESO_MUERTO"]{--pcd-q:var(--pcd-dog);--pcd-qs:var(--pcd-dog-soft)}
.pcd-quad-head{display:flex;align-items:center;gap:10px}
.pcd-quad-icon{width:34px;height:34px;border-radius:10px;display:grid;place-items:center;background:var(--pcd-qs);color:var(--pcd-q);flex:none}
.pcd-quad-title{font-weight:700;font-size:1rem;line-height:1.2}
.pcd-quad-rule{font-size:.74rem;color:var(--pcd-muted)}
.pcd-quad-count{margin-left:auto;font-size:.8rem;font-weight:700;padding:3px 10px;border-radius:999px;background:var(--pcd-qs);
  color:var(--pcd-q);font-variant-numeric:tabular-nums}
.pcd-quad-advice{margin:0;font-size:.82rem;color:var(--pcd-muted);line-height:1.45}
.pcd-chips{list-style:none;margin:0;padding:0;display:flex;flex-wrap:wrap;gap:6px}
.pcd-chip{font-size:.78rem;padding:4px 10px;border-radius:999px;background:var(--pcd-surface-2);border:1px solid var(--pcd-border-soft);
  max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pcd-quad-empty{font-size:.8rem;color:var(--pcd-faint);margin:0}

.pcd-panel{background:var(--pcd-surface);border:1px solid var(--pcd-border);border-radius:16px;overflow:hidden}
.pcd-filters{display:flex;flex-wrap:wrap;gap:8px;padding:14px 16px;border-bottom:1px solid var(--pcd-border)}
.pcd-filter{font:inherit;font-size:.8rem;font-weight:600;padding:6px 12px;border-radius:999px;cursor:pointer;
  border:1px solid var(--pcd-border);background:transparent;color:var(--pcd-muted);min-height:34px}
.pcd-filter:hover{color:var(--pcd-text);background:var(--pcd-surface-2)}
.pcd-filter[aria-pressed="true"]{background:var(--pcd-accent);border-color:var(--pcd-accent);color:var(--pcd-accent-ink)}
.pcd-filter:focus-visible,.pcd-cta:focus-visible{outline:2px solid var(--pcd-accent);outline-offset:2px}
.pcd-scroll{overflow-x:auto}
.pcd-table{color:var(--pcd-text);width:100%;border-collapse:collapse;font-size:.875rem;font-variant-numeric:tabular-nums;min-width:640px}
.pcd-table th{text-align:right;font-size:.7rem;font-weight:600;letter-spacing:.06em;text-transform:uppercase;color:var(--pcd-faint);
  padding:12px 16px;white-space:nowrap}
.pcd-table td{text-align:right;padding:12px 16px;border-top:1px solid var(--pcd-border-soft);white-space:nowrap}
.pcd-table th:first-child,.pcd-table td:first-child{text-align:left;white-space:normal}
.pcd-table td:first-child{font-weight:600;min-width:160px}
.pcd-table tbody tr:hover{background:var(--pcd-surface-2)}
.pcd-badge{display:inline-flex;align-items:center;gap:5px;font-size:.74rem;font-weight:700;padding:3px 10px;border-radius:999px;
  background:var(--pcd-qs);color:var(--pcd-q);border:1px solid color-mix(in srgb,var(--pcd-q) 35%,transparent)}
.pcd-badge[data-cat="ESTRELLA"]{--pcd-q:var(--pcd-star);--pcd-qs:var(--pcd-star-soft)}
.pcd-badge[data-cat="CABALLO_DE_BATALLA"]{--pcd-q:var(--pcd-horse);--pcd-qs:var(--pcd-horse-soft)}
.pcd-badge[data-cat="ROMPECABEZAS"]{--pcd-q:var(--pcd-puzzle);--pcd-qs:var(--pcd-puzzle-soft)}
.pcd-badge[data-cat="PESO_MUERTO"]{--pcd-q:var(--pcd-dog);--pcd-qs:var(--pcd-dog-soft)}
.pcd-table-empty{padding:28px 16px;text-align:center;color:var(--pcd-faint);font-size:.85rem}
.pcd-foot{padding:12px 16px;border-top:1px solid var(--pcd-border);font-size:.78rem;color:var(--pcd-muted);line-height:1.5}
.pcd-foot strong{color:var(--pcd-text);font-weight:600}
.pcd-uncl{margin:0;padding:12px 16px;border-top:1px solid var(--pcd-border);font-size:.78rem;color:var(--pcd-muted);line-height:1.5}

.pcd-empty{border:1px dashed var(--pcd-border);background:var(--pcd-surface);border-radius:20px;padding:64px 24px;
  display:flex;flex-direction:column;align-items:center;text-align:center}
.pcd-empty-icon{width:64px;height:64px;border-radius:18px;display:grid;place-items:center;margin-bottom:16px;
  background:var(--pcd-accent-soft);color:var(--pcd-accent);border:1px solid color-mix(in srgb,var(--pcd-accent) 35%,transparent)}
.pcd-empty h2{margin:0 0 6px;font-size:1.125rem;font-weight:700}
.pcd-empty p{margin:0 0 22px;max-width:44ch;font-size:.875rem;line-height:1.55;color:var(--pcd-muted)}
.pcd-cta{font:inherit;font-weight:700;height:44px;padding:0 24px;border-radius:12px;border:0;cursor:pointer;
  background:var(--pcd-accent);color:var(--pcd-accent-ink);display:inline-flex;align-items:center;gap:8px}
.pcd-cta:hover{filter:brightness(1.1)}

.pcd-skel{border-radius:10px;background:linear-gradient(90deg,var(--pcd-surface-2),var(--pcd-border),var(--pcd-surface-2));
  background-size:200% 100%;animation:pcd-shimmer 1.4s linear infinite}
@keyframes pcd-shimmer{to{background-position:-200% 0}}
@media (prefers-reduced-motion:reduce){.pcd-skel{animation:none}}
.pcd-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
`;

/* ========================================================================== */
/* Formato                                                                    */
/* ========================================================================== */

function makeMoneyFormatter(currency: string, locale: string): (value: number) => string {
  try {
    const formatter = new Intl.NumberFormat(locale, {
      style: "currency",
      currency,
      currencyDisplay: "narrowSymbol",
      maximumFractionDigits: currency === "COP" || currency === "CLP" || currency === "JPY" ? 0 : 2
    });
    return (value) => formatter.format(Number.isFinite(value) ? value : 0);
  } catch {
    const fallback = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
    return (value) => `$${fallback.format(Number.isFinite(value) ? value : 0)}`;
  }
}

function makeNumberFormatter(locale: string, digits: number): (value: number) => string {
  const formatter = new Intl.NumberFormat(locale, { maximumFractionDigits: digits, minimumFractionDigits: 0 });
  return (value) => formatter.format(Number.isFinite(value) ? value : 0);
}

/* ========================================================================== */
/* Catálogo visual de la Matriz                                               */
/* ========================================================================== */

const CATEGORY_ORDER: readonly MenuMatrixCategory[] = [
  "ESTRELLA",
  "CABALLO_DE_BATALLA",
  "ROMPECABEZAS",
  "PESO_MUERTO"
];

const CATEGORY_RULE: Readonly<Record<MenuMatrixCategory, string>> = {
  ESTRELLA: "Muy vendido · margen alto",
  CABALLO_DE_BATALLA: "Muy vendido · margen bajo",
  ROMPECABEZAS: "Poco vendido · margen alto",
  PESO_MUERTO: "Poco vendido · margen bajo"
};

const CATEGORY_ICON: Readonly<Record<MenuMatrixCategory, ReactNode>> = {
  ESTRELLA: <Star size={18} aria-hidden="true" />,
  CABALLO_DE_BATALLA: <Zap size={18} aria-hidden="true" />,
  ROMPECABEZAS: <Puzzle size={18} aria-hidden="true" />,
  PESO_MUERTO: <Anchor size={18} aria-hidden="true" />
};

type CategoryFilter = MenuMatrixCategory | "TODOS";

/* ========================================================================== */
/* Subcomponentes                                                             */
/* ========================================================================== */

interface SummaryCardProps {
  readonly label: string;
  readonly value: string;
  readonly hint: string;
  readonly icon: ReactNode;
  readonly tone?: "good" | "bad" | undefined;
  readonly hero?: boolean | undefined;
}

function SummaryCard({ label, value, hint, icon, tone, hero = false }: SummaryCardProps) {
  return (
    <div className="pcd-card" data-hero={hero}>
      <div className="pcd-card-top">
        <span className="pcd-card-label">{label}</span>
        <span className="pcd-card-icon" aria-hidden="true">
          {icon}
        </span>
      </div>
      <div className="pcd-card-value" data-tone={tone}>
        {value}
      </div>
      <div className="pcd-card-hint">{hint}</div>
    </div>
  );
}

function LoadingState() {
  return (
    <div aria-busy="true" aria-live="polite">
      <span className="pcd-sr">Calculando ganancias…</span>
      <div className="pcd-cards">
        {[0, 1, 2, 3, 4].map((n) => (
          <div key={n} className="pcd-card">
            <div className="pcd-skel" style={{ height: 14, width: "55%" }} />
            <div className="pcd-skel" style={{ height: 30, width: "80%" }} />
            <div className="pcd-skel" style={{ height: 12, width: "65%" }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function EmptyProfitState({ onRegisterSale }: { readonly onRegisterSale?: (() => void) | undefined }) {
  return (
    <div className="pcd-empty" role="status">
      <div className="pcd-empty-icon" aria-hidden="true">
        <DollarSign size={30} />
      </div>
      <h2>Aún no hay ventas para calcular tus ganancias.</h2>
      <p>
        Registra tu primera venta y VIMDY calculará al instante cuánto ganas, cuánto te cuesta cada plato y cuáles
        productos son tus estrellas.
      </p>
      {onRegisterSale && (
        <button type="button" className="pcd-cta" onClick={onRegisterSale}>
          <Receipt size={18} aria-hidden="true" />
          Registrar primera venta
        </button>
      )}
    </div>
  );
}

/* ========================================================================== */
/* Componente principal                                                       */
/* ========================================================================== */

/**
 * ProfitCenterDashboard — Centro de Ganancias.
 * ---------------------------------------------------------------------------
 * Presenta lo que calcula `profitEngine` (dominio puro): resumen ejecutivo
 * (ingresos, COGS, ganancia bruta, margen bruto %, ganancia neta) y la Matriz
 * de Menú (Estrellas, Caballos de batalla, Rompecabezas y Pesos muertos). No
 * calcula nada por su cuenta ni accede a stores: recibe los datos por props.
 */
export function ProfitCenterView({
  input,
  loading = false,
  error = null,
  periodControl,
  currency = "COP",
  locale = "es-CO",
  marginBasis = "UNIT_PROFIT",
  periodLabel,
  theme = "dark",
  onRegisterSale
}: ProfitCenterViewProps) {
  const [filter, setFilter] = useState<CategoryFilter>("TODOS");

  const summary: ProfitSummary = useMemo(() => computeProfitSummary(input), [input]);
  const matrix = useMemo(() => buildMenuMatrix(input, { marginBasis }), [input, marginBasis]);

  const money = useMemo(() => makeMoneyFormatter(currency, locale), [currency, locale]);
  const integer = useMemo(() => makeNumberFormatter(locale, 0), [locale]);
  const decimal = useMemo(() => makeNumberFormatter(locale, 1), [locale]);

  const visibleItems: readonly MenuMatrixItem[] = useMemo(() => {
    const list = filter === "TODOS" ? matrix.items : matrix.byCategory[filter];
    return [...list].sort((a, b) => b.grossProfit - a.grossProfit);
  }, [matrix, filter]);

  const hasSales = summary.unitsSold > 0;
  const netIsLoss = summary.netProfit < 0;
  const cogsShare = summary.revenue > 0 ? (summary.cogs / summary.revenue) * 100 : 0;
  const basisIsUnit = matrix.thresholds.marginBasis === "UNIT_PROFIT";

  return (
    <section className="pcd" data-theme={theme} aria-label="Centro de Ganancias">
      <style>{STYLES}</style>

      <header className="pcd-head">
        <h1>
          <DollarSign size={26} aria-hidden="true" />
          Centro de Ganancias
        </h1>
        <p>
          Cuánto vendes, cuánto te cuesta y cuánto te queda, calculado con las recetas y el costo actual de tus
          insumos.
        </p>
        {periodLabel && <span className="pcd-period">{periodLabel}</span>}
        {periodControl}
      </header>

      {error && (
        <div className="pcd-banner" role="alert" style={{ color: "var(--pcd-bad)", background: "var(--pcd-bad-soft)" }}>
          <TriangleAlert size={18} aria-hidden="true" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <LoadingState />
      ) : !hasSales ? (
        <EmptyProfitState onRegisterSale={onRegisterSale} />
      ) : (
        <>
          {(summary.productsWithIncompleteCost.length > 0 || summary.unknownProductIds.length > 0) && (
            <div className="pcd-banner" role="status">
              <TriangleAlert size={18} aria-hidden="true" />
              <span>
                {summary.productsWithIncompleteCost.length > 0 &&
                  `${integer(summary.productsWithIncompleteCost.length)} producto(s) vendido(s) tienen insumos sin costo, así que el costo de ventas puede estar subestimado. `}
                {summary.unknownProductIds.length > 0 &&
                  `${integer(summary.unknownProductIds.length)} producto(s) ya no existen en el catálogo y se cuentan sin costo.`}
              </span>
            </div>
          )}

          <div className="pcd-cards">
            <SummaryCard
              label="Ingresos totales"
              value={money(summary.revenue)}
              hint={`${integer(summary.unitsSold)} unidades vendidas`}
              icon={<Wallet size={16} />}
            />
            <SummaryCard
              label="Costo de ventas"
              value={money(summary.cogs)}
              hint={`${decimal(cogsShare)} % de los ingresos`}
              icon={<Receipt size={16} />}
            />
            <SummaryCard
              label="Ganancia bruta"
              value={money(summary.grossProfit)}
              hint="Ingresos menos costo de ventas"
              icon={<TrendingUp size={16} />}
              tone={summary.grossProfit < 0 ? "bad" : "good"}
            />
            <SummaryCard
              label="Margen bruto"
              value={`${decimal(summary.grossMarginPercent)} %`}
              hint="De cada $100 vendidos, esto te queda antes de gastos"
              icon={<Percent size={16} />}
              tone={summary.grossMarginPercent < 0 ? "bad" : undefined}
            />
            <SummaryCard
              hero
              label="Ganancia neta"
              value={money(summary.netProfit)}
              hint={`Después de ${money(summary.operatingExpenses)} en gastos · ${decimal(summary.netMarginPercent)} %`}
              icon={netIsLoss ? <TrendingDown size={16} /> : <PiggyBank size={16} />}
              tone={netIsLoss ? "bad" : "good"}
            />
          </div>

          <div>
            <div className="pcd-section-head">
              <div>
                <h2>Matriz de Menú</h2>
                <p>
                  Cruza cuánto se vende cada producto con cuánto deja. Te dice a cuáles empujar, cuáles ajustar de
                  precio y cuáles replantear.
                </p>
              </div>
            </div>

            <div className="pcd-quads">
              {CATEGORY_ORDER.map((category) => {
                const items = matrix.byCategory[category];
                return (
                  <article key={category} className="pcd-quad" data-cat={category}>
                    <div className="pcd-quad-head">
                      <span className="pcd-quad-icon">{CATEGORY_ICON[category]}</span>
                      <div>
                        <div className="pcd-quad-title">{MENU_MATRIX_LABELS[category]}</div>
                        <div className="pcd-quad-rule">{CATEGORY_RULE[category]}</div>
                      </div>
                      <span className="pcd-quad-count" aria-label={`${items.length} productos`}>
                        {integer(items.length)}
                      </span>
                    </div>
                    <p className="pcd-quad-advice">{MENU_MATRIX_ADVICE[category]}</p>
                    {items.length === 0 ? (
                      <p className="pcd-quad-empty">Ningún producto en esta categoría.</p>
                    ) : (
                      <ul className="pcd-chips">
                        {items.map((item) => (
                          <li key={item.productId} className="pcd-chip" title={item.productName}>
                            {item.productName}
                          </li>
                        ))}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
          </div>

          <div className="pcd-panel">
            <div className="pcd-filters" role="group" aria-label="Filtrar por categoría">
              <button
                type="button"
                className="pcd-filter"
                aria-pressed={filter === "TODOS"}
                onClick={() => setFilter("TODOS")}
              >
                Todos ({integer(matrix.items.length)})
              </button>
              {CATEGORY_ORDER.map((category) => (
                <button
                  key={category}
                  type="button"
                  className="pcd-filter"
                  aria-pressed={filter === category}
                  onClick={() => setFilter(category)}
                >
                  {MENU_MATRIX_LABELS[category]} ({integer(matrix.byCategory[category].length)})
                </button>
              ))}
            </div>

            {visibleItems.length === 0 ? (
              <div className="pcd-table-empty">No hay productos para mostrar en esta categoría.</div>
            ) : (
              <div className="pcd-scroll">
                <table className="pcd-table">
                  <caption className="pcd-sr">Productos clasificados en la Matriz de Menú</caption>
                  <thead>
                    <tr>
                      <th scope="col">Producto</th>
                      <th scope="col">Categoría</th>
                      <th scope="col">Unidades</th>
                      <th scope="col">% del volumen</th>
                      <th scope="col">Ganancia / unidad</th>
                      <th scope="col">Margen</th>
                      <th scope="col">Ganancia bruta</th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleItems.map((item) => (
                      <tr key={item.productId}>
                        <td>{item.productName}</td>
                        <td>
                          <span className="pcd-badge" data-cat={item.category}>
                            {CATEGORY_ICON[item.category]}
                            {MENU_MATRIX_LABELS[item.category]}
                          </span>
                        </td>
                        <td>{integer(item.unitsSold)}</td>
                        <td>{decimal(item.popularityShare * 100)} %</td>
                        <td>{money(item.unitProfit)}</td>
                        <td>{decimal(item.grossMarginPercent)} %</td>
                        <td>{money(item.grossProfit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div className="pcd-foot">
              Umbrales: <strong>popular</strong> desde {decimal(matrix.thresholds.popularity * 100)} % del volumen ·{" "}
              <strong>margen alto</strong> desde{" "}
              {basisIsUnit ? money(matrix.thresholds.margin) + " por unidad" : decimal(matrix.thresholds.margin) + " %"}{" "}
              (promedio ponderado del menú).
            </div>

            {matrix.unclassified.length > 0 && (
              <p className="pcd-uncl">
                Sin clasificar ({integer(matrix.unclassified.length)}):{" "}
                {matrix.unclassified
                  .map(
                    (u) =>
                      `${u.productName} (${u.reason === "COSTO_INCOMPLETO" ? "costo incompleto" : "pocas ventas"})`
                  )
                  .join(", ")}
                .
              </p>
            )}
          </div>
        </>
      )}
    </section>
  );
}

/* ========================================================================== */
/* Conexión a datos reales (cuando no se pasa `input`)                        */
/* ========================================================================== */

type ProfitRange = "hoy" | "semana" | "mes" | "año" | "todo";

const RANGE_ORDER: readonly ProfitRange[] = ["hoy", "semana", "mes", "año", "todo"];

const RANGE_LABEL: Readonly<Record<ProfitRange, string>> = {
  hoy: "Hoy",
  semana: "Esta semana",
  mes: "Este mes",
  año: "Este año",
  todo: "Todo"
};

function rangeStart(range: ProfitRange, tz: string): Date | null {
  const now = new Date();
  if (range === "hoy") return startOfBusinessDay(now, tz);
  if (range === "semana") return startOfBusinessWeek(now, tz);
  if (range === "mes") return startOfBusinessMonth(now, tz);
  if (range === "año") return startOfBusinessYear(now, tz);
  return null;
}

interface RawProfitData {
  readonly catalog: readonly ProfitCatalogItem[];
  readonly sales: readonly { readonly createdAt: Date; readonly lines: readonly ProfitSaleLine[] }[];
}

/**
 * Convierte Product/Sale del POS en los datos planos del motor. Costo de un
 * insumo = costo promedio ponderado si existe, si no el último precio de
 * compra. Las líneas salen netas de reembolsos y el descuento de la venta se
 * reparte entre sus líneas en proporción a lo que pagó cada una.
 */
async function loadRawProfitData(): Promise<RawProfitData> {
  await productsReady;
  const [allSales, allProducts] = await Promise.all([
    container.salesEngine.get().getAllSales(),
    container.inventoryEngine.get().listAll()
  ]);

  const catalog: ProfitCatalogItem[] = allProducts.map((product) => {
    const average = product.averageCost;
    const cost = typeof average === "number" && average > 0 ? average : product.purchasePrice;
    return {
      id: product.id,
      name: product.name,
      unitCost: typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null,
      recipe: (product.recipe ?? []).map((line) => ({ ingredientId: line.productId, quantity: line.quantity }))
    };
  });

  const sales = allSales
    .filter((sale) => isRevenueSaleStatus(sale.status))
    .map((sale) => {
      const netItems = getSaleNetItems(sale);
      const gross = netItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
      const saleDiscount = Number.isFinite(sale.discount) && (sale.discount ?? 0) > 0 ? Math.min(sale.discount ?? 0, gross) : 0;
      const lines: ProfitSaleLine[] = netItems.map((item) => {
        const lineGross = item.price * item.quantity;
        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,
          discount: gross > 0 ? (saleDiscount * lineGross) / gross : 0
        };
      });
      return { createdAt: new Date(sale.createdAt), lines };
    });

  return { catalog, sales };
}

function ConnectedProfitCenter(props: Omit<ProfitCenterDashboardProps, "input">) {
  const { operatingExpenses, periodLabel, ...viewProps } = props;
  const [range, setRange] = useState<ProfitRange>("mes");
  const [raw, setRaw] = useState<RawProfitData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setRaw(await loadRawProfitData());
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "No se pudo cargar el Centro de Ganancias."))
      .finally(() => setLoading(false));
  }, [load]);

  const refresh = useCallback(() => {
    load().catch((e: unknown) =>
      setError(e instanceof Error ? e.message : "No se pudo actualizar el Centro de Ganancias.")
    );
  }, [load]);
  useVimdyEvent("sale", refresh);
  useVimdyEvent("inventory", refresh);

  const input: ProfitInput = useMemo(() => {
    const start = rangeStart(range, companyConfigStore.get().timezone || "America/Bogota");
    const lines = (raw?.sales ?? [])
      .filter((sale) => start === null || sale.createdAt.getTime() >= start.getTime())
      .flatMap((sale) => sale.lines);
    return { catalog: raw?.catalog ?? [], sales: lines, operatingExpenses: operatingExpenses ?? [] };
  }, [raw, range, operatingExpenses]);

  const periodControl = (
    <div className="pcd-range" role="group" aria-label="Periodo">
      {RANGE_ORDER.map((key) => (
        <button
          key={key}
          type="button"
          className="pcd-filter"
          aria-pressed={range === key}
          onClick={() => setRange(key)}
        >
          {RANGE_LABEL[key]}
        </button>
      ))}
    </div>
  );

  return (
    <ProfitCenterView
      {...viewProps}
      input={input}
      loading={loading}
      error={error}
      periodLabel={periodLabel ?? RANGE_LABEL[range]}
      periodControl={periodControl}
      currency={viewProps.currency ?? companyConfigStore.get().currency}
    />
  );
}

/* ========================================================================== */
/* Componente público                                                         */
/* ========================================================================== */

/**
 * ProfitCenterDashboard — Centro de Ganancias.
 *   - Con `input`: vista pura sobre ese dato (útil para pruebas y Storybook).
 *   - Sin `input`: se conecta al POS (ventas + catálogo), con selector de periodo.
 */
export function ProfitCenterDashboard(props: ProfitCenterDashboardProps) {
  const { input, operatingExpenses, ...rest } = props;
  if (input) {
    return <ProfitCenterView {...rest} input={operatingExpenses ? { ...input, operatingExpenses } : input} />;
  }
  return <ConnectedProfitCenter {...rest} operatingExpenses={operatingExpenses} />;
}

export default ProfitCenterDashboard;