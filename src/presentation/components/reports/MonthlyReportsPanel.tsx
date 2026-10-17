import React, { useMemo, useState } from "react";
import type { Product, Sale } from "../../../core/entities/Entities";
import { buildMonthReport, downloadCsv, listReportMonths } from "../../../core/services/monthlyReports";
import {
  monthDownloadFromReport,
  monthsOfYear,
  pickYear,
  reportYears,
  weekDownloadFromReport
} from "../../../core/services/monthlyReportsDownload";
import { MonthlyReportsSection } from "./MonthlyReportsSection";

const DOWNLOAD_ERROR = "No se pudo descargar el archivo. Intenta de nuevo.";

interface Props {
  loading: boolean;
  error: string | null;
  /** TODAS las ventas del negocio (no solo las del rango elegido). */
  allSales: readonly Sale[];
  products: readonly Product[];
  /** Zona horaria DEL NEGOCIO. */
  tz: string;
  businessName: string | null | undefined;
  currency: string;
  /** Permiso reports.export: sin él no aparece ningún botón de descarga. */
  canExport: boolean;
  /** Solo para pruebas: fecha de "hoy". */
  now?: Date;
}

export function MonthlyReportsPanel({
  loading,
  error,
  allSales,
  products,
  tz,
  businessName,
  currency,
  canExport,
  now
}: Props) {
  const [selectedYear, setSelectedYear] = useState<number | null>(null);
  const [openMonthKey, setOpenMonthKey] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const months = useMemo(() => listReportMonths(allSales, tz, now), [allSales, tz, now]);
  const years = useMemo(() => reportYears(months), [months]);
  const year = pickYear(years, selectedYear);
  const yearMonths = useMemo(() => monthsOfYear(months, year), [months, year]);

  const openReport = useMemo(
    () => (openMonthKey ? buildMonthReport(allSales, products, tz, openMonthKey) : null),
    [openMonthKey, allSales, products, tz]
  );

  function runDownload(action: () => void) {
    try {
      setDownloadError(null);
      action();
    } catch {
      setDownloadError(DOWNLOAD_ERROR);
    }
  }

  function downloadMonth(monthKey: string) {
    if (!canExport) return;
    runDownload(() => {
      const report = buildMonthReport(allSales, products, tz, monthKey);
      const file = monthDownloadFromReport(report, businessName, currency);
      downloadCsv(file.fileName, file.csv);
    });
  }

  function downloadWeek(monthKey: string, weekIndex: number) {
    if (!canExport) return;
    runDownload(() => {
      const report = buildMonthReport(allSales, products, tz, monthKey);
      const file = weekDownloadFromReport(report, weekIndex, businessName, currency);
      if (!file) throw new Error("Semana no encontrada");
      downloadCsv(file.fileName, file.csv);
    });
  }

  return (
    <div className="space-y-4">
      {!loading && !openReport && years.length > 0 && (
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Año">
          <span className="text-sm text-vimdy-text-secondary mr-1">Año</span>
          {years.map((y) => (
            <button
              key={y}
              type="button"
              aria-pressed={y === year}
              onClick={() => setSelectedYear(y)}
              className={`px-4 py-2 rounded-xl text-sm font-semibold transition border ${
                y === year
                  ? "bg-vimdy-accent text-white border-vimdy-accent"
                  : "bg-vimdy-surface-hover text-vimdy-text-secondary border-vimdy-border hover:border-vimdy-accent/50"
              }`}
            >
              {y}
            </button>
          ))}
        </div>
      )}

      <MonthlyReportsSection
        loading={loading}
        error={error}
        downloadError={downloadError}
        months={yearMonths}
        openReport={openReport}
        canExport={canExport}
        onOpen={setOpenMonthKey}
        onBack={() => setOpenMonthKey(null)}
        onDownloadMonth={downloadMonth}
        onDownloadWeek={downloadWeek}
      />
    </div>
  );
}