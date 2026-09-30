import { describe, expect, it } from "vitest";

import { buildBusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";
import type { BusinessSnapshot } from "../../src/core/types/CopilotTypes";
import type { DashboardSnapshot } from "../../src/core/store/dashboardStore";
import { buildDashboardExecutiveModel } from "../../src/core/dashboard/executive/DashboardExecutiveModel";

const baseDashboard: DashboardSnapshot = {
  data: {
    sales: 1000,
    customers: 0,
    orders: 10,
    inventory: 500,
    todaySales: 1000,
    cashAmount: 900,
    productsSold: 12,
    averageTicket: 100,
    pendingKitchen: 0,
    cashStatus: "CLOSED",
    cashExpectedAmount: 900,
    cashCountedAmount: 900,
    cashDifference: 0,
    cashClosedAt: "2026-09-24T22:00:00.000Z",
    inventoryValuationStatus: "COMPLETE",
    inventoryValueBasis: "PURCHASE_COST",
    inventoryLowStockCount: 0,
    inventoryHistoricalValueAvailable: false,
    salesComparablePrevious: 800,
    transactionsComparablePrevious: 8,
    averageSaleComparablePrevious: 100,
    comparisonGeneratedAt: "2026-09-24T22:30:00.000Z",
  },
  yesterday: { sales: 800, customers: 0, orders: 8, inventory: null },
  history: {
    sales: [500, 600, 700, 800, 900, 850, 1000],
    customers: [0, 0, 0, 0, 0, 0, 0],
    orders: [5, 6, 7, 8, 9, 8, 10],
    inventory: [null, null, null, null, null, null, null],
  },
};

function profileFromModules(modules: Parameters<typeof buildBusinessOperatingProfile>[0]["enabledModules"]) {
  return buildBusinessOperatingProfile({
    businessId: "business-1",
    businessType: "restaurante",
    enabledModules: modules,
    operationConfig: {
      salesChannels: ["presencial"],
      inventoryType: modules.includes("inventario") ? "productos" : null,
      productionMode: modules.includes("inventario") ? "on_demand" : null,
      kdsEnabled: modules.includes("cocina"),
      printerEnabled: false,
    },
  });
}

function snapshot(overrides: Partial<BusinessSnapshot> = {}): BusinessSnapshot {
  return {
    businessName: "Negocio Real",
    currency: "COP",
    todaySales: 1000,
    yesterdaySales: 800,
    salesGrowthPercent: 25,
    totalSalesAllTime: 10000,
    totalOrdersToday: 10,
    averageTicketToday: 100,
    todayProfit: 300,
    todayTopProduct: null,
    todayTopEmployee: null,
    outOfStockProducts: [],
    bestDayOfWeek: null,
    topProducts: [],
    lowStockProducts: [],
    productionAlerts: [],
    topProfitProducts: [],
    lossSummary: { monthLoss: 0, topLossProduct: null, topLossCategory: null },
    starProductCapacity: null,
    topEmployees: [],
    topRefundingEmployees: [],
    purchaseSuggestions: [],
    forecastSummary: { projectedTotal: 0, byDay: [], basedOnWeeks: 0 },
    purchaseRecommendations: [],
    slowMovers: [],
    tableTurnover: [],
    weeklyForecast: null,
    cash: { balance: 0, todayBalance: 0 },
    tableStatus: { free: 0, busy: 0, waitingFood: 0, waitingBill: 0, paying: 0, reserved: 0, total: 0 },
    delayedOrders: [],
    customerStats: { totalCustomers: 0, newCustomersToday: 0, topCustomers: [] },
    criticalAlertsCount: 0,
    kitchenPendingCount: 0,
    outOfStockCount: 0,
    smartAlerts: [],
    healthScore: 0,
    healthMessage: "",
    aiRecommendations: [],
    aiInsights: {} as BusinessSnapshot["aiInsights"],
    learnedPatterns: [],
    ...overrides,
  } as BusinessSnapshot;
}

describe("DashboardExecutiveModel", () => {
  it("solo muestra capacidades habilitadas por el negocio", () => {
    const profile = profileFromModules(["caja"]);
    const model = buildDashboardExecutiveModel({
      dashboard: baseDashboard,
      snapshot: snapshot(),
      profile,
      profileStatus: "ready",
      timezone: "America/Bogota",
      currency: "COP",
      now: new Date("2026-09-24T22:30:00.000Z"),
    });

    expect(model.capabilities.tables).toBe(false);
    expect(model.capabilities.kitchen).toBe(false);
    expect(model.capabilities.inventory).toBe(false);
    expect(model.kpis.map((kpi) => kpi.id)).toEqual([
      "netSales",
      "averageSale",
      "transactions",
      "profit",
      "cashClose",
    ]);
    expect(model.operations.map((operation) => operation.id)).toEqual(["cash"]);
    expect(model.quickActions).toEqual(["newSale"]);
  });

  it("usa el período comparable transcurrido, no el día anterior completo, para variaciones intradía", () => {
    const profile = profileFromModules(["caja"]);
    const model = buildDashboardExecutiveModel({
      dashboard: baseDashboard,
      snapshot: null,
      profile,
      profileStatus: "ready",
      timezone: "America/Bogota",
      currency: "COP",
      now: new Date("2026-09-24T22:30:00.000Z"),
    });

    expect(model.kpis.find((kpi) => kpi.id === "netSales")?.previousValue).toBe(800);
    expect(model.kpis.find((kpi) => kpi.id === "transactions")?.previousValue).toBe(8);
    expect(model.kpis.find((kpi) => kpi.id === "averageSale")?.previousValue).toBe(100);
  });

  it("no presenta ceros iniciales como resultados reales antes de la primera reconciliación", () => {
    const profile = profileFromModules(["caja"]);
    const dashboard: DashboardSnapshot = {
      ...baseDashboard,
      data: { ...baseDashboard.data, comparisonGeneratedAt: null, sales: 0, orders: 0, averageTicket: 0 },
    };
    const model = buildDashboardExecutiveModel({
      dashboard,
      snapshot: null,
      profile,
      profileStatus: "ready",
      timezone: "America/Bogota",
      currency: "COP",
      now: new Date("2026-09-24T22:30:00.000Z"),
    });

    expect(model.status).toBe("insufficient-data");
    expect(model.kpis).toEqual([]);
    expect(model.attention).toEqual([]);
  });
});
