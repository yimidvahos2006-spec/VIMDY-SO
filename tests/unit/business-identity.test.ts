import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildBusinessIdentity,
  computeNitVerifier,
  getOnboardingCurrencyOptions,
  isPlaceholderBusinessName,
  normalizeBusinessName,
  normalizeTaxId,
  sanitizeTaxIdTyping,
  validateBusinessIdentity,
  validateBusinessName,
  validateTaxId
} from "../../src/core/config/businessIdentity";

/* ---------------------------------------------------------------------------
   Doble de Supabase: registra qué se lee y qué se escribe en `businesses`.
--------------------------------------------------------------------------- */
interface UpdateResult {
  data: Array<{ id: string }> | null;
  error: { message: string } | null;
}

const fake = vi.hoisted(() => ({
  remoteSettings: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  updateImpl: null as null | ((payload: Record<string, unknown>) => Promise<UpdateResult>),
  currentBusinessId: "biz-1" as string | undefined
}));

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  getCurrentBusinessId: () => fake.currentBusinessId,
  supabase: {
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({ data: { settings: fake.remoteSettings }, error: null })
        })
      }),
      update: (payload: Record<string, unknown>) => ({
        eq: () => ({
          select: async () => {
            fake.updates.push(payload);
            if (fake.updateImpl) return fake.updateImpl(payload);
            return { data: [{ id: "biz-1" }], error: null };
          }
        })
      })
    })
  }
}));

vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logWarning: vi.fn(),
  logError: vi.fn()
}));

import {
  hasPendingBusinessIdentity,
  saveBusinessIdentity,
  syncPendingBusinessIdentity
} from "../../src/infrastructure/supabase/businessIdentity";
import { businessStore } from "../../src/core/store/businessStore";
import { companyConfigStore } from "../../src/core/store/companyConfigStore";
import { readCachedBusinessSettings } from "../../src/infrastructure/supabase/businessSettings";

const VALID = {
  name: "Asados Doña Inés",
  taxId: "900.156.264-2",
  currency: "COP",
  city: "Medellín"
};

/** Deja pasar las promesas pendientes (subida en segundo plano). */
async function flush(times = 8) {
  for (let i = 0; i < times; i++) await Promise.resolve();
}

describe("validación de identidad del negocio", () => {
  it("el dígito de verificación coincide con NITs reales conocidos", () => {
    expect(computeNitVerifier("800197268")).toBe(4); // DIAN
    expect(computeNitVerifier("890903938")).toBe(8); // Bancolombia
    expect(computeNitVerifier("900156264")).toBe(2);
  });

  it("exige nombre y NIT/cédula", () => {
    expect(validateBusinessName("")).toMatch(/Escribe el nombre/);
    expect(validateBusinessName("   ")).toMatch(/Escribe el nombre/);
    expect(validateBusinessName("A")).toMatch(/muy corto/);
    expect(validateBusinessName("!!!")).toMatch(/letras o números/);
    expect(validateBusinessName("Bar El Túnel")).toBeNull();
    expect(validateBusinessName("7 Sabores")).toBeNull();

    expect(validateTaxId("")).toMatch(/Escribe el NIT/);
    expect(validateTaxId("  ")).toMatch(/Escribe el NIT/);
  });

  it("acepta cédula y NIT con o sin puntos, espacios y dígito de verificación", () => {
    expect(validateTaxId("1.037.123.456")).toBeNull(); // cédula
    expect(validateTaxId("43123456")).toBeNull();
    expect(validateTaxId("900156264")).toBeNull(); // NIT sin DV
    expect(validateTaxId("900.156.264-2")).toBeNull();
    expect(validateTaxId("900 156 264 - 2")).toBeNull();
    expect(validateTaxId("800197268-4")).toBeNull();
  });

  it("rechaza NIT con dígito de verificación equivocado o incompleto", () => {
    expect(validateTaxId("900.156.264-3")).toMatch(/no coincide/);
    expect(validateTaxId("900156264-")).toMatch(/Falta el dígito/);
  });

  it("rechaza números imposibles", () => {
    expect(validateTaxId("1234")).toMatch(/muy corto/);
    expect(validateTaxId("1234567890123")).toMatch(/muy largo/);
    expect(validateTaxId("00000000")).toMatch(/no es válido/);
    expect(validateTaxId("abc")).toMatch(/Escribe el NIT/); // sin dígitos queda vacío
  });

  it("normaliza lo que escribe el usuario", () => {
    expect(normalizeTaxId("900.156.264 - 2")).toBe("900156264-2");
    expect(normalizeTaxId("NIT 900156264")).toBe("900156264");
    expect(sanitizeTaxIdTyping("90a0.156/264-2")).toBe("900.156264-2");
    expect(normalizeBusinessName("  Asados   Doña  Inés ")).toBe("Asados Doña Inés");
  });

  it("valida el conjunto y exige una moneda de la lista", () => {
    expect(validateBusinessIdentity(VALID)).toEqual({});
    expect(Object.keys(validateBusinessIdentity({ ...VALID, name: "", taxId: "" })).sort()).toEqual([
      "name",
      "taxId"
    ]);
    expect(validateBusinessIdentity({ ...VALID, currency: "XXX" }).currency).toMatch(/moneda/);
    // La ciudad es opcional.
    expect(validateBusinessIdentity({ ...VALID, city: "" })).toEqual({});
  });

  it("buildBusinessIdentity devuelve datos limpios o lanza en español", () => {
    expect(buildBusinessIdentity({ ...VALID, name: "  Bar  El Túnel ", city: " Cali " })).toEqual({
      name: "Bar El Túnel",
      taxId: "900156264-2",
      currency: "COP",
      city: "Cali"
    });
    expect(() => buildBusinessIdentity({ ...VALID, name: "" })).toThrow(/Escribe el nombre/);
    expect(() => buildBusinessIdentity({ ...VALID, taxId: "" })).toThrow(/Escribe el NIT/);
  });

  it("la moneda por defecto es COP y va primera en la lista", () => {
    const options = getOnboardingCurrencyOptions();
    expect(options[0]?.code).toBe("COP");
    expect(options[0]?.label).toContain("$");
    expect(new Set(options.map((o) => o.code)).size).toBe(options.length);
  });

  it("reconoce el nombre de relleno de la app", () => {
    expect(isPlaceholderBusinessName("VIMDY Demo")).toBe(true);
    expect(isPlaceholderBusinessName("Asados Doña Inés")).toBe(false);
  });
});

describe("guardado local-first de la identidad", () => {
  let storage = new Map<string, string>();

  beforeEach(() => {
    vi.useFakeTimers();
    storage = new Map();
    vi.stubGlobal("window", {
      localStorage: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => void storage.set(key, value),
        removeItem: (key: string) => void storage.delete(key)
      },
      addEventListener: vi.fn()
    });
    fake.remoteSettings = {};
    fake.updates = [];
    fake.updateImpl = null;
    fake.currentBusinessId = "biz-1";
    businessStore.clear();
    companyConfigStore.reset();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("deja los datos disponibles al instante, antes de que responda la red", async () => {
    let release!: (value: UpdateResult) => void;
    fake.updateImpl = () => new Promise<UpdateResult>((resolve) => (release = resolve));

    saveBusinessIdentity("biz-1", VALID);

    // La red todavía no respondió y los datos ya están en toda la app.
    expect(businessStore.get()).toMatchObject({
      name: "Asados Doña Inés",
      nit: "900156264-2",
      city: "Medellín",
      currency: "COP"
    });
    expect(companyConfigStore.get().currency).toBe("COP");
    expect(readCachedBusinessSettings("biz-1")?.business).toMatchObject({
      nit: "900156264-2",
      city: "Medellín"
    });
    expect(hasPendingBusinessIdentity("biz-1")).toBe(true);

    await flush();
    release({ data: [{ id: "biz-1" }], error: null });
    await flush();

    expect(hasPendingBusinessIdentity("biz-1")).toBe(false);
  });

  it("sube nombre y moneda a sus columnas y hace MERGE de NIT y ciudad sin borrar otros ajustes", async () => {
    fake.remoteSettings = { whatsappOrders: "3001234567", dailySalesGoal: 500000, nit: "viejo" };

    saveBusinessIdentity("biz-1", { ...VALID, currency: "USD" });
    await flush();

    expect(fake.updates).toHaveLength(1);
    expect(fake.updates[0]).toEqual({
      name: "Asados Doña Inés",
      currency: "USD",
      settings: {
        whatsappOrders: "3001234567",
        dailySalesGoal: 500000,
        nit: "900156264-2",
        city: "Medellín"
      }
    });
    expect(companyConfigStore.get().currency).toBe("USD");
  });

  it("si no hay internet, conserva el pendiente y reintenta solo hasta lograrlo", async () => {
    let online = false;
    fake.updateImpl = async () =>
      online
        ? { data: [{ id: "biz-1" }], error: null }
        : { data: null, error: { message: "Failed to fetch" } };

    saveBusinessIdentity("biz-1", VALID);
    await flush();

    // Sin internet: los datos locales siguen ahí y queda pendiente.
    expect(businessStore.get().name).toBe("Asados Doña Inés");
    expect(hasPendingBusinessIdentity("biz-1")).toBe(true);

    online = true;
    await vi.advanceTimersByTimeAsync(2_000);
    await flush();

    expect(hasPendingBusinessIdentity("biz-1")).toBe(false);
    expect(fake.updates.length).toBeGreaterThanOrEqual(2);
  });

  it("un pendiente guardado antes de recargar se sube al volver a llamar la sincronización", async () => {
    fake.updateImpl = async () => ({ data: null, error: { message: "offline" } });
    saveBusinessIdentity("biz-1", VALID);
    await flush();
    expect(hasPendingBusinessIdentity("biz-1")).toBe(true);

    // Simula otra visita: sigue pendiente en localStorage y ahora hay red.
    fake.updateImpl = null;
    fake.updates = [];
    await expect(syncPendingBusinessIdentity("biz-1")).resolves.toBe("synced");
    expect(fake.updates).toHaveLength(1);
    expect(hasPendingBusinessIdentity("biz-1")).toBe(false);
  });

  it("0 filas actualizadas (sin permiso o plan vencido) NO cuenta como guardado", async () => {
    fake.updateImpl = async () => ({ data: [], error: null });

    saveBusinessIdentity("biz-1", VALID);
    await flush();

    expect(hasPendingBusinessIdentity("biz-1")).toBe(true);
  });

  it("si el usuario vuelve a guardar mientras se sube, la versión nueva también llega a Supabase", async () => {
    let releaseFirst!: (value: UpdateResult) => void;
    let calls = 0;
    fake.updateImpl = () => {
      calls += 1;
      if (calls === 1) return new Promise<UpdateResult>((resolve) => (releaseFirst = resolve));
      return Promise.resolve({ data: [{ id: "biz-1" }], error: null });
    };

    saveBusinessIdentity("biz-1", VALID);
    await flush();
    saveBusinessIdentity("biz-1", { ...VALID, name: "Asados Doña Inés Sede 2", city: "Bogotá" });

    releaseFirst({ data: [{ id: "biz-1" }], error: null });
    await flush(20);

    expect(fake.updates).toHaveLength(2);
    expect(fake.updates[1]).toMatchObject({
      name: "Asados Doña Inés Sede 2",
      settings: { city: "Bogotá" }
    });
    expect(hasPendingBusinessIdentity("biz-1")).toBe(false);
    expect(businessStore.get().name).toBe("Asados Doña Inés Sede 2");
  });

  it("con datos inválidos lanza en español y no toca nada", () => {
    businessStore.update({ name: "Antes" });

    expect(() => saveBusinessIdentity("biz-1", { ...VALID, taxId: "" })).toThrow(/Escribe el NIT/);
    expect(() => saveBusinessIdentity("", VALID)).toThrow(/negocio activo/);

    expect(businessStore.get().name).toBe("Antes");
    expect(hasPendingBusinessIdentity("biz-1")).toBe(false);
    expect(fake.updates).toHaveLength(0);
  });

  it("no mezcla pendientes de negocios distintos", async () => {
    fake.updateImpl = async () => ({ data: null, error: { message: "offline" } });
    saveBusinessIdentity("biz-1", VALID);
    await flush();

    expect(hasPendingBusinessIdentity("biz-1")).toBe(true);
    expect(hasPendingBusinessIdentity("biz-2")).toBe(false);
    await expect(syncPendingBusinessIdentity("biz-2")).resolves.toBe("nothing");
  });
});