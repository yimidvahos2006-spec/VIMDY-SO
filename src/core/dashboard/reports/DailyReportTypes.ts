export type DailyReportJobStatus =
  | "PENDING"
  | "PROCESSING"
  | "WAITING_CONFIGURATION"
  | "PARTIAL"
  | "COMPLETED"
  | "FAILED"
  | "SKIPPED";

export type DailyReportChannel = "WHATSAPP" | "EMAIL";

export type DailyReportDeliveryStatus =
  | "PENDING"
  | "PROCESSING"
  | "WAITING_CONFIGURATION"
  | "RETRY"
  | "FAILED"
  | "SENT"
  | "DELIVERED"
  | "READ";

export interface DailyReportSnapshot {
  businessId: string;
  branchId: string;
  businessName: string;
  branchName: string;
  businessDate: string;
  timezone: string;
  currency: string;
  openedAt?: string;
  closedAt: string;
  inventoryObservedAt?: string;
  salesGross: number;
  refundsProcessedToday: number;
  salesNet: number;
  transactionCount: number;
  averageSale: number | null;
  cashExpected: number;
  cashCounted: number;
  cashDifference: number;
  paymentTotals: Record<string, number>;
  salesNetToday?: number;
  transactionCountToday?: number;
  averageSaleToday?: number | null;
  dailyPaymentTotals?: Record<string, number>;
  profitToday?: number | null;
  profitCostCoverageComplete?: boolean;
  topProducts?: Array<{ productId: string; name: string; quantity: number; revenue: number }>;
  distinctProductsSold?: number;
  wasteToday?: number;
  aiSummary?: string;
  lowStockCount: number;
  inventoryCostValue: number | null;
  inventoryValuationComplete: boolean;
  pendingSyncCount: number;
}

export interface DailyReportDeliveryRecord {
  id: string;
  jobId: string;
  channel: DailyReportChannel;
  recipient: string;
  status: DailyReportDeliveryStatus;
  attempts: number;
  providerMessageId: string | null;
  lastError: string | null;
  sentAt: string | null;
  deliveredAt: string | null;
  readAt: string | null;
  updatedAt: string;
}

export interface DailyReportJobSummary {
  id: string;
  businessId: string;
  branchId: string;
  shiftId: string;
  status: DailyReportJobStatus;
  businessDate: string;
  openedAt: string;
  closedAt: string;
  reportText: string | null;
  snapshot: DailyReportSnapshot | null;
  attempts: number;
  lastError: string | null;
  completedAt: string | null;
  updatedAt: string;
  deliveries: DailyReportDeliveryRecord[];
}
