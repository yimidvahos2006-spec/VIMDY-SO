import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  readCachedBusinessSettings,
  writeCachedBusinessSettings
} from "../../src/infrastructure/supabase/businessSettings";

class FakeStorage {
  private data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

describe("caché local de ajustes del negocio", () => {
  beforeEach(() => {
    (globalThis as { window?: unknown }).window = { localStorage: new FakeStorage() };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("guarda y vuelve a leer los ajustes de un negocio", () => {
    writeCachedBusinessSettings("neg-1", {
      nit: "900123456",
      whatsappOrders: "3001234567",
      dailySalesGoal: 500000,
      autoPrintReceipt: true
    });

    const cached = readCachedBusinessSettings("neg-1");
    expect(cached?.business.nit).toBe("900123456");
    expect(cached?.business.whatsappOrders).toBe("3001234567");
    expect(cached?.config.dailySalesGoal).toBe(500000);
    expect(cached?.config.autoPrintReceipt).toBe(true);
  });

  it("no mezcla ajustes entre negocios", () => {
    writeCachedBusinessSettings("neg-1", { nit: "111" });
    writeCachedBusinessSettings("neg-2", { nit: "222" });

    expect(readCachedBusinessSettings("neg-1")?.business.nit).toBe("111");
    expect(readCachedBusinessSettings("neg-2")?.business.nit).toBe("222");
    expect(readCachedBusinessSettings("neg-3")).toBeNull();
  });

  it("un caché dañado se ignora en vez de romper el inicio", () => {
    const storage = (globalThis as { window: { localStorage: FakeStorage } }).window.localStorage;
    storage.setItem("vimdy:cache:business-settings:v1:neg-1", "{esto no es json");
    expect(readCachedBusinessSettings("neg-1")).toBeNull();
  });

  it("sin navegador (window) no lanza y devuelve null", () => {
    delete (globalThis as { window?: unknown }).window;
    expect(() => writeCachedBusinessSettings("neg-1", { nit: "1" })).not.toThrow();
    expect(readCachedBusinessSettings("neg-1")).toBeNull();
  });
});