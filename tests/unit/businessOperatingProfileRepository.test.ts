import { describe, expect, it } from "vitest";

import {
  parseBusinessOperatingProfileRow,
  type BusinessOperatingProfileRow,
} from "../../src/infrastructure/supabase/businessOperatingProfileRepository";

function makeRow(overrides: Partial<BusinessOperatingProfileRow> = {}): BusinessOperatingProfileRow {
  return {
    business_type: "restaurante",
    enabled_modules: ["caja", "pedidos", "inventario", "clientes", "mesas", "cocina", "ia"],
    sales_channels: ["presencial", "domicilio"],
    inventory_type: "ambos",
    production_mode: "on_demand",
    kds_enabled: true,
    printer_enabled: false,
    ...overrides,
  };
}

describe("businessOperatingProfileRepository", () => {
  it("parsea una fila real válida sin aplicar defaults por businessType", () => {
    const profile = parseBusinessOperatingProfileRow(
      "business-1",
      makeRow({
        business_type: "restaurante",
        enabled_modules: ["caja", "inventario"],
        sales_channels: ["presencial"],
        inventory_type: "productos",
        production_mode: null,
        kds_enabled: false,
        printer_enabled: false,
      }),
    );

    expect(profile.businessId).toBe("business-1");
    expect(profile.businessType).toBe("restaurante");
    expect(profile.capabilities.sales).toBe(true);
    expect(profile.capabilities.inventory).toBe(true);
    expect(profile.capabilities.tables).toBe(false);
    expect(profile.capabilities.kitchen).toBe(false);
    expect(profile.capabilities.customers).toBe(false);
  });

  it("rechaza módulos desconocidos para evitar configurar capacidades inventadas", () => {
    expect(() =>
      parseBusinessOperatingProfileRow(
        "business-1",
        makeRow({ enabled_modules: ["caja", "modulo_falso"] }),
      ),
    ).toThrow("módulo no reconocido");
  });

  it("rechaza canales desconocidos", () => {
    expect(() =>
      parseBusinessOperatingProfileRow(
        "business-1",
        makeRow({ sales_channels: ["presencial", "canal_falso"] }),
      ),
    ).toThrow("canal de venta no reconocido");
  });

  it("rechaza tipos operativos inválidos", () => {
    expect(() =>
      parseBusinessOperatingProfileRow(
        "business-1",
        makeRow({ production_mode: "magia" }),
      ),
    ).toThrow("production_mode no reconocido");
  });

  it("permite un negocio sin módulos operativos configurados, sin inventar capacidades", () => {
    const profile = parseBusinessOperatingProfileRow(
      "business-1",
      makeRow({
        enabled_modules: [],
        sales_channels: [],
        inventory_type: null,
        production_mode: null,
        kds_enabled: false,
        printer_enabled: false,
      }),
    );

    expect(profile.capabilities.sales).toBe(false);
    expect(profile.capabilities.orders).toBe(false);
    expect(profile.capabilities.inventory).toBe(false);
    expect(profile.capabilities.tables).toBe(false);
    expect(profile.metrics.netSales).toBe(false);
  });
});
