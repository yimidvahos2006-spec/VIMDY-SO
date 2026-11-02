import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { result: { data: unknown; error: { message: string } | null } } = {
  result: { data: [{ id: "biz-1" }], error: null },
};
const calls: Array<{ table: string; row: Record<string, unknown>; column?: string; id?: string }> = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: Record<string, unknown>) => {
        const call: { table: string; row: Record<string, unknown>; column?: string; id?: string } = { table, row };
        calls.push(call);
        return {
          eq: (column: string, id: string) => {
            call.column = column;
            call.id = id;
            return { select: async () => state.result };
          },
        };
      },
    }),
  },
}));

import {
  buildOperatingProfileColumns,
  persistOperationSettings,
} from "../../src/infrastructure/supabase/operationSettingsRepository";
import type { OperationConfig } from "../../src/core/config/operation";

const CONFIG: OperationConfig = {
  serviceMode: "both", tablesEnabled: true, waiterModeEnabled: true, waiterPhotosEnabled: true,
  kitchenEnabled: true, kitchenOutputMode: "both", prepStations: [], salesChannels: ["presencial", "web"],
  inventoryType: "ambos", productionMode: "batch", kdsEnabled: true, printerEnabled: true,
};

beforeEach(() => {
  calls.length = 0;
  state.result = { data: [{ id: "biz-1" }], error: null };
});

describe("persistOperationSettings", () => {
  it("escribe módulos, operación y settings en UN solo update del negocio", async () => {
    await persistOperationSettings({
      businessId: "biz-1",
      modules: ["caja", "pedidos", "mesas"],
      config: CONFIG,
      settings: { autoPrintReceipt: true, enableAI: false },
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({ table: "businesses", column: "id", id: "biz-1" });
    expect(calls[0].row).toMatchObject({
      enabled_modules: ["caja", "pedidos", "mesas"],
      sales_channels: ["presencial", "web"],
      kds_enabled: true,
      printer_enabled: true,
      kitchen_output_mode: "both",
      salida_cocina: "ambos",
      inventory_type: "ambos",
      production_mode: "batch",
      waiter_mode_enabled: true,
      settings: { autoPrintReceipt: true, enableAI: false },
    });
  });

  it("0 filas actualizadas (RLS / plan vencido) NO cuenta como guardado", async () => {
    state.result = { data: [], error: null };
    await expect(
      persistOperationSettings({ businessId: "biz-1", modules: ["caja"], config: CONFIG, settings: {} }),
    ).rejects.toThrow(/Solo el administrador/);
  });

  it("propaga el error de la base con un mensaje legible", async () => {
    state.result = { data: null, error: { message: "permission denied for table businesses" } };
    await expect(
      persistOperationSettings({ businessId: "biz-1", modules: ["caja"], config: CONFIG, settings: {} }),
    ).rejects.toThrow("permission denied for table businesses");
  });

  it("detecta columnas sin migrar y avisa sin exponer SQL", async () => {
    state.result = { data: null, error: { message: 'column "kds_enabled" of relation "businesses" does not exist' } };
    await expect(
      persistOperationSettings({ businessId: "biz-1", modules: ["caja"], config: CONFIG, settings: {} }),
    ).rejects.toThrow(/Falta actualizar la base de datos/);
  });

  it("rechaza un negocio vacío sin llamar a la base", async () => {
    await expect(
      persistOperationSettings({ businessId: " ", modules: ["caja"], config: CONFIG, settings: {} }),
    ).rejects.toThrow(/negocio activo/);
    expect(calls).toHaveLength(0);
  });
});

describe("buildOperatingProfileColumns", () => {
  it("deriva service_mode y salida heredada cuando la configuración no los trae", () => {
    const columns = buildOperatingProfileColumns(["caja"], {
      salesChannels: [], inventoryType: null, productionMode: null, kdsEnabled: false, printerEnabled: false,
    });
    expect(columns).toMatchObject({
      service_mode: "counter", tables_enabled: false, waiter_mode_enabled: false, waiter_photos_enabled: true,
      kitchen_enabled: false, kitchen_output_mode: "none", salida_cocina: "pantalla", prep_stations: [],
    });
  });
});