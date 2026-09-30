import type { Sale } from "../../entities/Entities";
import { getSaleNetItems, getSaleNetTotal, VALID_SALE_STATUSES } from "../../utils/saleRefunds";
import { addBusinessDays, businessDayRangeUTC, startOfBusinessDay } from "../../utils/businessTime";
import type {
  DashboardSalesComparison,
  DashboardSalesMetricInput,
  DashboardSalesMetrics,
  DashboardSalesPeriodMetrics,
} from "./DashboardMetricTypes";

function isCompletedSale(sale: Sale): boolean {
  return typeof sale.status === "string" && VALID_SALE_STATUSES.has(sale.status);
}

function isInPeriod(date: Date, start: Date, end: Date): boolean {
  const timestamp = date.getTime();
  return timestamp >= start.getTime() && timestamp < end.getTime();
}

function sanitizeNumber(value: number): number {
  return Number.isFinite(value) ? value : 0;
}

function calculateMetrics(sales: readonly Sale[]): DashboardSalesMetrics {
  let grossSales = 0;
  let refundedSales = 0;
  let netSales = 0;
  let transactionCount = 0;
  let unitsSold = 0;

  for (const sale of sales) {
    if (!isCompletedSale(sale)) continue;

    const gross = Math.max(sanitizeNumber(sale.total), 0);
    const net = getSaleNetTotal(sale);
    const refunded = Math.max(gross - net, 0);
    const netItems = getSaleNetItems(sale);

    grossSales += gross;
    refundedSales += refunded;
    netSales += net;

    // Un reembolso total deja la transacción en el histórico, pero no debe
    // aparecer como una venta neta ni inflar el ticket promedio.
    if (net > 0) {
      transactionCount += 1;
      unitsSold += netItems.reduce((sum, item) => sum + Math.max(item.quantity, 0), 0);
    }
  }

  const averageTicket = transactionCount > 0 ? netSales / transactionCount : null;

  return {
    grossSales,
    refundedSales,
    netSales,
    transactionCount,
    unitsSold,
    averageTicket,
  };
}

/**
 * Calcula métricas netas para un rango empresarial explícito.
 * No consulta repositorios ni inventa datos: trabaja solo con las ventas
 * recibidas y con sus timestamps persistidos.
 */
export function calculateDashboardSalesMetrics(
  input: DashboardSalesMetricInput,
): DashboardSalesPeriodMetrics {
  if (input.periodEnd.getTime() <= input.periodStart.getTime()) {
    throw new Error("INVALID_PERIOD: periodEnd debe ser posterior a periodStart.");
  }

  const periodSales = input.sales.filter((sale) => {
    const createdAt = sale.createdAt instanceof Date ? sale.createdAt : new Date(sale.createdAt);
    return isInPeriod(createdAt, input.periodStart, input.periodEnd);
  });

  return {
    ...calculateMetrics(periodSales),
    periodStart: new Date(input.periodStart),
    periodEnd: new Date(input.periodEnd),
    timezone: input.timezone,
  };
}

/**
 * Comparación "hoy vs. día empresarial anterior a la misma hora transcurrida".
 * Esto evita comparar un día parcialmente transcurrido contra un día completo.
 */
export function calculateDashboardTodayComparison(
  sales: readonly Sale[],
  now: Date,
  timezone: string,
): DashboardSalesComparison {
  const currentRange = businessDayRangeUTC(now, timezone);
  const currentStart = currentRange.start;
  const previousStart = startOfBusinessDay(addBusinessDays(now, timezone, -1), timezone);

  const elapsedMs = Math.max(0, now.getTime() - currentStart.getTime());
  const currentEnd = new Date(now.getTime());
  const previousEnd = new Date(previousStart.getTime() + elapsedMs);

  const current = calculateDashboardSalesMetrics({
    sales,
    periodStart: currentStart,
    periodEnd: currentEnd > currentRange.end ? currentRange.end : currentEnd,
    timezone,
  });

  const previous = calculateDashboardSalesMetrics({
    sales,
    periodStart: previousStart,
    periodEnd: previousEnd,
    timezone,
  });

  return {
    current,
    previous,
    netSalesChangePercent:
      previous.netSales === 0
        ? null
        : ((current.netSales - previous.netSales) / previous.netSales) * 100,
    netSalesChangeAmount: current.netSales - previous.netSales,
    transactionCountChangePercent:
      previous.transactionCount === 0
        ? null
        : ((current.transactionCount - previous.transactionCount) / previous.transactionCount) * 100,
  };
}

/**
 * Atajo explícito para un día empresarial completo ya cerrado.
 */
export function calculateClosedBusinessDayMetrics(
  sales: readonly Sale[],
  date: Date,
  timezone: string,
): DashboardSalesPeriodMetrics {
  const start = startOfBusinessDay(date, timezone);
  const end = addBusinessDays(date, timezone, 1);
  return calculateDashboardSalesMetrics({ sales, periodStart: start, periodEnd: end, timezone });
}
