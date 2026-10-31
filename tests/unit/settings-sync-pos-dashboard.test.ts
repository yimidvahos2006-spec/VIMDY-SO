import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {},
  getCurrentBusinessId: () => "b1",
  getCurrentBranchId: () => "branch-1",
  setCurrentBusinessId: () => undefined,
  setCurrentBranchId: () => undefined
}));

import { companyConfigStore } from "../../src/core/store/companyConfigStore";
import { SalesEngine } from "../../src/core/engines/SalesEngine";
import {
  buildBusinessSettingsUpdate,
  readBusinessSettings
} from "../../src/infrastructure/supabase/businessSettings";
import { buildCountryChangePatch } from "../../src/core/settings/regionalSettings";

const business: any = {
  name: "Café Yimid",
  nit: "900.123",
  owner: "Yimid",
  phone: "3001112233",
  email: "a@b.co",
  address: "Cra 1",
  city: "La Unión",
  country: "CO",
  currency: "COP",
  whatsappOrders: ""
};

describe("Configuración → POS y Dashboard (misma fuente en vivo)", () => {
  beforeEach(() => {
    companyConfigStore.reset();
  });

  it("el carrito del POS usa el IVA recién guardado aunque el motor se haya creado con otro", () => {
    // Motor creado "con el IVA viejo" (19 %), como pasa al arrancar la app.
    const engine = Object.create(SalesEngine.prototype) as SalesEngine;
    Object.defineProperty(engine, "config", { value: { defaultTaxRate: 0.19 } });

    companyConfigStore.update({ tax: 8, currency: "COP" });
    expect(engine.calculateTax(10000)).toBe(800);

    companyConfigStore.update({ tax: 0 });
    expect(engine.calculateTax(10000)).toBe(0);
  });

  it("un IVA explícito (producto con IVA propio) sigue mandando sobre el de Configuración", () => {
    const engine = Object.create(SalesEngine.prototype) as SalesEngine;
    Object.defineProperty(engine, "config", { value: { defaultTaxRate: 0.19 } });
    companyConfigStore.update({ tax: 8, currency: "COP" });
    expect(engine.calculateTax(10000, 0.05)).toBe(500);
  });

  it("IVA y meta diaria guardados se leen al iniciar sesión y quedan en el store que usan POS y Dashboard", () => {
    const edited = { ...companyConfigStore.get(), tax: 8.5, dailySalesGoal: 750000 };

    const row = buildBusinessSettingsUpdate(business, edited);
    expect(row.tax_rate).toBe(8.5);
    expect(row.settings.dailySalesGoal).toBe(750000);

    // Dispositivo "nuevo": el store vuelve a sus valores por defecto y se hidrata con lo guardado.
    companyConfigStore.reset();
    companyConfigStore.update({ tax: row.tax_rate });
    companyConfigStore.update(readBusinessSettings(row.settings).config);

    expect(companyConfigStore.get().tax).toBe(8.5);
    expect(companyConfigStore.get().dailySalesGoal).toBe(750000);
  });

  it("cambiar de país y guardar escribe moneda, idioma, zona horaria e IVA del país", () => {
    const patch = buildCountryChangePatch("MX");
    expect(patch).not.toBeNull();
    const edited = { ...companyConfigStore.get(), ...patch };

    const row = buildBusinessSettingsUpdate({ ...business, country: "MX" }, edited);
    expect(row).toMatchObject({
      country: "MX",
      currency: "MXN",
      language: "es",
      timezone: "America/Mexico_City",
      tax_rate: 16
    });
  });

  it("un ajuste manual posterior al país se conserva al guardar", () => {
    const patch = buildCountryChangePatch("CO");
    const edited = { ...companyConfigStore.get(), ...patch, currency: "USD" as const, language: "en" as const };
    const row = buildBusinessSettingsUpdate(business, edited);
    expect(row.country).toBe("CO");
    expect(row.currency).toBe("USD");
    expect(row.language).toBe("en");
    expect(row.timezone).toBe("America/Bogota");
  });
});