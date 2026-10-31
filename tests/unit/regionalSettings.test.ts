import { describe, it, expect } from "vitest";
import {
  buildCountryChangePatch,
  differsFromCountryDefaults,
  getTimezoneOptions,
  isValidTimeZone,
  localeForLanguage
} from "../../src/core/settings/regionalSettings";
import {
  AVAILABLE_COUNTRY_CODES,
  CURRENCIES,
  LANGUAGES,
  TIMEZONES
} from "../../src/core/config/globalization";

describe("país → moneda, idioma y zona horaria", () => {
  it("México autocompleta MXN, español, America/Mexico_City y su IVA", () => {
    expect(buildCountryChangePatch("MX")).toEqual({
      country: "MX",
      currency: "MXN",
      language: "es",
      timezone: "America/Mexico_City",
      tax: 16,
      electronicInvoicing: { enabled: false, provider: "none" }
    });
  });

  it("Colombia autocompleta COP, español, America/Bogota, IVA 19 y no toca la facturación DIAN", () => {
    const patch = buildCountryChangePatch("CO");
    expect(patch).toMatchObject({
      country: "CO",
      currency: "COP",
      language: "es",
      timezone: "America/Bogota",
      tax: 19
    });
    expect(patch).not.toHaveProperty("electronicInvoicing");
  });

  it("Estados Unidos cambia a inglés y USD pero NO borra el IVA del dueño (su tasa no está verificada)", () => {
    const patch = buildCountryChangePatch("US");
    expect(patch).toMatchObject({ country: "US", currency: "USD", language: "en" });
    expect(patch).not.toHaveProperty("tax");
  });

  it("un país fuera de los disponibles o un código inválido no cambia nada", () => {
    expect(buildCountryChangePatch("FR")).toBeNull();
    expect(buildCountryChangePatch("ZZ")).toBeNull();
    expect(buildCountryChangePatch("")).toBeNull();
  });

  it("todos los países disponibles producen valores que la app sabe guardar", () => {
    for (const code of AVAILABLE_COUNTRY_CODES) {
      const patch = buildCountryChangePatch(code);
      expect(patch, code).not.toBeNull();
      if (!patch) continue;
      expect(CURRENCIES.some((c) => c.code === patch.currency), `${code} moneda`).toBe(true);
      expect(LANGUAGES.some((l) => l.code === patch.language), `${code} idioma`).toBe(true);
      expect(TIMEZONES, `${code} zona`).toContain(patch.timezone);
      expect(isValidTimeZone(patch.timezone), `${code} zona válida`).toBe(true);
    }
  });
});

describe("ajustes manuales", () => {
  it("detecta cuando el dueño se apartó de lo sugerido para su país", () => {
    const base = { country: "CO", currency: "COP", language: "es", timezone: "America/Bogota" } as const;
    expect(differsFromCountryDefaults(base)).toBe(false);
    expect(differsFromCountryDefaults({ ...base, currency: "USD" })).toBe(true);
    expect(differsFromCountryDefaults({ ...base, language: "en" })).toBe(true);
    expect(differsFromCountryDefaults({ ...base, timezone: "America/Lima" })).toBe(true);
  });

  it("el desplegable de zonas incluye la zona actual aunque no esté en el catálogo", () => {
    expect(getTimezoneOptions("America/Bogota")).toEqual(TIMEZONES);
    const options = getTimezoneOptions("Pacific/Galapagos");
    expect(options).toContain("Pacific/Galapagos");
    expect(options).toContain("America/Bogota");
    expect(getTimezoneOptions("")).toEqual(TIMEZONES);
  });

  it("valida zonas horarias reales y rechaza las inventadas", () => {
    expect(isValidTimeZone("America/Bogota")).toBe(true);
    expect(isValidTimeZone("UTC")).toBe(true);
    expect(isValidTimeZone("Mundo/Inexistente")).toBe(false);
    expect(isValidTimeZone("")).toBe(false);
    expect(isValidTimeZone("   ")).toBe(false);
  });

  it("asigna la configuración regional según el idioma", () => {
    expect(localeForLanguage("es")).toBe("es-CO");
    expect(localeForLanguage("en")).toBe("en-US");
    expect(localeForLanguage("pt")).toBe("pt-BR");
  });
});