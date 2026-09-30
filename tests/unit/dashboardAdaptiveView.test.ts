import { describe, expect, it } from "vitest";

import { buildDashboardAdaptiveModel } from "../../src/core/dashboard/adaptive/DashboardAdaptiveModel";
import {
  getVisibleDashboardIndicators,
  getVisibleDashboardQuickActions,
  shouldShowDailyReport,
} from "../../src/core/dashboard/adaptive/DashboardAdaptiveView";
import type { BusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";

function profile(overrides: Partial<BusinessOperatingProfile["capabilities"]>): BusinessOperatingProfile {
  const capabilities = {
    sales: false,
    orders: false,
    cash: false,
    inventory: false,
    customers: false,
    tables: false,
    kitchen: false,
    production: false,
    ai: false,
    ...overrides,
  };

  return {
    businessId: "business-1",
    businessType: "otro",
    enabledModules: [],
    operationConfig: {
      salesChannels: [],
      inventoryType: null,
      productionMode: null,
      kdsEnabled: false,
      printerEnabled: false,
    },
    operationConfigStatus: "loaded",
    capabilities,
    metrics: {
      netSales: capabilities.sales,
      transactionCount: capabilities.sales,
      averageSaleValue: capabilities.sales,
      cash: capabilities.cash,
      inventory: capabilities.inventory,
      customers: capabilities.customers,
      tables: capabilities.tables,
      kitchen: capabilities.kitchen,
      production: capabilities.production,
      ai: capabilities.ai,
    },
  };
}

describe("DashboardAdaptiveView", () => {
  it("no expone indicadores ni acciones antes de cargar el perfil", () => {
    const model = buildDashboardAdaptiveModel({ status: "loading", businessId: "business-1", profile: null });
    expect(getVisibleDashboardIndicators(model)).toEqual([]);
    expect(getVisibleDashboardQuickActions(model)).toEqual([]);
    expect(shouldShowDailyReport(model)).toBe(false);
  });

  it("adapta indicadores y acciones a las capacidades reales", () => {
    const model = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: profile({ sales: true, cash: true, customers: true }),
    });

    expect(getVisibleDashboardIndicators(model)).toEqual(["sales", "profit", "cash", "health"]);
    expect(getVisibleDashboardQuickActions(model)).toEqual(["newSale", "newCustomer"]);
    expect(shouldShowDailyReport(model)).toBe(true);
  });

  it("no crea métricas de operación que el negocio no usa", () => {
    const model = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: profile({ inventory: true, kitchen: true }),
    });

    expect(getVisibleDashboardIndicators(model)).toEqual([]);
    expect(getVisibleDashboardQuickActions(model)).toEqual(["newProduct"]);
    expect(shouldShowDailyReport(model)).toBe(false);
  });
});
