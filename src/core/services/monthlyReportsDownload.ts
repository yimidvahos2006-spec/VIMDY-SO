// src/core/services/monthlyReportsDownload.ts
/* ===========================================================================
   Descargas de "Reportes por mes"
   ---------------------------------------------------------------------------
   Pegamento PURO entre la pantalla y monthlyReports.ts. NO recalcula nada:
   todos los números salen de buildMonthReport / monthReportToCsv /
   weekReportToCsv, que ya existen y ya tienen pruebas.
   Aquí solo se decide:
     - qué nombre de negocio va en el encabezado del CSV,
     - cuántos decimales lleva la moneda,
     - cómo se escribe el "% contra el mes anterior".
=========================================================================== */

import type { Product, Sale } from "../entities/Entities";
import { getCurrencyDecimalDigits } from "../config/globalization";
import {
  buildMonthReport,
  monthReportFileName,
  monthReportToCsv,
  weekReportFileName,
  weekReportToCsv,
  type MonthReport
} from "./monthlyReports";

/** Nombre que trae Configuración de fábrica; no es un nombre real de negocio. */
export const DEFAULT_BUSINESS_NAME = "VIMDY Demo";

export interface CsvDownload {
  fileName: string;
  csv: string;
}

/** Nombre para el encabezado del CSV: vacío si no hay nombre real. */
export function csvBusinessName(name: string | null | undefined): string {
  const clean = (name ?? "").trim();
  if (!clean) return "";
  if (clean.toLowerCase() === DEFAULT_BUSINESS_NAME.toLowerCase()) return "";
  return clean;
}

/** Decimales reales de la moneda del negocio (COP = 0). */
export function csvDecimalsFor(currency: string): number {
  return getCurrencyDecimalDigits((currency || "").trim().toUpperCase());
}

/** "+12,5 %", "-3,0 %", "0,0 %". Devuelve null si no hay mes anterior con ventas. */
export function formatChangePct(pct: number | null): string | null {
  if (pct === null || !Number.isFinite(pct)) return null;
  const text = Math.abs(pct).toFixed(1).replace(".", ",");
  if (text === "0,0") return "0,0 %";
  return pct > 0 ? `+${text} %` : `-${text} %`;
}

export function changeTrend(pct: number | null): "up" | "down" | "flat" | null {
  const text = formatChangePct(pct);
  if (text === null) return null;
  if (text === "0,0 %") return "flat";
  return (pct as number) > 0 ? "up" : "down";
}

/** ¿El mes tiene al menos una venta válida? (si no, no hay nada que descargar). */
export function monthHasSales(report: MonthReport): boolean {
  return report.summary.tickets > 0;
}

export function monthDownloadFromReport(
  report: MonthReport,
  businessName: string | null | undefined,
  currency: string
): CsvDownload {
  return {
    fileName: monthReportFileName(report),
    csv: monthReportToCsv(report, csvBusinessName(businessName), csvDecimalsFor(currency))
  };
}

/** CSV de una semana (1, 2, 3...) de un mes ya calculado. null si esa semana no existe. */
export function weekDownloadFromReport(
  report: MonthReport,
  weekIndex: number,
  businessName: string | null | undefined,
  currency: string
): CsvDownload | null {
  const week = report.weeks.find((w) => w.index === weekIndex);
  if (!week) return null;
  return {
    fileName: weekReportFileName(report, week),
    csv: weekReportToCsv(week, report.label, csvBusinessName(businessName), csvDecimalsFor(currency))
  };
}

export function buildMonthDownload(
  sales: readonly Sale[],
  products: readonly Product[],
  tz: string,
  monthKey: string,
  businessName: string | null | undefined,
  currency: string
): CsvDownload {
  return monthDownloadFromReport(buildMonthReport(sales, products, tz, monthKey), businessName, currency);
}
