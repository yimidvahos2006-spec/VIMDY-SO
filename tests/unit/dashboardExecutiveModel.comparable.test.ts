import { describe, expect, it } from "vitest";

import { buildBusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";
import { buildDashboardExecutiveModel } from "../../src/core/dashboard/executive/DashboardExecutiveModel";
import type { DashboardSnapshot } from "../../src/core/store/dashboardStore";

const profile = buildBusinessOperatingProfile({
  businessId: "b1",
  businessType: null,
  enabledModules: ["caja"],
  operationConfig: {
    salesChannels: ["presencial"],
    inventoryType: null,
    productionMode: null,
    kdsEnabled: false,
    printerEnabled: false,
  },
});

const dashboard: DashboardSnapshot = {
  data: {
    sales: 600,
    customers: 0,
    orders: 6,
    inventory: 0,
    todaySales: 600,
    cashAmount: 300,
    productsSold: 6,
    averageTicket: 100,
    pendingKitchen: 0,
    cashStatus: "CLOSED",
    cashExpectedAmount: 300,
    cashCountedAmount: 300,
    cashDifference: 0,
    cashClosedAt: "2026-09-24T16:00:00.000Z",
    inventoryValuationStatus: "NO_STOCK_TRACKING",
    inventoryValueBasis: "UNAVAILABLE",
    inventoryLowStockCount: 0,
    inventoryHistoricalValueAvailable: false,
    salesComparablePrevious: 500,
    transactionsComparablePrevious: 5,
    averageSaleComparablePrevious: 100,
    comparisonGeneratedAt: "2026-09-24T16:00:00.000Z",
  },
  yesterday: { sales: 700, customers: 0, orders: 7, inventory: null },
  history: { sales: [600], customers: [0], orders: [6], inventory: [null] },
};

describe("DashboardExecutiveModel comparable-period behavior", () => {
  it("uses comparable elapsed-period references instead of a full prior-day total", () => {
    const model = buildDashboardExecutiveModel({
      dashboard,
      snapshot: null,
      profile,
      profileStatus: "ready",
      timezone: "America/Bogota",
      currency: "COP",
      now: new Date("2026-09-24T16:00:00.000Z"),
    });

    expect(model.kpis.find((kpi) => kpi.id === "netSales")?.previousValue).toBe(500);
    expect(model.kpis.find((kpi) => kpi.id === "transactions")?.previousValue).toBe(5);
    expect(model.kpis.find((kpi) => kpi.id === "averageSale")?.previousValue).toBe(100);
  });
});
