// src/core/services/monthlyReports.ts
/* ===========================================================================
   Reportes por mes y por semana
   ---------------------------------------------------------------------------
   Funciones PURAS (sin pantalla, sin base de datos): reciben las ventas y
   devuelven el reporte de un mes, con sus semanas. Así los números se pueden
   probar y siempre salen de la misma regla que el resto de Reportes:
     - Solo cuentan ventas pagadas (PAID / CLOSED / sin estado).
     - Cada venta cuenta por su total NETO (se resta lo reembolsado).
     - Los días y meses se miden en la zona horaria del NEGOCIO, no la del equipo.
   Semana = lunes a domingo, recortada al mes (la primera y la última pueden
   ser más cortas). Así la suma de las semanas es EXACTAMENTE el total del mes.
=========================================================================== */

import type { Product, Sale } from "../entities/Entities";
import { getSaleNetItems, getSaleNetTotal, getSaleRefundedTotal, isRevenueSaleStatus } from "../utils/saleRefunds";
import { getBusinessDateKey, getBusinessMonthKey } from "../utils/businessTime";
import {
  buildCsv,
  csvMoney,
  downloadCsvFile,
  formatCsvNumber,
  type CsvRow
} from "../utils/csv";

export interface MethodRow {
  method: string;
  label: string;
  total: number;
  tickets: number;
}

export interface ProductRow {
  productId: string;
  name: string;
  units: number;
  revenue: number;
}

export interface DayRow {
  dateKey: string;
  /** "lun", "mar"... */
  weekdayLabel: string;
  sales: number;
  tickets: number;
}

export interface PeriodSummary {
  sales: number;
  tickets: number;
  averageTicket: number;
  refunds: number;
  tips: number;
  byMethod: MethodRow[];
  topProducts: ProductRow[];
  bestDay: { dateKey: string; sales: number } | null;
}

export interface WeekReport {
  index: number;
  label: string;
  startKey: string;
  endKey: string;
  summary: PeriodSummary;
  days: DayRow[];
}

export interface MonthReport {
  monthKey: string;
  year: number;
  month: number;
  label: string;
  summary: PeriodSummary;
  previousMonthSales: number | null;
  changePct: number | null;
  weeks: WeekReport[];
  days: DayRow[];
}

export interface MonthListItem {
  monthKey: string;
  year: number;
  month: number;
  label: string;
  sales: number;
  tickets: number;
  changePct: number | null;
  isCurrent: boolean;
}

const MONTHS_ES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];
const MONTHS_SHORT = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const WEEKDAYS_SHORT = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];

export const METHOD_LABEL: Record<string, string> = {
  CASH: "Efectivo",
  CARD: "Tarjeta",
  TRANSFER: "Transferencia",
  QR: "QR",
  MIXED: "Mixto"
};

export function monthLabel(monthKey: string): string {
  const [y, m] = monthKey.split("-").map(Number);
  return `${MONTHS_ES[m - 1]} ${y}`;
}

function parseMonthKey(monthKey: string): { year: number; month: number } {
  const [year, month] = monthKey.split("-").map(Number);
  return { year, month };
}

export function previousMonthKey(monthKey: string): string {
  const { year, month } = parseMonthKey(monthKey);
  const d = new Date(Date.UTC(year, month - 2, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function weekdayOf(dateKey: string): number {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

function shortDate(dateKey: string): string {
  const [, m, d] = dateKey.split("-").map(Number);
  return `${d} ${MONTHS_SHORT[m - 1]}`;
}

/** Ventas que cuentan como ingreso real (misma regla que Reportes). */
export function paidSalesOnly(sales: readonly Sale[]): Sale[] {
  return sales.filter((sale) => isRevenueSaleStatus(sale.status));
}

/**
 * Fecha contable para agrupar ingresos por mes: al existir, se usa la fecha
 * real del cobro confirmado; las ventas históricas sin paidAt conservan
 * createdAt como compatibilidad con los registros antiguos.
 */
function saleRevenueDate(sale: Sale): Date {
  const paymentDate = sale.paidAt;
  if (paymentDate instanceof Date && Number.isFinite(paymentDate.getTime())) {
    return paymentDate;
  }

  const createdDate = sale.createdAt;
  if (createdDate instanceof Date && Number.isFinite(createdDate.getTime())) {
    return createdDate;
  }

  const parsed = new Date(createdDate as unknown as string);
  return Number.isFinite(parsed.getTime()) ? parsed : new Date(0);
}

function summarize(sales: readonly Sale[], dayKeys: readonly string[], tz: string, productName: (id: string) => string): PeriodSummary {
  let total = 0;
  let refunds = 0;
  let tips = 0;
  const methods = new Map<string, { total: number; tickets: number }>();
  const products = new Map<string, { units: number; revenue: number }>();
  const byDay = new Map<string, number>();

  for (const sale of sales) {
    const net = getSaleNetTotal(sale);
    total += net;
    refunds += getSaleRefundedTotal(sale);
    tips += sale.tip ?? 0;

    const method = sale.paymentMethod || "SIN_METODO";
    const m = methods.get(method) ?? { total: 0, tickets: 0 };
    m.total += net;
    m.tickets += 1;
    methods.set(method, m);

    for (const item of getSaleNetItems(sale)) {
      const p = products.get(item.productId) ?? { units: 0, revenue: 0 };
      p.units += item.quantity;
      p.revenue += item.price * item.quantity;
      products.set(item.productId, p);
    }

    const dayKey = getBusinessDateKey(saleRevenueDate(sale), tz);
    byDay.set(dayKey, (byDay.get(dayKey) ?? 0) + net);
  }

  let bestDay: PeriodSummary["bestDay"] = null;
  for (const key of dayKeys) {
    const value = byDay.get(key) ?? 0;
    if (value > 0 && (!bestDay || value > bestDay.sales)) bestDay = { dateKey: key, sales: value };
  }

  const tickets = sales.length;
  return {
    sales: total,
    tickets,
    averageTicket: tickets > 0 ? total / tickets : 0,
    refunds,
    tips,
    byMethod: [...methods.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .map(([method, v]) => ({
        method,
        label: METHOD_LABEL[method] ?? (method === "SIN_METODO" ? "Sin especificar" : method),
        total: v.total,
        tickets: v.tickets
      })),
    topProducts: [...products.entries()]
      .sort((a, b) => b[1].units - a[1].units || b[1].revenue - a[1].revenue)
      .slice(0, 10)
      .map(([productId, v]) => ({ productId, name: productName(productId), units: v.units, revenue: v.revenue })),
    bestDay
  };
}

function salesOfMonth(sales: readonly Sale[], monthKey: string, tz: string): Sale[] {
  return paidSalesOnly(sales).filter((s) => getBusinessMonthKey(saleRevenueDate(s), tz) === monthKey);
}

function monthSales(sales: readonly Sale[], monthKey: string, tz: string): number {
  return salesOfMonth(sales, monthKey, tz).reduce((sum, s) => sum + getSaleNetTotal(s), 0);
}

function pctChange(current: number, previous: number | null): number | null {
  if (previous === null || previous <= 0) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

/** Meses que tienen ventas, más el mes actual, del más reciente al más antiguo. */
export function listReportMonths(sales: readonly Sale[], tz: string, now: Date = new Date()): MonthListItem[] {
  const currentKey = getBusinessMonthKey(now, tz);
  const keys = new Set<string>([currentKey]);
  const paid = paidSalesOnly(sales);
  for (const sale of paid) keys.add(getBusinessMonthKey(saleRevenueDate(sale), tz));

  const totals = new Map<string, { sales: number; tickets: number }>();
  for (const sale of paid) {
    const key = getBusinessMonthKey(saleRevenueDate(sale), tz);
    const t = totals.get(key) ?? { sales: 0, tickets: 0 };
    t.sales += getSaleNetTotal(sale);
    t.tickets += 1;
    totals.set(key, t);
  }

  return [...keys]
    .sort((a, b) => (a < b ? 1 : -1))
    .map((monthKey) => {
      const { year, month } = parseMonthKey(monthKey);
      const t = totals.get(monthKey) ?? { sales: 0, tickets: 0 };
      const prev = totals.get(previousMonthKey(monthKey));
      return {
        monthKey,
        year,
        month,
        label: monthLabel(monthKey),
        sales: t.sales,
        tickets: t.tickets,
        changePct: pctChange(t.sales, prev ? prev.sales : null),
        isCurrent: monthKey === currentKey
      };
    });
}

function dayRows(sales: readonly Sale[], dayKeys: readonly string[], tz: string): DayRow[] {
  const byDay = new Map<string, { sales: number; tickets: number }>();
  for (const sale of sales) {
    const key = getBusinessDateKey(saleRevenueDate(sale), tz);
    const d = byDay.get(key) ?? { sales: 0, tickets: 0 };
    d.sales += getSaleNetTotal(sale);
    d.tickets += 1;
    byDay.set(key, d);
  }
  return dayKeys.map((dateKey) => ({
    dateKey,
    weekdayLabel: WEEKDAYS_SHORT[weekdayOf(dateKey)],
    sales: byDay.get(dateKey)?.sales ?? 0,
    tickets: byDay.get(dateKey)?.tickets ?? 0
  }));
}

/** Construye el reporte completo de un mes ("2026-10") con sus semanas. */
export function buildMonthReport(
  sales: readonly Sale[],
  products: readonly Product[],
  tz: string,
  monthKey: string
): MonthReport {
  const { year, month } = parseMonthKey(monthKey);
  const names = new Map(products.map((p) => [p.id, p.name]));
  const productName = (id: string) => names.get(id) ?? "Producto eliminado";

  const inMonth = salesOfMonth(sales, monthKey, tz);
  const totalDays = daysInMonth(year, month);
  const allKeys = Array.from(
    { length: totalDays },
    (_, i) => `${monthKey}-${String(i + 1).padStart(2, "0")}`
  );

  // Semanas lunes–domingo recortadas al mes.
  const weekKeyGroups: string[][] = [];
  let current: string[] = [];
  for (const key of allKeys) {
    current.push(key);
    if (weekdayOf(key) === 0) {
      weekKeyGroups.push(current);
      current = [];
    }
  }
  if (current.length > 0) weekKeyGroups.push(current);

  const weeks: WeekReport[] = weekKeyGroups.map((keys, i) => {
    const keySet = new Set(keys);
    const weekSales = inMonth.filter((s) => keySet.has(getBusinessDateKey(new Date(s.createdAt), tz)));
    const startKey = keys[0];
    const endKey = keys[keys.length - 1];
    return {
      index: i + 1,
      label: `Semana ${i + 1} · ${shortDate(startKey)} al ${shortDate(endKey)}`,
      startKey,
      endKey,
      summary: summarize(weekSales, keys, tz, productName),
      days: dayRows(weekSales, keys, tz)
    };
  });

  const summary = summarize(inMonth, allKeys, tz, productName);
  const prevKey = previousMonthKey(monthKey);
  const prevHasSales = salesOfMonth(sales, prevKey, tz).length > 0;
  const previousMonthSales = prevHasSales ? monthSales(sales, prevKey, tz) : null;

  return {
    monthKey,
    year,
    month,
    label: monthLabel(monthKey),
    summary,
    previousMonthSales,
    changePct: pctChange(summary.sales, previousMonthSales),
    weeks,
    days: dayRows(inMonth, allKeys, tz)
  };
}

/* ───────────────────────── Descarga (CSV para Excel) ───────────────────────── */
/* El formato (BOM, "sep=;", números con coma decimal y anti-inyección de
   fórmulas) vive en ../utils/csv. Aquí solo se arman las filas: los textos
   (nombres de negocio y de productos) van como string y se sanitizan; los
   montos van con csvMoney para salir como número real que Excel puede sumar. */

function summaryRows(title: string, s: PeriodSummary, decimals: number): CsvRow[] {
  const rows: CsvRow[] = [
    [title],
    ["Ventas netas (ya sin devoluciones)", csvMoney(s.sales, decimals)],
    ["Número de ventas", s.tickets],
    ["Venta promedio", csvMoney(s.averageTicket, decimals)],
    ["Devoluciones", csvMoney(s.refunds, decimals)],
    ["Propinas incluidas en las ventas", csvMoney(s.tips, decimals)],
    [
      "Mejor día",
      s.bestDay ? `${s.bestDay.dateKey} (${formatCsvNumber(s.bestDay.sales, decimals)})` : "—"
    ],
    [],
    ["Método de pago", "Ventas", "Total"]
  ];
  for (const m of s.byMethod) rows.push([m.label, m.tickets, csvMoney(m.total, decimals)]);
  rows.push([], ["Producto", "Unidades", "Vendido"]);
  for (const p of s.topProducts) rows.push([p.name, p.units, csvMoney(p.revenue, decimals)]);
  return rows;
}

function dayTable(days: readonly DayRow[], decimals: number): CsvRow[] {
  return [
    ["Fecha", "Día", "Ventas", "Total"],
    ...days.map((d): CsvRow => [d.dateKey, d.weekdayLabel, d.tickets, csvMoney(d.sales, decimals)])
  ];
}

export function monthReportToCsv(report: MonthReport, businessName: string, decimals = 0): string {
  const rows: CsvRow[] = [
    [businessName ? `${businessName} — Reporte de ${report.label}` : `Reporte de ${report.label}`],
    [],
    ...summaryRows(`Resumen de ${report.label}`, report.summary, decimals),
    [],
    ["Semana", "Del", "Al", "Ventas", "Total"],
    ...report.weeks.map(
      (w): CsvRow => [`Semana ${w.index}`, w.startKey, w.endKey, w.summary.tickets, csvMoney(w.summary.sales, decimals)]
    ),
    [],
    ...dayTable(report.days, decimals)
  ];
  return buildCsv(rows);
}

export function weekReportToCsv(week: WeekReport, monthLabelText: string, businessName: string, decimals = 0): string {
  const rows: CsvRow[] = [
    [businessName ? `${businessName} — ${week.label} (${monthLabelText})` : `${week.label} (${monthLabelText})`],
    [],
    ...summaryRows(week.label, week.summary, decimals),
    [],
    ...dayTable(week.days, decimals)
  ];
  return buildCsv(rows);
}

export function monthReportFileName(report: MonthReport): string {
  return `reporte-vimdy-${report.monthKey}.csv`;
}

export function weekReportFileName(report: MonthReport, week: WeekReport): string {
  return `reporte-vimdy-${report.monthKey}-semana-${week.index}.csv`;
}

/** Envoltorio: se conserva el nombre para no tocar a quienes ya lo importan. */
export function downloadCsv(fileName: string, csv: string): void {
  downloadCsvFile(fileName, csv);
}