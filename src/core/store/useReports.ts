import { useCallback, useEffect, useMemo, useState } from "react";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { SalesAI, ProductRanking } from "../ia/SalesAI";
import { Customer, Product, Sale } from "../entities/Entities";
import { useVimdyEvent } from "../../hooks/useVimdyCore";
import { getSaleNetTotal } from "../utils/saleRefunds";

const salesAI = new SalesAI();

export type ReportRange = "hoy" | "7d" | "30d" | "mes" | "todo";

export const RANGE_LABEL: Record<ReportRange, string> = {
  hoy: "Hoy",
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  mes: "Este mes",
  todo: "Todo"
};

function startOfDay(date: Date): Date {
  const copy = new Date(date);
  copy.setHours(0, 0, 0, 0);
  return copy;
}

function rangeStart(range: ReportRange): Date | null {
  const now = new Date();
  if (range === "hoy") return startOfDay(now);
  if (range === "7d") return startOfDay(new Date(now.getTime() - 6 * 86400000));
  if (range === "30d") return startOfDay(new Date(now.getTime() - 29 * 86400000));
  if (range === "mes") return new Date(now.getFullYear(), now.getMonth(), 1);
  return null;
}

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

export function useReports() {
  const [sales, setSales] = useState<Sale[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<ReportRange>("7d");

  const load = useCallback(async () => {
    await productsReady;
    const [allSales, allProducts, allCustomers] = await Promise.all([
      container.salesEngine.getAllSales(),
      container.inventoryEngine.listAll(),
      container.customerEngine.getAllCustomers()
    ]);
    setSales(allSales);
    setProducts(allProducts);
    setCustomers(allCustomers);
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load()
      .catch((e: any) => setError(e.message ?? "No se pudieron cargar los reportes."))
      .finally(() => setLoading(false));
  }, [load]);

  // Igual que useDashboardSync: Reportes leía bien de Supabase, pero solo
  // una vez al montar. Si Computador A cerraba una venta, Computador B no
  // se enteraba hasta recargar la página. "sale" cubre la venta local y
  // la remota (vía realtimeSync); "payment" cubre movimientos de caja que
  // también pueden afectar el reporte (ej. reembolso). No togglea
  // `loading` para no parpadear la pantalla en cada reconciliación.
  useVimdyEvent("sale", () => {
    load().catch((e: any) => setError(e.message ?? "No se pudieron cargar los reportes."));
  });
  useVimdyEvent("payment", () => {
    load().catch((e: any) => setError(e.message ?? "No se pudieron cargar los reportes."));
  });

  const paidSales = useMemo(
    () => sales.filter((s) => s.status === "PAID" || s.status === "CLOSED" || !s.status),
    [sales]
  );

  const filteredSales = useMemo(() => {
    const from = rangeStart(range);
    if (!from) return paidSales;
    return paidSales.filter((s) => new Date(s.createdAt).getTime() >= from.getTime());
  }, [paidSales, range]);

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
   * es exportCsv(): un CSV contable debe mostrar el total ORIGINAL de
   * cada venta como registro histórico, no el neto.
   */
  const netFilteredSales = useMemo(
    () => filteredSales.map((s) => ({ ...s, total: getSaleNetTotal(s) })),
    [filteredSales]
  );

  // Periodo anterior equivalente, para calcular crecimiento igual que en el Dashboard.
  const previousPeriodTotal = useMemo(() => {
    const from = rangeStart(range);
    if (!from) return 0;
    const spanMs = Date.now() - from.getTime();
    const previousFrom = new Date(from.getTime() - spanMs);
    return paidSales
      .filter((s) => {
        const t = new Date(s.createdAt).getTime();
        return t >= previousFrom.getTime() && t < from.getTime();
      })
      .reduce((sum, s) => sum + getSaleNetTotal(s), 0);
  }, [paidSales, range]);

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
    () => salesAI.generateExecutiveSummary(netFilteredSales, previousPeriodTotal),
    [netFilteredSales, previousPeriodTotal]
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
    const from = rangeStart(range) ?? startOfDay(
      filteredSales.length
        ? new Date(Math.min(...filteredSales.map((s) => new Date(s.createdAt).getTime())))
        : new Date()
    );
    const today = startOfDay(new Date());
    const days: DayBucket[] = [];
    for (let cursor = new Date(from); cursor.getTime() <= today.getTime(); cursor.setDate(cursor.getDate() + 1)) {
      days.push({
        label: cursor.toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit" }),
        date: new Date(cursor),
        value: 0
      });
    }
    netFilteredSales.forEach((sale) => {
      const day = startOfDay(new Date(sale.createdAt)).getTime();
      const bucket = days.find((d) => d.date.getTime() === day);
      if (bucket) bucket.value += sale.total;
    });
    // Evita graficar meses enteros día a día si el rango es muy largo (ej. "todo").
    return days.length > 60 ? days.slice(-60) : days;
  }, [filteredSales, netFilteredSales, range]);

  const hourlySeries: HourBucket[] = useMemo(() => {
    const hours: HourBucket[] = Array.from({ length: 24 }, (_, hour) => ({ hour, value: 0 }));
    netFilteredSales.forEach((sale) => {
      const hour = new Date(sale.createdAt).getHours();
      hours[hour].value += sale.total;
    });
    return hours;
  }, [netFilteredSales]);

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
    const header = ["Código", "Fecha", "Cliente", "Items", "Subtotal", "Impuesto", "Total", "Método de pago", "Estado"];
    const rows = filteredSales.map((s) => [
      s.code ?? s.id,
      new Date(s.createdAt).toLocaleString("es-CO"),
      customerNameById.get(s.customerId) ?? s.customerId,
      s.items.reduce((n, i) => n + i.quantity, 0).toString(),
      (s.subtotal ?? s.total).toString(),
      (s.tax ?? 0).toString(),
      s.total.toString(),
      s.paymentMethod ?? "",
      s.status ?? ""
    ]);
    const csv = [header, ...rows]
      .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `reporte-ventas-${range}-${startOfDay(new Date()).toISOString().slice(0, 10)}.csv`;
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
    summary,
    topProducts,
    topCustomers,
    dailySeries,
    hourlySeries,
    paymentMethodBreakdown,
    exportCsv
  };
}