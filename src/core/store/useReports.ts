// src/core/store/useReports.ts
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { SalesAI } from "../ia/SalesAI";
import type { ProductRanking } from "../ia/SalesAI";
import type { Customer, InventoryMovement, Product, Sale } from "../entities/Entities";
import type { Profitability } from "../engines/RecipeEngine";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { getSaleNetItems, getSaleNetTotal, isRevenueSaleStatus } from "../utils/saleRefunds";
import { companyConfigStore } from "../store/companyConfigStore";
import {
  addBusinessDays,
  getBusinessDateKey,
  getBusinessHour,
  startOfBusinessDay
} from "../utils/businessTime";
import {
  REPORT_RANGE_LABEL,
  filterByReportRange,
  getPreviousReportRange,
  normalizeReportTimezone,
  resolveReportRange
} from "../utils/reportRanges";
import type { ReportRange, ResolvedReportRange } from "../utils/reportRanges";
import { buildFinancialReport } from "../domain/finance/financialReport";
import type { FinancialReport } from "../domain/finance/financialReport";
import type { ProfitCatalogItem, ProfitSaleLine } from "../domain/profit/profitEngine";

const salesAI = new SalesAI();

/**
 * Los rangos viven en `reportRanges.ts` (fuente única). Se re-exportan aquí
 * para no romper a quien ya importa `ReportRange` / `RANGE_LABEL` desde este hook.
 */
export type { ReportRange, ResolvedReportRange };
export const RANGE_LABEL: Record<ReportRange, string> = REPORT_RANGE_LABEL;

/** Máximo de días que dibuja la gráfica diaria (se muestran los más recientes). */
const MAX_DAILY_BUCKETS = 60;

export interface DayBucket {
  label: string;
  date: Date;
  value: number;
}

export interface HourBucket {
  hour: number;
  value: number;
}

export interface RankedCustomer {
  customerId: string;
  name: string;
  total: number;
}

export interface PaymentMethodBreakdown {
  method: string;
  total: number;
}

export interface UseReportsResult {
  loading: boolean;
  error: string | null;
  range: ReportRange;
  setRange: Dispatch<SetStateAction<ReportRange>>;
  sales: Sale[];
  allSales: Sale[];
  products: Product[];
  tz: string;
  summary: ReturnType<SalesAI["generateExecutiveSummary"]>;
  topProducts: Array<ProductRanking & { name: string }>;
  topCustomers: RankedCustomer[];
  dailySeries: DayBucket[];
  hourlySeries: HourBucket[];
  paymentMethodBreakdown: PaymentMethodBreakdown[];
  exportCsv: () => void;
  /** Ventana exacta del rango elegido (inicio incluido, fin excluido, en zona del negocio). */
  resolvedRange: ResolvedReportRange;
  /**
   * Reporte financiero consolidado del rango: ventas netas, COGS, utilidad
   * bruta, pérdidas del Kardex y utilidad real. `null` mientras no hay datos
   * del Kardex/costos o si fallaron (ver `financialError`).
   */
  financial: FinancialReport | null;
  /** Error al cargar Kardex/costos. Los reportes de ventas siguen funcionando. */
  financialError: string | null;
}

/** Revenue uses the payment date when known; old records fall back to createdAt. */
function getRevenueDate(sale: Sale): Date {
  const paidAt = sale.paidAt;
  if (paidAt instanceof Date && Number.isFinite(paidAt.getTime())) return paidAt;
  const createdAt = sale.createdAt;
  return createdAt instanceof Date && Number.isFinite(createdAt.getTime())
    ? createdAt
    : new Date(0);
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) return error.message;
  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }
  return fallback;
}

/* -------------------------------------------------------------------------- */
/* Adaptadores hacia el motor financiero (mismas reglas que Centro de          */
/* Ganancias: costo promedio ponderado, si no el último precio de compra;      */
/* líneas netas de reembolsos y descuento de la venta repartido por línea).    */
/* -------------------------------------------------------------------------- */

function buildProfitCatalog(products: readonly Product[]): ProfitCatalogItem[] {
  return products.map((product) => {
    const average = product.averageCost;
    const cost = typeof average === "number" && average > 0 ? average : product.purchasePrice;
    return {
      id: product.id,
      name: product.name,
      unitCost: typeof cost === "number" && Number.isFinite(cost) && cost > 0 ? cost : null,
      recipe: (product.recipe ?? []).map((line) => ({ ingredientId: line.productId, quantity: line.quantity }))
    };
  });
}

function buildProfitSaleLines(sales: readonly Sale[]): ProfitSaleLine[] {
  return sales.flatMap((sale) => {
    const netItems = getSaleNetItems(sale);
    const gross = netItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const rawDiscount = Number(sale.discount);
    const saleDiscount = Number.isFinite(rawDiscount) && rawDiscount > 0 ? Math.min(rawDiscount, gross) : 0;
    return netItems.map((item): ProfitSaleLine => {
      const lineGross = item.price * item.quantity;
      return {
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.price,
        discount: gross > 0 ? (saleDiscount * lineGross) / gross : 0
      };
    });
  });
}

interface FinancialSources {
  readonly movements: InventoryMovement[];
  readonly profitability: Map<string, Profitability>;
}

export function useReports(): UseReportsResult {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [financialSources, setFinancialSources] = useState<FinancialSources | null>(null);
  const [financialError, setFinancialError] = useState<string | null>(null);
  const [now, setNow] = useState<Date>(() => new Date());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRange>("7d");
  const loadRunRef = useRef(0);

  const load = useCallback(async () => {
    const runId = ++loadRunRef.current;
    await productsReady;

    const corePromise = Promise.all([
      container.salesEngine.get().getAllSales(),
      container.inventoryEngine.get().listAll(),
      container.customerEngine.get().getAllCustomers()
    ]);
    const financialPromise = Promise.all([
      container.kardexEngine.get().getAllMovements(),
      container.recipeEngine.get().getAllProfitability()
    ]);
    // Si el núcleo falla primero, esta promesa no debe quedar como "unhandled".
    financialPromise.catch(() => undefined);

    const [allSales, allProducts, allCustomers] = await corePromise;
    if (runId !== loadRunRef.current) return;
    setSales(allSales);
    setProducts(allProducts);
    setCustomers(allCustomers);
    setNow(new Date());

    // Kardex y costos son opcionales para Reportes: si fallan, las ventas siguen.
    try {
      const [movements, profitability] = await financialPromise;
      if (runId !== loadRunRef.current) return;
      setFinancialSources({ movements, profitability });
      setFinancialError(null);
    } catch (cause: unknown) {
      if (runId !== loadRunRef.current) return;
      setFinancialSources(null);
      setFinancialError(getErrorMessage(cause, "No se pudo cargar el reporte financiero."));
    }
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((cause: unknown) => setError(getErrorMessage(cause, "No se pudieron cargar los reportes.")))
      .finally(() => setLoading(false));
  }, [load]);

  const refresh = useCallback(() => {
    load().catch((cause: unknown) => setError(getErrorMessage(cause, "No se pudieron cargar los reportes.")));
  }, [load]);

  useVimdyEvent("sale", refresh);
  useVimdyEvent("payment", refresh);
  // Una pérdida/ajuste del Kardex cambia las pérdidas y la utilidad real.
  useVimdyEvent("inventory", refresh);

  const tz = useMemo(() => normalizeReportTimezone(companyConfigStore.get().timezone), []);

  /** Ventana exacta [inicio, fin) del rango elegido, en días calendario del negocio. */
  const resolvedRange = useMemo(() => resolveReportRange(range, now, tz), [range, now, tz]);

  const paidSales = useMemo(() => sales.filter((sale) => isRevenueSaleStatus(sale.status)), [sales]);

  const filteredSales = useMemo(
    () => filterByReportRange(paidSales, getRevenueDate, resolvedRange),
    [paidSales, resolvedRange]
  );

  /**
   * Fase 3 (5.2 / consistencia con reembolso parcial): una venta con
   * devolución parcial se queda en status PAID/CLOSED (no cambia de
   * estado a propósito — ver SalesEngine.partialRefundSale), así que
   * `filteredSales` la sigue incluyendo, correctamente. El problema es
   * que TODO lo que se deriva de acá (KPIs de SalesAI, gráfica por día,
   * por hora, por método de pago) leía `sale.total` a secas, sin restar
   * lo reembolsado — sobre-contando justo lo que el bloqueante #1.11 de
   * la auditoría exige que cuadre. `netFilteredSales` es el único punto
   * de transformación: todo lo que se calcula MÁS ABAJO (KPIs, gráficas)
   * debe usar esto, no `filteredSales` directo. La excepción a propósito
   * exportCsv() conserva los valores originales de subtotal/impuesto/total,
   * pero muestra también el reembolso acumulado y el total neto que cuenta
   * como ingreso. Así el histórico bruto no se confunde con el ingreso real.
   */
  const netFilteredSales = useMemo(
    () => filteredSales.map((s) => ({
      ...s,
      total: getSaleNetTotal(s),
      items: getSaleNetItems(s),
      refunds: []
    })),
    [filteredSales]
  );

  const previousPeriodTotal = useMemo(() => {
    const previous = getPreviousReportRange(resolvedRange);
    if (!previous) return 0;
    return filterByReportRange(paidSales, getRevenueDate, previous)
      .reduce((sum, s) => sum + getSaleNetTotal(s), 0);
  }, [paidSales, resolvedRange]);

  /** Reporte financiero consolidado (ventas netas − COGS − pérdidas del Kardex). */
  const financial = useMemo<FinancialReport | null>(() => {
    if (!financialSources) return null;
    return buildFinancialReport({
      catalog: buildProfitCatalog(products),
      sales: buildProfitSaleLines(filteredSales),
      movements: financialSources.movements,
      products,
      unitCosts: financialSources.profitability,
      // "Todo" no tiene límites: sin periodo = todo el histórico de pérdidas.
      period: resolvedRange.start || resolvedRange.endExclusive
        ? { from: resolvedRange.start?.getTime(), to: resolvedRange.endExclusive?.getTime() }
        : undefined,
      now,
      businessToday: getBusinessDateKey(now, tz)
    });
  }, [financialSources, products, filteredSales, resolvedRange, now, tz]);

  const productNameById = useMemo(() => {
    const map = new Map<string, string>();
    products.forEach((p) => map.set(p.id, p.name));
    return map;
  }, [products]);

  const customerNameById = useMemo(() => {
    const map = new Map<string, string>();
    customers.forEach((c) => map.set(c.id, c.name));
    return map;
  }, [customers]);

  const summary = useMemo(
    () => salesAI.generateExecutiveSummary(netFilteredSales, previousPeriodTotal, tz),
    [netFilteredSales, previousPeriodTotal, tz]
  );

  const topProducts: (ProductRanking & { name: string })[] = useMemo(() => {
    return salesAI
      .getBestSellingProducts(netFilteredSales)
      .slice(0, 10)
      .map((p) => ({ ...p, name: productNameById.get(p.productId) ?? "Producto eliminado" }));
  }, [netFilteredSales, productNameById]);

  const topCustomers: RankedCustomer[] = useMemo(() => {
    const byCustomer = salesAI.getSalesByCustomer(netFilteredSales);
    return [...byCustomer.entries()]
      .filter(([id]) => id !== "CLIENTE_GENERAL")
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([customerId, total]) => ({
        customerId,
        name: customerNameById.get(customerId) ?? "Cliente eliminado",
        total
      }));
  }, [netFilteredSales, customerNameById]);

  const dailySeries: DayBucket[] = useMemo(() => {
    const today = startOfBusinessDay(now, tz);
    // Solo se dibujan los últimos MAX_DAILY_BUCKETS días: no se recorre más atrás.
    const oldestShown = addBusinessDays(today, tz, -(MAX_DAILY_BUCKETS - 1));

    let from: Date;
    if (resolvedRange.start) {
      from = resolvedRange.start;
    } else {
      // "Todo": desde la primera venta (o hoy si no hay ventas).
      const earliest = filteredSales.reduce(
        (min, sale) => Math.min(min, getRevenueDate(sale).getTime()),
        Number.POSITIVE_INFINITY
      );
      from = startOfBusinessDay(Number.isFinite(earliest) ? new Date(earliest) : now, tz);
    }
    if (from.getTime() < oldestShown.getTime()) from = oldestShown;

    const days: DayBucket[] = [];
    const bucketByKey = new Map<string, DayBucket>();
    for (let cursor = from; cursor.getTime() <= today.getTime(); cursor = addBusinessDays(cursor, tz, 1)) {
      const bucket: DayBucket = {
        label: cursor.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", timeZone: tz }),
        date: cursor,
        value: 0
      };
      days.push(bucket);
      bucketByKey.set(getBusinessDateKey(cursor, tz), bucket);
    }
    netFilteredSales.forEach((sale) => {
      const bucket = bucketByKey.get(getBusinessDateKey(getRevenueDate(sale), tz));
      if (bucket) bucket.value += sale.total;
    });
    return days;
  }, [filteredSales, netFilteredSales, resolvedRange, now, tz]);

  const hourlySeries: HourBucket[] = useMemo(() => {
    const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0 }));
    netFilteredSales.forEach((sale) => {
      const hour = getBusinessHour(getRevenueDate(sale), tz);
      hours[hour].value += sale.total;
    });
    return hours;
  }, [netFilteredSales, tz]);

  const paymentMethodBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    netFilteredSales.forEach((sale) => {
      const method = sale.paymentMethod ?? "Sin especificar";
      map.set(method, (map.get(method) ?? 0) + sale.total);
    });
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .map(([method, total]) => ({ method, total }));
  }, [netFilteredSales]);

  function exportCsv() {
    const header = [
      "Código", "Fecha", "Cliente", "Items netos", "Subtotal original", "Impuesto original",
      "Total original", "Total reembolsado", "Total neto", "Método de pago", "Estado"
    ];
    const rows = filteredSales.map((s) => [
      s.code ?? s.id,
      getRevenueDate(s).toLocaleString("es-CO", { timeZone: tz }),
      customerNameById.get(s.customerId) ?? s.customerId,
      getSaleNetItems(s).reduce((n, i) => n + i.quantity, 0).toString(),
      (s.subtotal ?? s.total).toString(),
      (s.tax ?? 0).toString(),
      s.total.toString(),
      (s.total - getSaleNetTotal(s)).toString(),
      getSaleNetTotal(s).toString(),
      s.paymentMethod ?? "",
      s.status ?? ""
    ]);
    // Excel en español necesita "sep=;", separador ";" y BOM para abrir bien las columnas y las tildes.
    const csv =
      "sep=;\r\n" +
      [header, ...rows]
        .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(";"))
        .join("\r\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-ventas-${range}-${getBusinessDateKey(new Date(), tz)}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }

  return {
    loading,
    error,
    range,
    setRange,
    sales: filteredSales,
    // Para "Reportes por mes": TODAS las ventas (sin filtrar por rango), los productos y la zona horaria del negocio.
    allSales: sales,
    products,
    tz,
    summary,
    topProducts,
    topCustomers,
    dailySeries,
    hourlySeries,
    paymentMethodBreakdown,
    exportCsv,
    resolvedRange,
    financial,
    financialError
  };
}