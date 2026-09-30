import { describe, expect, it } from "vitest";

import {
  buildDashboardAdaptiveModel,
  dashboardActionIsAvailable,
  dashboardMetricIsAvailable,
  dashboardSectionIsVisible,
} from "../../src/core/dashboard/adaptive/DashboardAdaptiveModel";
import type { BusinessOperatingProfile } from "../../src/core/config/businessOperatingProfile";

function makeProfile(
  overrides: Partial<BusinessOperatingProfile["capabilities"]> = {},
): BusinessOperatingProfile {
  const capabilities: BusinessOperatingProfile["capabilities"] = {
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

  const metrics: BusinessOperatingProfile["metrics"] = {
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
    metrics,
  };
}

describe("DashboardAdaptiveModel", () => {
  it("no muestra secciones antes de tener perfil operativo listo", () => {
    const model = buildDashboardAdaptiveModel({
      status: "loading",
      businessId: "business-1",
      profile: null,
    });

    expect(model.isReady).toBe(false);
    expect(dashboardSectionIsVisible(model, "inventory")).toBe(false);
    expect(dashboardActionIsAvailable(model, "newSale")).toBe(false);
    expect(dashboardMetricIsAvailable(model, "netSales")).toBe(false);
  });

  it("muestra solo las capacidades realmente activas", () => {
    const model = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ sales: true, cash: true, customers: true }),
    });

    expect(model.isReady).toBe(true);
    expect(dashboardSectionIsVisible(model, "sales")).toBe(true);
    expect(dashboardSectionIsVisible(model, "cash")).toBe(true);
    expect(dashboardSectionIsVisible(model, "customers")).toBe(true);
    expect(dashboardSectionIsVisible(model, "inventory")).toBe(false);
    expect(dashboardSectionIsVisible(model, "tables")).toBe(false);
    expect(dashboardSectionIsVisible(model, "kitchen")).toBe(false);
    expect(dashboardActionIsAvailable(model, "newSale")).toBe(true);
    expect(dashboardActionIsAvailable(model, "newCustomer")).toBe(true);
    expect(dashboardActionIsAvailable(model, "newProduct")).toBe(false);
  });

  it("no activa producción por tipo de negocio; depende de la capacidad real", () => {
    const model = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ sales: true, cash: true }),
    });

    expect(model.capabilities.production).toBe(false);
    expect(dashboardSectionIsVisible(model, "production")).toBe(false);
    expect(dashboardMetricIsAvailable(model, "production")).toBe(false);
  });

  it("habilita producción solo cuando el perfil operativo la declara", () => {
    const model = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ sales: true, inventory: true, production: true }),
    });

    expect(dashboardSectionIsVisible(model, "production")).toBe(true);
    expect(dashboardMetricIsAvailable(model, "production")).toBe(true);
  });

  it("permite reporte diario cuando existen ventas o caja", () => {
    const salesOnly = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ sales: true }),
    });
    const cashOnly = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ cash: true }),
    });
    const unrelated = buildDashboardAdaptiveModel({
      status: "ready",
      businessId: "business-1",
      profile: makeProfile({ customers: true }),
    });

    expect(dashboardSectionIsVisible(salesOnly, "dailyReport")).toBe(true);
    expect(dashboardSectionIsVisible(cashOnly, "dailyReport")).toBe(true);
    expect(dashboardSectionIsVisible(unrelated, "dailyReport")).toBe(false);
  });
});
