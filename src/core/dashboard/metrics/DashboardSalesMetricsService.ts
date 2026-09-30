import type { Sale } from "../../entities/Entities";
import {
  addBusinessDays,
  businessDayRangeUTC,
  getDayKeyForOffset,
  startOfBusinessDay,
} from "../../utils/businessTime";
import {
  calculateDashboardSalesMetrics,
  calculateDashboardTodayComparison,
} from "./DashboardMetricCalculator";
import type { DashboardSalesPeriodMetrics } from "./DashboardMetricTypes";
import type { DashboardSalesReconciliation } from "./DashboardSalesReconciliationTypes";

export interface DashboardSalesRangeSource {
  findByDateRange(start: Date, end: Date): Promise<Sale[]>;
}

const HISTORY_DAYS = 14;

function cloneDate(value: Date): Date {
  return new Date(value.getTime());
}

function normalizeSaleDates(sales: readonly Sale[]): Sale[] {
  return sales.map((sale) => ({
    ...sale,
    createdAt:
      sale.createdAt instanceof Date ? cloneDate(sale.createdAt) : new Date(sale.createdAt),
    updatedAt:
      sale.updatedAt instanceof Date ? cloneDate(sale.updatedAt) : new Date(sale.updatedAt),
    refunds: (sale.refunds ?? []).map((refund) => ({
      ...refund,
      createdAt:
        refund.createdAt instanceof Date
          ? cloneDate(refund.createdAt)
          : new Date(refund.createdAt),
    })),
  }));
}

function assertValidTimezone(timezone: string): void {
  try {
    new Intl.DateTimeFormat("en-GB", { timeZone: timezone }).format();
  } catch {
    throw new Error(`INVALID_TIMEZONE: ${timezone}`);
  }
}

/**
 * Fuente única de lectura para ventas del Dashboard.
 *
 * Todos los rangos son [inicio, fin): inicio incluido y fin excluido. La
 * misma regla se usa en el repositorio y en el calculador para evitar doble
 * conteo en los límites de día, semana o período.
 */
export class DashboardSalesMetricsService {
  constructor(private readonly source: DashboardSalesRangeSource) {}

  public async buildReconciliation(
    now: Date = new Date(),
    timezone: string,
  ): Promise<DashboardSalesReconciliation> {
    if (Number.isNaN(now.getTime())) {
      throw new Error("INVALID_NOW: now no es una fecha válida.");
    }

    assertValidTimezone(timezone);

    const todayRange = businessDayRangeUTC(now, timezone);
    const historyStart = startOfBusinessDay(
      addBusinessDays(now, timezone, -(HISTORY_DAYS - 1)),
      timezone,
    );
    const fetchEnd = startOfBusinessDay(addBusinessDays(now, timezone, 1), timezone);
    const todayEnd = now < todayRange.end ? now : todayRange.end;

    const sales = normalizeSaleDates(
      await this.source.findByDateRange(historyStart, fetchEnd),
    );

    const today = calculateDashboardSalesMetrics({
      sales,
      periodStart: todayRange.start,
      periodEnd: todayEnd,
      timezone,
    });

    const yesterdayStart = startOfBusinessDay(
      addBusinessDays(now, timezone, -1),
      timezone,
    );
    const yesterday = calculateDashboardSalesMetrics({
      sales,
      periodStart: yesterdayStart,
      periodEnd: todayRange.start,
      timezone,
    });

    const comparable = calculateDashboardTodayComparison(sales, now, timezone);

    const history: DashboardSalesPeriodMetrics[] = [];
    for (let offset = HISTORY_DAYS - 1; offset >= 0; offset -= 1) {
      const dayStart = startOfBusinessDay(
        addBusinessDays(now, timezone, -offset),
        timezone,
      );
      const dayEnd = addBusinessDays(dayStart, timezone, 1);
      const isCurrentDay = offset === 0;

      history.push(
        calculateDashboardSalesMetrics({
          sales,
          periodStart: dayStart,
          periodEnd: isCurrentDay && now < dayEnd ? now : dayEnd,
          timezone,
        }),
      );
    }

    return {
      today,
      yesterday,
      comparable,
      history,
      generatedAt: new Date(now.getTime()),
      timezone,
    };
  }
}

export function getDashboardHistoryDateKeys(
  now: Date,
  timezone: string,
): string[] {
  return Array.from({ length: HISTORY_DAYS }, (_, index) =>
    getDayKeyForOffset(now, timezone, HISTORY_DAYS - 1 - index),
  );
}
