import { describe, expect, it } from "vitest";
import { parseMoneyInput } from "../../src/core/utils/parseMoneyInput";

describe("parseMoneyInput", () => {
  it("lee precios colombianos con punto de miles", () => {
    expect(parseMoneyInput("3.500")).toBe(3500);
    expect(parseMoneyInput("15.000")).toBe(15000);
    expect(parseMoneyInput("1.250.000")).toBe(1250000);
    expect(parseMoneyInput("$ 3.500")).toBe(3500);
  });

  it("lee comas de miles", () => {
    expect(parseMoneyInput("3,500")).toBe(3500);
    expect(parseMoneyInput("1,250,000")).toBe(1250000);
  });

  it("lee números sin separador", () => {
    expect(parseMoneyInput("3500")).toBe(3500);
    expect(parseMoneyInput("0")).toBe(0);
  });

  it("lee decimales", () => {
    expect(parseMoneyInput("3.5")).toBe(3.5);
    expect(parseMoneyInput("3,5")).toBe(3.5);
    expect(parseMoneyInput("12.75")).toBe(12.75);
    expect(parseMoneyInput("0.500")).toBe(0.5);
    expect(parseMoneyInput("3.500,50")).toBe(3500.5);
    expect(parseMoneyInput("3,500.50")).toBe(3500.5);
  });

  it("rechaza texto que no es un número", () => {
    expect(parseMoneyInput("")).toBeNaN();
    expect(parseMoneyInput("abc")).toBeNaN();
    expect(parseMoneyInput("3..5")).toBeNaN();
    expect(parseMoneyInput(undefined)).toBeNaN();
  });
});