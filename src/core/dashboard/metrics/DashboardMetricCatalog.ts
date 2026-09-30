/**
 * Contrato declarativo de las métricas que el Dashboard puede mostrar.
 *
 * No decide valores ni consulta datos. Su objetivo es evitar que la UI cree
 * nombres/fórmulas diferentes para la misma métrica.
 */
export const DASHBOARD_METRIC_CATALOG = {
  grossSales: {
    id: "grossSales",
    semanticKey: "sales.gross",
    labelKey: "dashboard.metrics.grossSales",
    valueType: "currency",
    source: "sales.total",
  },
  refundedSales: {
    id: "refundedSales",
    semanticKey: "sales.refunded",
    labelKey: "dashboard.metrics.refundedSales",
    valueType: "currency",
    source: "sales.refunds",
  },
  netSales: {
    id: "netSales",
    semanticKey: "sales.net",
    labelKey: "dashboard.metrics.netSales",
    valueType: "currency",
    source: "sales.total-minus-refunds",
  },
  transactionCount: {
    id: "transactionCount",
    semanticKey: "sales.transactions",
    labelKey: "dashboard.metrics.transactions",
    valueType: "count",
    source: "sales.net-transactions",
  },
  unitsSold: {
    id: "unitsSold",
    semanticKey: "sales.units",
    labelKey: "dashboard.metrics.unitsSold",
    valueType: "count",
    source: "sales.net-items",
  },
  averageTicket: {
    id: "averageTicket",
    semanticKey: "sales.averageTicket",
    labelKey: "dashboard.metrics.averageTicket",
    valueType: "currency",
    source: "sales.net-sales-divided-by-net-transactions",
  },
} as const;

export type DashboardMetricId = keyof typeof DASHBOARD_METRIC_CATALOG;