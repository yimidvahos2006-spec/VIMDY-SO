import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, PointerEvent } from "react";

import { useTranslation } from "../../../core/i18n/useTranslation";
import type { DashboardExecutiveModel } from "../../../core/dashboard/executive/DashboardExecutiveTypes";

interface Props { data: DashboardExecutiveModel["salesTrend"]; }

/**
 * Gráfico de tendencia de ventas (línea) dibujado con SVG propio.
 *
 * Reemplaza a recharts (~346 kB) por ~3 kB. Mantiene: línea suave, cuadrícula
 * tenue, ejes sin líneas, valores en moneda del negocio y cuadro de detalle al
 * pasar el mouse, tocar o navegar con las flechas del teclado.
 */

const MARGIN = { top: 10, right: 20, bottom: 24 };
const MIN_LABEL_SPACING = 52; // px mínimos entre etiquetas del eje X

/** Marcas "bonitas" para el eje Y (1, 2, 5 × 10^n). */
function niceTicks(min: number, max: number, target = 4): number[] {
  if (!(max > min)) return [min, min + 1];
  const rough = (max - min) / target;
  const pow = Math.pow(10, Math.floor(Math.log10(rough)));
  const frac = rough / pow;
  const step = (frac <= 1 ? 1 : frac <= 2 ? 2 : frac <= 5 ? 5 : 10) * pow;
  const start = Math.floor(min / step) * step;
  const end = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = start; v <= end + step / 2; v += step) ticks.push(Math.round(v / step) * step);
  return ticks;
}

/** Curva suave que nunca se pasa de los datos (interpolación monótona). */
function monotonePath(pts: ReadonlyArray<readonly [number, number]>): string {
  const n = pts.length;
  if (n === 0) return "";
  if (n === 1) return `M${pts[0][0]},${pts[0][1]}`;
  const slope: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const dx = pts[i + 1][0] - pts[i][0];
    slope.push(dx === 0 ? 0 : (pts[i + 1][1] - pts[i][1]) / dx);
  }
  const t: number[] = new Array(n).fill(0);
  t[0] = slope[0];
  t[n - 1] = slope[n - 2];
  for (let i = 1; i < n - 1; i++) {
    t[i] = slope[i - 1] * slope[i] <= 0 ? 0 : (slope[i - 1] + slope[i]) / 2;
  }
  for (let i = 0; i < n - 1; i++) {
    if (slope[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / slope[i];
    const b = t[i + 1] / slope[i];
    const h = a * a + b * b;
    if (h > 9) {
      const tau = 3 / Math.sqrt(h);
      t[i] = tau * a * slope[i];
      t[i + 1] = tau * b * slope[i];
    }
  }
  let d = `M${pts[0][0]},${pts[0][1]}`;
  for (let i = 0; i < n - 1; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[i + 1];
    const dx = (x1 - x0) / 3;
    d += `C${x0 + dx},${y0 + t[i] * dx},${x1 - dx},${y1 - t[i + 1] * dx},${x1},${y1}`;
  }
  return d;
}

export default function DashboardSalesTrendChart({ data }: Props) {
  const { language, money } = useTranslation();
  const netSalesLabel = language === "en" ? "Net sales" : language === "pt" ? "Vendas líquidas" : "Ventas netas";
  const chartLabel = language === "en" ? "Sales trend chart" : language === "pt" ? "Gráfico de tendência de vendas" : "Gráfico de tendencia de ventas";

  const boxRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [active, setActive] = useState<number | null>(null);

  // Mide el contenedor (se adapta al ancho de la pantalla).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const measure = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    measure();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", measure);
      return () => window.removeEventListener("resize", measure);
    }
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const { width, height } = size;
  const count = data.length;

  // Marcas del eje Y y margen izquierdo: se adapta al monto más largo para no cortarlo.
  const ticks = useMemo(() => {
    const values = data.map((p) => p.value);
    return niceTicks(Math.min(0, ...values), Math.max(0, ...values));
  }, [data]);
  const left = Math.max(56, Math.ceil(Math.max(...ticks.map((t) => money(t).length)) * 7 + 14));
  const margin = { ...MARGIN, left };
  const plotW = Math.max(0, width - margin.left - margin.right);
  const plotH = Math.max(0, height - margin.top - margin.bottom);

  const geometry = useMemo(() => {
    const yMin = ticks[0];
    const yMax = ticks[ticks.length - 1];
    const x = (i: number) => margin.left + (count > 1 ? (i * plotW) / (count - 1) : plotW / 2);
    const y = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;
    const points = data.map((p, i) => [x(i), y(p.value)] as const);
    const every = Math.max(1, Math.ceil(MIN_LABEL_SPACING / Math.max(1, plotW / Math.max(1, count - 1))));
    return { ticks, x, y, points, path: monotonePath(points), every };
  }, [data, ticks, count, plotW, plotH, left]);

  const pickIndex = useCallback(
    (clientX: number) => {
      const rect = boxRef.current?.getBoundingClientRect();
      if (!rect || count < 2 || plotW <= 0) return null;
      const ratio = (clientX - rect.left - margin.left) / plotW;
      return Math.min(count - 1, Math.max(0, Math.round(ratio * (count - 1))));
    },
    [count, plotW, left],
  );

  const onPointer = (event: PointerEvent<HTMLDivElement>) => setActive(pickIndex(event.clientX));

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "ArrowRight") {
      event.preventDefault();
      setActive((prev) => Math.min(count - 1, (prev ?? -1) + 1));
    } else if (event.key === "ArrowLeft") {
      event.preventDefault();
      setActive((prev) => Math.max(0, (prev ?? count) - 1));
    } else if (event.key === "Escape") {
      setActive(null);
    }
  };

  const point = active !== null ? data[active] : null;
  const activeX = active !== null ? geometry.x(active) : 0;
  const activeY = active !== null && point ? geometry.y(point.value) : 0;
  const flip = width > 0 && activeX > width * 0.6;

  return (
    <div
      ref={boxRef}
      className="relative h-full w-full select-none text-vimdy-text outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent rounded-vimdy-xl"
      style={{ touchAction: "pan-y" }}
      tabIndex={0}
      role="group"
      aria-label={`${chartLabel}. ${netSalesLabel}.`}
      onPointerMove={onPointer}
      onPointerDown={onPointer}
      onPointerLeave={() => setActive(null)}
      onBlur={() => setActive(null)}
      onKeyDown={onKeyDown}
    >
      {width > 0 && height > 0 && (
        <svg width={width} height={height} aria-hidden="true" className="block">
          {/* Cuadrícula horizontal + valores del eje Y */}
          {geometry.ticks.map((tick) => {
            const ty = geometry.y(tick);
            return (
              <g key={tick}>
                <line x1={margin.left} x2={width - margin.right} y1={ty} y2={ty} stroke="currentColor" strokeOpacity={0.08} strokeDasharray="3 3" />
                <text x={margin.left - 8} y={ty} textAnchor="end" dominantBaseline="middle" fontSize={12} style={{ fill: "var(--vimdy-text-secondary, #A1A1AA)" }}>
                  {money(tick)}
                </text>
              </g>
            );
          })}

          {/* Etiquetas del eje X (espaciadas para que no se pisen) */}
          {data.map((p, i) =>
            i % geometry.every === 0 ? (
              <text key={p.dateKey} x={geometry.x(i)} y={height - 6} textAnchor="middle" fontSize={12} style={{ fill: "var(--vimdy-text-secondary, #A1A1AA)" }}>
                {p.label}
              </text>
            ) : null,
          )}

          {/* Línea de ventas */}
          <path d={geometry.path} fill="none" stroke="currentColor" className="text-vimdy-accent" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />

          {/* Marcador al pasar el mouse */}
          {point && (
            <g>
              <line x1={activeX} x2={activeX} y1={margin.top} y2={margin.top + plotH} stroke="currentColor" strokeOpacity={0.25} />
              <circle cx={activeX} cy={activeY} r={4} fill="currentColor" className="text-vimdy-accent" stroke="var(--vimdy-surface, #101012)" strokeWidth={2} />
            </g>
          )}
        </svg>
      )}

      {point && (
        <div
          role="status"
          className="pointer-events-none absolute z-10 whitespace-nowrap px-3 py-2 text-sm text-vimdy-text"
          style={{
            top: Math.max(0, activeY - 52),
            left: activeX,
            transform: `translateX(${flip ? "calc(-100% - 12px)" : "12px"})`,
            borderRadius: 12,
            border: "1px solid rgba(255,255,255,0.10)",
            background: "var(--vimdy-surface, #101012)",
          }}
        >
          <div className="text-xs text-vimdy-text-secondary">{point.label}</div>
          <div className="font-semibold">
            {netSalesLabel}: {money(point.value)}
          </div>
        </div>
      )}

      {/* Versión en tabla para lectores de pantalla */}
      <table className="sr-only">
        <caption>{chartLabel}</caption>
        <tbody>
          {data.map((p) => (
            <tr key={p.dateKey}>
              <th scope="row">{p.label}</th>
              <td>{money(p.value)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}