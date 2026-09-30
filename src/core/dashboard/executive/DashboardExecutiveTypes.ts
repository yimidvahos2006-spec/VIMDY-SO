import type { BusinessCapabilityId, BusinessOperatingProfile } from "../../config/businessOperatingProfile";
import type { BusinessSnapshot } from "../../types/CopilotTypes";
import type { DashboardSnapshot } from "../../store/dashboardStore";

export type DashboardExecutiveStatus = "ready" | "loading-profile" | "insufficient-data";
export type DashboardExecutiveKpiId =
  | "netSales"
  | "averageSale"
  | "transactions"
  | "profit"
  | "cashClose"
  | "inventoryValue";
export type DashboardExecutiveAttentionId =
  | "cashDifference"
  | "cashOpen"
  | "inventoryLow"
  | "inventoryValuation"
  | "kitchenPending"
  | "salesDrop";
export type DashboardExecutiveOperationId =
  | "cash"
  | "tables"
  | "kitchen"
  | "inventory"
  | "customers"
  | "production";
export type DashboardExecutiveQuickActionId =
  | "newSale"
  | "newCustomer"
  | "newProduct"
  | "newOrder";

export interface DashboardExecutiveInput {
  readonly dashboard: DashboardSnapshot;
  readonly snapshot: BusinessSnapshot | null;
  readonly profile: BusinessOperatingProfile | null;
  readonly profileStatus: "idle" | "loading" | "ready" | "error";
  readonly timezone: string;
  readonly currency: string;
  readonly now: Date;
}

export interface DashboardExecutiveKpi {
  readonly id: DashboardExecutiveKpiId;
  readonly value: number | null;
  readonly previousValue: number | null;
  readonly unit: "currency" | "number";
}

export interface DashboardExecutiveAttention {
  readonly id: DashboardExecutiveAttentionId;
  readonly severity: "warning" | "info";
  readonly value: number | null;
}

export interface DashboardExecutiveOperation {
  readonly id: DashboardExecutiveOperationId;
  readonly value: number | null;
  readonly secondaryValue: number | null;
  readonly state: "ok" | "attention" | "pending" | "unavailable";
}

export interface DashboardExecutiveTrendPoint {
  readonly dateKey: string;
  readonly label: string;
  readonly value: number;
}

export interface DashboardExecutiveClosing {
  readonly status: "CLOSED" | "OPEN" | "NO_SHIFT";
  readonly expected: number | null;
  readonly counted: number | null;
  readonly difference: number | null;
  readonly closedAt: string | null;
  readonly dataComplete: boolean;
}

export interface DashboardExecutiveModel {
  readonly status: DashboardExecutiveStatus;
  readonly businessId: string | null;
  readonly businessName: string;
  readonly currency: string;
  readonly timezone: string;
  readonly dataFreshAt: string | null;
  readonly capabilities: Readonly<Record<BusinessCapabilityId, boolean>>;
  readonly kpis: readonly DashboardExecutiveKpi[];
  readonly attention: readonly DashboardExecutiveAttention[];
  readonly operations: readonly DashboardExecutiveOperation[];
  readonly quickActions: readonly DashboardExecutiveQuickActionId[];
  readonly salesTrend: readonly DashboardExecutiveTrendPoint[];
  readonly closing: DashboardExecutiveClosing;
}
