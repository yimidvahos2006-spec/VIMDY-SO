import type {
  DashboardSalesComparison,
  DashboardSalesPeriodMetrics,
} from "./DashboardMetricTypes";

export interface DashboardSalesReconciliation {
  /** Día empresarial actual hasta el instante de consulta (no día completo). */
  readonly today: DashboardSalesPeriodMetrics;
  /** Día empresarial anterior completo. */
  readonly yesterday: DashboardSalesPeriodMetrics;
  /** Comparación justa: hoy vs ayer a la misma cantidad de tiempo transcurrido. */
  readonly comparable: DashboardSalesComparison;
  /** Últimos 14 días empresariales, cronológicos; el día actual es parcial. */
  readonly history: readonly DashboardSalesPeriodMetrics[];
  /** Momento exacto en que se construyó el snapshot. */
  readonly generatedAt: Date;
  readonly timezone: string;
}
