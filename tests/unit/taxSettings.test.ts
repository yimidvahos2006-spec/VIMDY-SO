import { describe, it, expect } from "vitest";
import {
  MAX_DAILY_GOAL,
  formatDailyGoal,
  formatTaxPercent,
  parseDailyGoalInput,
  parseTaxPercentInput
} from "../../src/core/settings/taxSettings";

describe("IVA (%) — lectura del texto escrito", () => {
  it("acepta enteros y decimales con coma o punto", () => {
    expect(parseTaxPercentInput("19")).toBe(19);
    expect(parseTaxPercentInput("0")).toBe(0);
    expect(parseTaxPercentInput("100")).toBe(100);
    expect(parseTaxPercentInput("8,5")).toBe(8.5);
    expect(parseTaxPercentInput("8.5")).toBe(8.5);
    expect(parseTaxPercentInput(" 16 ")).toBe(16);
  });

  it("acepta el estado intermedio mientras se escribe ('8.' o '8,')", () => {
    expect(parseTaxPercentInput("8.")).toBe(8);
    expect(parseTaxPercentInput("8,")).toBe(8);
  });

  it("rechaza vacío, letras, negativos, más de 100 y más de 2 decimales", () => {
    expect(parseTaxPercentInput("")).toBeNull();
    expect(parseTaxPercentInput("   ")).toBeNull();
    expect(parseTaxPercentInput("abc")).toBeNull();
    expect(parseTaxPercentInput("-1")).toBeNull();
    expect(parseTaxPercentInput("101")).toBeNull();
    expect(parseTaxPercentInput("1.234")).toBeNull();
    expect(parseTaxPercentInput("1e2")).toBeNull();
    expect(parseTaxPercentInput("19%")).toBeNull();
  });

  it("muestra el valor guardado sin ceros de más", () => {
    expect(formatTaxPercent(19)).toBe("19");
    expect(formatTaxPercent(8.5)).toBe("8.5");
    expect(formatTaxPercent(Number.NaN)).toBe("0");
  });
});

describe("Meta de ventas diaria — lectura del texto escrito", () => {
  it("lee enteros con o sin separador de miles", () => {
    expect(parseDailyGoalInput("500000")).toBe(500000);
    expect(parseDailyGoalInput("500.000")).toBe(500000);
    expect(parseDailyGoalInput("1.500.000")).toBe(1500000);
    expect(parseDailyGoalInput("1,500,000")).toBe(1500000);
    expect(parseDailyGoalInput("500 000")).toBe(500000);
  });

  it("vacío significa 'sin meta' (0)", () => {
    expect(parseDailyGoalInput("")).toBe(0);
    expect(parseDailyGoalInput("   ")).toBe(0);
    expect(parseDailyGoalInput("0")).toBe(0);
  });

  it("rechaza decimales en vez de multiplicar la meta por 100", () => {
    expect(parseDailyGoalInput("1500.50")).toBeNull();
    expect(parseDailyGoalInput("1500,5")).toBeNull();
  });

  it("rechaza letras, signos y cifras fuera de rango", () => {
    expect(parseDailyGoalInput("abc")).toBeNull();
    expect(parseDailyGoalInput("-500")).toBeNull();
    expect(parseDailyGoalInput("$500.000")).toBeNull();
    expect(parseDailyGoalInput("1".repeat(13))).toBeNull();
    expect(parseDailyGoalInput(String(MAX_DAILY_GOAL + 1))).toBeNull();
    expect(parseDailyGoalInput(String(MAX_DAILY_GOAL))).toBe(MAX_DAILY_GOAL);
  });

  it("da formato de miles según el idioma y deja vacía la meta 0", () => {
    expect(formatDailyGoal(500000, "es")).toBe("500.000");
    expect(formatDailyGoal(500000, "en")).toBe("500,000");
    expect(formatDailyGoal(0, "es")).toBe("");
    expect(formatDailyGoal(-5, "es")).toBe("");
    expect(formatDailyGoal(Number.NaN, "es")).toBe("");
  });

  it("lo que se muestra se vuelve a leer igual (sin perder la cifra)", () => {
    for (const value of [10000, 250000, 500000, 12345678]) {
      expect(parseDailyGoalInput(formatDailyGoal(value, "es"))).toBe(value);
      expect(parseDailyGoalInput(formatDailyGoal(value, "en"))).toBe(value);
    }
  });
});