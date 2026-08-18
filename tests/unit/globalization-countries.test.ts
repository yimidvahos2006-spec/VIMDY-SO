import { describe, expect, it } from "vitest";

import {
  AVAILABLE_COUNTRY_CODES,
  AVAILABLE_COUNTRIES,
  getCountryDefaults,
  getCountryName,
  roundMoney
} from "../../src/core/config/globalization";

describe("Globalization — 10 países permitidos", () => {
  const ALLOWED = ["CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"];

  it("solo contiene los 10 países permitidos", () => {
    expect(AVAILABLE_COUNTRY_CODES).toHaveLength(10);
    expect(AVAILABLE_COUNTRY_CODES.sort()).toEqual(ALLOWED.sort());
  });

  it("no contiene países no permitidos como BR, UY, etc.", () => {
    const forbidden = ["BR", "UY", "CA", "GB", "DE", "FR", "IT", "PT", "CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"];
    // CO, MX, PE, CL, AR, ES, EC, PA, US, VE are allowed, so we check that no OTHER countries are present
    const unexpected = AVAILABLE_COUNTRY_CODES.filter((c) => !ALLOWED.includes(c));
    expect(unexpected).toHaveLength(0);
  });

  it("cada país tiene defaults completos", () => {
    for (const code of ALLOWED) {
      const defaults = getCountryDefaults(code);
      expect(defaults, `Faltan defaults para ${code}`).not.toBeNull();
      expect(defaults!.currency).toBeTruthy();
      expect(defaults!.language).toBeTruthy();
      expect(defaults!.timezone).toBeTruthy();
      expect(defaults!.taxRate).toBeGreaterThanOrEqual(0);
    }
  });

  it("Colombia tiene COP, español, Bogotá, 19%", () => {
    const d = getCountryDefaults("CO");
    expect(d!.currency).toBe("COP");
    expect(d!.language).toBe("es");
    expect(d!.timezone).toBe("America/Bogota");
    expect(d!.taxRate).toBe(19);
  });

  it("Estados Unidos tiene USD, inglés, NY, 0%", () => {
    const d = getCountryDefaults("US");
    expect(d!.currency).toBe("USD");
    expect(d!.language).toBe("en");
    expect(d!.timezone).toBe("America/New_York");
    expect(d!.taxRate).toBe(0);
  });

  it("Venezuela tiene USD, español, Caracas, 0%", () => {
    const d = getCountryDefaults("VE");
    expect(d!.currency).toBe("USD");
    expect(d!.language).toBe("es");
    expect(d!.timezone).toBe("America/Caracas");
    expect(d!.taxRate).toBe(0);
  });

  it("España tiene EUR, español, Madrid, 21%", () => {
    const d = getCountryDefaults("ES");
    expect(d!.currency).toBe("EUR");
    expect(d!.language).toBe("es");
    expect(d!.timezone).toBe("Europe/Madrid");
    expect(d!.taxRate).toBe(21);
  });

  it("getCountryName devuelve el nombre localizado", () => {
    expect(getCountryName("CO", "es")).toBe("Colombia");
    expect(getCountryName("US", "en")).toBe("United States");
    expect(getCountryName("ES", "es")).toBe("España");
  });

  it("roundMoney respeta decimales de moneda", () => {
    expect(roundMoney(79000, "COP")).toBe(79000);
    expect(roundMoney(79000.4, "COP")).toBe(79000);
    expect(roundMoney(79000.5, "COP")).toBe(79001);
    expect(roundMoney(89.99, "USD")).toBe(89.99);
    expect(roundMoney(89.995, "USD")).toBe(90);
  });
});
