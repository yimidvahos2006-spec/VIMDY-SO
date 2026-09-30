import type {
  BusinessCapabilityId,
  BusinessOperatingProfile,
} from "../../config/businessOperatingProfile";
import { getDayKeyForOffset } from "../../utils/businessTime";
import type { BusinessSnapshot } from "../../types/CopilotTypes";
import type { DashboardSnapshot } from "../../store/dashboardStore";
import type {
  DashboardExecutiveAttention,
  DashboardExecutiveClosing,
  DashboardExecutiveInput,
  DashboardExecutiveKpi,
  DashboardExecutiveModel,
  DashboardExecutiveOperation,
  DashboardExecutiveQuickActionId,
  DashboardExecutiveTrendPoint,
} from "./DashboardExecutiveTypes";

const SALES_DROP_THRESHOLD_PERCENT = 15;

const ALL_CAPABILITIES: readonly BusinessCapabilityId[] = [
  "sales",
  "orders",
  "cash",
  "inventory",
  "customers",
  "tables",
  "kitchen",
  "production",
  "ai",
];

function createEmptyCapabilities(): Record<BusinessCapabilityId, boolean> {
  return ALL_CAPABILITIES.reduce((result, capability) => {
    result[capability] = false;
    return result;
  }, {} as Record<BusinessCapabilityId, boolean>);
}

function finiteOrNull(value: number | null | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function getSalesChangePercent(current: number, previous: number): number | null {
  if (!Number.isFinite(current) || !Number.isFinite(previous) || previous === 0) return null;
  return ((current - previous) / previous) * 100;
}

function buildKpis(
  dashboard: DashboardSnapshot,
  snapshot: BusinessSnapshot | null,
  profile: BusinessOperatingProfile,
): DashboardExecutiveKpi[] {
  const kpis: DashboardExecutiveKpi[] = [];

  if (profile.metrics.netSales) {
    kpis.push({
      id: "netSales",
      value: finiteOrNull(dashboard.data.sales),
      previousValue: finiteOrNull(dashboard.data.salesComparablePrevious),
      unit: "currency",
    });
  }

  if (profile.metrics.averageSaleValue) {
    kpis.push({
      id: "averageSale",
      value: finiteOrNull(dashboard.data.averageTicket),
      previousValue: finiteOrNull(dashboard.data.averageSaleComparablePrevious),
      unit: "currency",
    });
  }

  if (profile.metrics.transactionCount) {
    kpis.push({
      id: "transactions",
      value: finiteOrNull(dashboard.data.orders),
      previousValue: finiteOrNull(dashboard.data.transactionsComparablePrevious),
      unit: "number",
    });
  }

  if (profile.metrics.netSales && snapshot) {
    kpis.push({
      id: "profit",
      value: finiteOrNull(snapshot.todayProfit),
      previousValue: null,
      unit: "currency",
    });
  }

  if (profile.metrics.cash) {
    kpis.push({
      id: "cashClose",
      value:
        dashboard.data.cashStatus === "CLOSED"
          ? finiteOrNull(dashboard.data.cashCountedAmount)
          : null,
      previousValue: null,
      unit: "currency",
    });
  }

  if (profile.metrics.inventory) {
    kpis.push({
      id: "inventoryValue",
      value:
        dashboard.data.inventoryValuationStatus === "COMPLETE" &&
        dashboard.data.inventoryValueBasis === "PURCHASE_COST"
          ? finiteOrNull(dashboard.data.inventory)
          : null,
      previousValue: null,
      unit: "currency",
    });
  }

  return kpis;
}

function buildAttention(
  dashboard: DashboardSnapshot,
  profile: BusinessOperatingProfile,
): DashboardExecutiveAttention[] {
  const attention: DashboardExecutiveAttention[] = [];

  if (profile.capabilities.cash) {
    if (
      dashboard.data.cashStatus === "CLOSED" &&
      dashboard.data.cashDifference !== null &&
      dashboard.data.cashDifference !== 0
    ) {
      attention.push({
        id: "cashDifference",
        severity: "warning",
        value: dashboard.data.cashDifference,
      });
    }

    if (dashboard.data.cashStatus === "OPEN") {
      attention.push({ id: "cashOpen", severity: "info", value: null });
    }
  }

  if (profile.capabilities.inventory) {
    if (dashboard.data.inventoryLowStockCount > 0) {
      attention.push({
        id: "inventoryLow",
        severity: "warning",
        value: dashboard.data.inventoryLowStockCount,
      });
    }

    if (dashboard.data.inventoryValuationStatus === "INCOMPLETE") {
      attention.push({ id: "inventoryValuation", severity: "info", value: null });
    }
  }

  if (profile.capabilities.kitchen && dashboard.data.pendingKitchen > 0) {
    attention.push({
      id: "kitchenPending",
      severity: "info",
      value: dashboard.data.pendingKitchen,
    });
  }

  if (profile.metrics.netSales) {
    const previousComparable = finiteOrNull(dashboard.data.salesComparablePrevious);
    const change = previousComparable === null ? null : getSalesChangePercent(dashboard.data.sales, previousComparable);
    if (change !== null && change <= -SALES_DROP_THRESHOLD_PERCENT) {
      attention.push({ id: "salesDrop", severity: "warning", value: change });
    }
  }

  return attention;
}

function buildOperations(
  dashboard: DashboardSnapshot,
  snapshot: BusinessSnapshot | null,
  profile: BusinessOperatingProfile,
): DashboardExecutiveOperation[] {
  const operations: DashboardExecutiveOperation[] = [];

  if (profile.capabilities.cash) {
    operations.push({
      id: "cash",
      value: dashboard.data.cashCountedAmount,
      secondaryValue: dashboard.data.cashDifference,
      state:
        dashboard.data.cashStatus === "CLOSED"
          ? dashboard.data.cashDifference === null
            ? "pending"
            : dashboard.data.cashDifference === 0
              ? "ok"
              : "attention"
          : dashboard.data.cashStatus === "OPEN"
            ? "pending"
            : "unavailable",
    });
  }

  if (profile.capabilities.tables && snapshot) {
    operations.push({
      id: "tables",
      value: snapshot.tableStatus.busy,
      secondaryValue: snapshot.tableStatus.total,
      state: "ok",
    });
  }

  if (profile.capabilities.kitchen) {
    operations.push({
      id: "kitchen",
      value: dashboard.data.pendingKitchen,
      secondaryValue: null,
      state: dashboard.data.pendingKitchen > 0 ? "pending" : "ok",
    });
  }

  if (profile.capabilities.inventory) {
    operations.push({
      id: "inventory",
      value: dashboard.data.inventoryLowStockCount,
      secondaryValue: dashboard.data.inventoryValuationStatus === "COMPLETE" ? dashboard.data.inventory : null,
      state:
        dashboard.data.inventoryLowStockCount > 0
          ? "attention"
          : dashboard.data.inventoryValuationStatus === "INCOMPLETE"
            ? "pending"
            : "ok",
    });
  }

  if (profile.capabilities.customers && snapshot) {
    operations.push({
      id: "customers",
      value: snapshot.customerStats.newCustomersToday,
      secondaryValue: snapshot.customerStats.totalCustomers,
      state: "ok",
    });
  }

  if (profile.capabilities.production && snapshot) {
    operations.push({
      id: "production",
      value: snapshot.productionAlerts.length,
      secondaryValue: snapshot.starProductCapacity?.maxUnits ?? null,
      state: snapshot.productionAlerts.length > 0 ? "attention" : "ok",
    });
  }

  return operations;
}

function buildQuickActions(profile: BusinessOperatingProfile): DashboardExecutiveQuickActionId[] {
  const actions: DashboardExecutiveQuickActionId[] = [];
  if (profile.capabilities.sales) actions.push("newSale");
  if (profile.capabilities.customers) actions.push("newCustomer");
  if (profile.capabilities.inventory) actions.push("newProduct");
  if (profile.capabilities.orders) actions.push("newOrder");
  return actions;
}

function buildTrend(
  dashboard: DashboardSnapshot,
  timezone: string,
  now: Date,
): DashboardExecutiveTrendPoint[] {
  return dashboard.history.sales.map((value, index, values) => {
    const offset = values.length - 1 - index;
    const dateKey = getDayKeyForOffset(now, timezone, offset);
    const [year, month, day] = dateKey.split("-").map(Number);
    const date = new Date(Date.UTC(year, month - 1, day));

    return {
      dateKey,
      label: new Intl.DateTimeFormat("es-CO", {
        timeZone: "UTC",
        day: "2-digit",
        month: "2-digit",
      }).format(date),
      value: Number.isFinite(value) ? value : 0,
    };
  });
}

function buildClosing(dashboard: DashboardSnapshot): DashboardExecutiveClosing {
  return {
    status: dashboard.data.cashStatus,
    expected: dashboard.data.cashExpectedAmount,
    counted: dashboard.data.cashCountedAmount,
    difference: dashboard.data.cashDifference,
    closedAt: dashboard.data.cashClosedAt,
    dataComplete:
      dashboard.data.cashExpectedAmount !== null &&
      dashboard.data.cashCountedAmount !== null &&
      dashboard.data.cashDifference !== null,
  };
}

export function buildDashboardExecutiveModel(
  input: DashboardExecutiveInput,
): DashboardExecutiveModel {
  const capabilities = createEmptyCapabilities();

  if (!input.profile || input.profileStatus !== "ready") {
    return {
      status: input.profileStatus === "loading" ? "loading-profile" : "insufficient-data",
      businessId: input.profile?.businessId ?? null,
      businessName: input.snapshot?.businessName ?? "VIMDY",
      currency: input.currency,
      timezone: input.timezone,
      dataFreshAt: input.dashboard.data.comparisonGeneratedAt ?? null,
      capabilities,
      kpis: [],
      attention: [],
      operations: [],
      quickActions: [],
      salesTrend: [],
      closing: buildClosing(input.dashboard),
    };
  }

  for (const capability of ALL_CAPABILITIES) {
    capabilities[capability] = input.profile.capabilities[capability];
  }

  const hasRealDashboardData = input.dashboard.data.comparisonGeneratedAt != null;

  return {
    status: hasRealDashboardData ? "ready" : "insufficient-data",
    businessId: input.profile.businessId,
    businessName: input.snapshot?.businessName ?? "VIMDY",
    currency: input.currency,
    timezone: input.timezone,
    dataFreshAt: input.dashboard.data.comparisonGeneratedAt ?? null,
    capabilities,
    kpis: hasRealDashboardData ? buildKpis(input.dashboard, input.snapshot, input.profile) : [],
    attention: hasRealDashboardData ? buildAttention(input.dashboard, input.profile) : [],
    operations: hasRealDashboardData ? buildOperations(input.dashboard, input.snapshot, input.profile) : [],
    quickActions: buildQuickActions(input.profile),
    salesTrend: hasRealDashboardData ? buildTrend(input.dashboard, input.timezone, input.now) : [],
    closing: buildClosing(input.dashboard),
  };
}