import { describe, it, expect, vi, beforeEach } from "vitest";

const state: { result: any } = { result: { data: [{ id: "b1" }], error: null } };
const calls: any[] = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    from: (table: string) => ({
      update: (row: any) => {
        calls.push({ table, row });
        return {
          eq: (_c: string, id: string) => {
            calls[calls.length - 1].id = id;
            return { select: async () => state.result };
          }
        };
      },
      select: () => ({
        eq: () => ({ maybeSingle: async () => state.result })
      })
    })
  }
}));

import {
  buildBusinessSettingsUpdate,
  readBusinessSettings,
  saveBusinessSettings,
  fetchBusinessSettings
} from "../../src/infrastructure/supabase/businessSettings";

const business: any = {
  name: "  Café Yimid ", nit: "900.123", owner: "Yimid", phone: "3001112233",
  email: "a@b.co", address: "Cra 1", city: "La Unión", country: "CO",
  currency: "COP", whatsappOrders: "573001112233"
};
const config: any = {
  country: "CO", currency: "COP", tax: 8, serviceCharge: 0, language: "es",
  timezone: "America/Bogota", allowNegativeStock: true, autoPrintReceipt: false,
  enableAI: false, dailySalesGoal: 500000,
  electronicInvoicing: { enabled: false, provider: "dian" }
};

beforeEach(() => {
  calls.length = 0;
  state.result = { data: [{ id: "b1" }], error: null };
});

describe("ajustes del negocio en la base de datos", () => {
  it("arma la fila: columnas propias + settings", () => {
    const row = buildBusinessSettingsUpdate(business, config);
    expect(row.name).toBe("Café Yimid");
    expect(row.tax_rate).toBe(8);
    expect(row.timezone).toBe("America/Bogota");
    expect(row.settings.whatsappOrders).toBe("573001112233");
    expect(row.settings.allowNegativeStock).toBe(true);
    expect(row.settings.autoPrintReceipt).toBe(false);
    expect(row.settings.dailySalesGoal).toBe(500000);
    // si la facturación está apagada, el proveedor se guarda como "none"
    expect(row.settings.electronicInvoicing).toEqual({ enabled: false, provider: "none" });
  });

  it("rechaza nombre vacío e IVA inválido", () => {
    expect(() => buildBusinessSettingsUpdate({ ...business, name: "  " }, config)).toThrow(/nombre/i);
    expect(() => buildBusinessSettingsUpdate(business, { ...config, tax: NaN })).toThrow(/IVA/);
  });

  it("limita IVA y meta a rangos válidos", () => {
    const row = buildBusinessSettingsUpdate(business, { ...config, tax: 500, dailySalesGoal: -5 });
    expect(row.tax_rate).toBe(100);
    expect(row.settings.dailySalesGoal).toBe(0);
  });

  it("guardar y leer devuelve lo mismo", () => {
    const row = buildBusinessSettingsUpdate(business, config);
    const back = readBusinessSettings(row.settings);
    expect(back.business.nit).toBe("900.123");
    expect(back.business.city).toBe("La Unión");
    expect(back.config.allowNegativeStock).toBe(true);
    expect(back.config.dailySalesGoal).toBe(500000);
  });

  it("leer algo vacío o dañado no pisa los valores actuales", () => {
    expect(readBusinessSettings({})).toEqual({ business: {}, config: {} });
    expect(readBusinessSettings(null)).toEqual({ business: {}, config: {} });
    expect(readBusinessSettings({ enableAI: "si", dailySalesGoal: "x" })).toEqual({ business: {}, config: {} });
  });

  it("guarda con update sobre el negocio correcto", async () => {
    await saveBusinessSettings("b1", business, config);
    expect(calls[0].table).toBe("businesses");
    expect(calls[0].id).toBe("b1");
    expect(calls[0].row.tax_rate).toBe(8);
  });

  it("0 filas actualizadas (no es admin / plan vencido) es un error, no 'guardado'", async () => {
    state.result = { data: [], error: null };
    await expect(saveBusinessSettings("b1", business, config)).rejects.toThrow(/administrador/i);
  });

  it("error de columna faltante da un mensaje claro", async () => {
    state.result = { data: null, error: { message: 'column "settings" of relation "businesses" does not exist' } };
    await expect(saveBusinessSettings("b1", business, config)).rejects.toThrow(/base de datos/i);
  });

  it("fetch devuelve null si falla (no rompe el login)", async () => {
    state.result = { data: null, error: { message: "boom" } };
    expect(await fetchBusinessSettings("b1")).toBeNull();
    state.result = { data: { settings: { nit: "1" } }, error: null };
    expect((await fetchBusinessSettings("b1"))?.business.nit).toBe("1");
  });
});