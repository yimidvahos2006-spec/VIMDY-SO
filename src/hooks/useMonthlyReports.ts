// src/hooks/useMonthlyReports.ts
/* Carga las ventas reales del negocio y expone los meses, el detalle de un mes
   y las descargas CSV. Los números salen de src/core/services/monthlyReports.ts. */

import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady } from "../infrastructure/di/CompositionRoot";
import type { Product, Sale } from "../core/entities/Entities";
import { companyConfigStore } from "../core/store/companyConfigStore";
import { businessStore } from "../core/store/businessStore";
import {
  buildMonthReport,
  downloadCsv,
  listReportMonths,
  type MonthReport
} from "../core/services/monthlyReports";
import {
  monthDownloadFromReport,
  weekDownloadFromReport
} from "../core/services/monthlyReportsDownload";
import { useVimdyEvent } from "./useVimdyCore";

const LOAD_ERROR = "No se pudieron cargar los reportes.";
const DOWNLOAD_ERROR = "No se pudo descargar el archivo. Intenta de nuevo.";

export function useMonthlyReports() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);

  const load = useCallback(async () => {
    await productsReady;
    const [allSales, allProducts] = await Promise.all([
      container.salesEngine.get().getAllSales(),
      container.inventoryEngine.get().listAll()
    ]);
    setSales(allSales);
    setProducts(allProducts);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e?.message ?? LOAD_ERROR))
      .finally(() => setLoading(false));
  }, [load]);

  // Igual que Reportes: se recarga cuando entra una venta o un pago.
  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e?.message ?? LOAD_ERROR));
  });
  useVimdyEvent("payment", () => {
    load().catch((e: any) => setError(e?.message ?? LOAD_ERROR));
  });

  // Zona horaria y moneda del NEGOCIO (no las del equipo).
  const tz = companyConfigStore.get().timezone || "America/Bogota";
  const currency = companyConfigStore.get().currency;

  const months = useMemo(() => listReportMonths(sales, tz), [sales, tz]);

  const getMonthReport = useCallback(
    (monthKey: string): MonthReport => buildMonthReport(sales, products, tz, monthKey),
    [sales, products, tz]
  );

  const runDownload = useCallback((action: () => void) => {
    try {
      setDownloadError(null);
      action();
    } catch {
      setDownloadError(DOWNLOAD_ERROR);
    }
  }, []);

  const downloadMonth = useCallback(
    (monthKey: string) =>
      runDownload(() => {
        const file = monthDownloadFromReport(getMonthReport(monthKey), businessStore.get().name, currency);
        downloadCsv(file.fileName, file.csv);
      }),
    [runDownload, getMonthReport, currency]
  );

  const downloadWeek = useCallback(
    (monthKey: string, weekIndex: number) =>
      runDownload(() => {
        const file = weekDownloadFromReport(getMonthReport(monthKey), weekIndex, businessStore.get().name, currency);
        if (!file) throw new Error("Semana no encontrada");
        downloadCsv(file.fileName, file.csv);
      }),
    [runDownload, getMonthReport, currency]
  );

  return { loading, error, downloadError, months, getMonthReport, downloadMonth, downloadWeek };
}
