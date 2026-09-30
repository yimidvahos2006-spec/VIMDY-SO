import type { Sale } from "../../entities/Entities";

/**
 * Tipos de la capa de métricas reales del Dashboard.
 *
 * Regla de diseño:
 * - Los importes de venta siempre se calculan con getSaleNetTotal().
 * - Una transacción totalmente reembolsada no cuenta como venta neta.
 * - No se inventan valores cuando no existen datos.
 */

export interface DashboardSalesMetrics {
  readonly grossSales: number;
  readonly refundedSales: number;
  readonly netSales: number;
  readonly transactionCount: number;
  readonly unitsSold: number;
  readonly averageTicket: number | null;
}

export interface DashboardSalesPeriodMetrics extends DashboardSalesMetrics {
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly timezone: string;
}

export interface DashboardSalesComparison {
  readonly current: DashboardSalesPeriodMetrics;
  readonly previous: DashboardSalesPeriodMetrics;
  /** Porcentaje sobre el período comparable. null cuando la base es 0. */
  readonly netSalesChangePercent: number | null;
  /** Diferencia absoluta de ventas netas. */
  readonly netSalesChangeAmount: number;
  /** Porcentaje de cambio del número de transacciones. null cuando la base es 0. */
  readonly transactionCountChangePercent: number | null;
}

export interface DashboardSalesMetricInput {
  readonly sales: readonly Sale[];
  readonly periodStart: Date;
  readonly periodEnd: Date;
  readonly timezone: string;
}
