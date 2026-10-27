import { describe, it, expect } from "vitest";
import { computePackUnitCost, isPackUnit, parsePackUnits } from "../../src/core/utils/packageCost";

describe("packageCost", () => {
  it("40 tajadas a $16.000 -> $400 cada una", () => {
    expect(computePackUnitCost("40", "16.000")?.unitCost).toBe(400);
  });

  it("acepta números y formatos colombianos", () => {
    expect(computePackUnitCost(40, 16000)?.unitCost).toBe(400);
    expect(computePackUnitCost("12", "$ 9.600")?.unitCost).toBe(800);
  });

  it("no pierde exactitud cuando la división no es exacta", () => {
    expect(computePackUnitCost("3", "16.000")?.unitCost).toBe(5333.3333);
  });

  it("devuelve null si falta o es inválido algún dato", () => {
    expect(computePackUnitCost("", "16.000")).toBeNull();
    expect(computePackUnitCost("40", "")).toBeNull();
    expect(computePackUnitCost("0", "16.000")).toBeNull();
    expect(computePackUnitCost("40", "0")).toBeNull();
    expect(computePackUnitCost("-5", "16.000")).toBeNull();
    expect(computePackUnitCost("abc", "16.000")).toBeNull();
  });

  it("isPackUnit reconoce paquete y caja", () => {
    expect(isPackUnit("paquete")).toBe(true);
    expect(isPackUnit("Caja")).toBe(true);
    expect(isPackUnit("kg")).toBe(false);
    expect(isPackUnit(undefined)).toBe(false);
  });

  it("parsePackUnits", () => {
    expect(parsePackUnits("40")).toBe(40);
    expect(parsePackUnits("40,5")).toBe(40.5);
    expect(Number.isNaN(parsePackUnits("x"))).toBe(true);
  });
});