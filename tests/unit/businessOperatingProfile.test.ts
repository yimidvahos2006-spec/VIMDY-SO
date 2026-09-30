import { describe, expect, it } from "vitest";

import {
  buildBusinessOperatingProfile,
  hasBusinessCapability,
  hasBusinessMetric,
  type BusinessOperatingProfileSource,
} from "../../src/core/config/businessOperatingProfile";
import { DEFAULT_OPERATION_CONFIG } from "../../src/core/config/operation";

function makeSource(overrides: Partial<BusinessOperatingProfileSource> = {}): BusinessOperatingProfileSource {
  return {
    businessId: "business-1",
    businessType: "restaurante" as const,
    enabledModules: ["caja", "pedidos", "inventario", "clientes", "mesas", "cocina", "ia"] as const,
    operationConfig: {
      salesChannels: ["presencial", "domicilio"],
      inventoryType: "ambos" as const,
      productionMode: "on_demand" as const,
      kdsEnabled: true,
      printerEnabled: false,
    },
    ...overrides,
  };
}

describe("BusinessOperatingProfile", () => {
  it("usa módulos explícitos y configuración operativa, no businessType, para resolver capacidades", () => {
    const profile = buildBusinessOperatingProfile(
      makeSource({
        enabledModules: ["caja", "inventario", "ia"],
        operationConfig: DEFAULT_OPERATION_CONFIG,
      })
    );

    expect(profile.capabilities.sales).toBe(true);
    expect(profile.capabilities.cash).toBe(true);
    expect(profile.capabilities.inventory).toBe(true);
    expect(profile.capabilities.ai).toBe(true);
    expect(profile.capabilities.tables).toBe(false);
    expect(profile.capabilities.kitchen).toBe(false);
    expect(profile.capabilities.customers).toBe(false);
    expect(profile.capabilities.production).toBe(false);
  });

  it("marca producción solo cuando inventario está activo y existe modo de producción real", () => {
    const profile = buildBusinessOperatingProfile(
      makeSource({
        enabledModules: ["caja", "inventario"],
        operationConfig: {
          ...DEFAULT_OPERATION_CONFIG,
          productionMode: "batch",
          inventoryType: "productos",
        },
      })
    );

    expect(profile.capabilities.production).toBe(true);
    expect(profile.metrics.production).toBe(true);
  });

  it("no crea métricas de mesas o cocina para un negocio que no las tiene habilitadas", () => {
    const profile = buildBusinessOperatingProfile(
      makeSource({
        businessType: "negocio_servicios",
        enabledModules: ["caja", "clientes", "ia"],
      })
    );

    expect(hasBusinessCapability(profile, "tables")).toBe(false);
    expect(hasBusinessCapability(profile, "kitchen")).toBe(false);
    expect(hasBusinessMetric(profile, "tables")).toBe(false);
    expect(hasBusinessMetric(profile, "kitchen")).toBe(false);
    expect(hasBusinessMetric(profile, "netSales")).toBe(true);
    expect(hasBusinessMetric(profile, "averageSaleValue")).toBe(true);
  });

  it("clona la configuración para evitar mutaciones accidentales de la fuente", () => {
    const source = makeSource();
    const profile = buildBusinessOperatingProfile(source);

    profile.operationConfig.salesChannels.push("web");

    expect(source.operationConfig.salesChannels).toEqual(["presencial", "domicilio"]);
  });
});
