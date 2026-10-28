import { describe, expect, it } from "vitest";
import {
  allowsDecimals,
  MAX_RESTOCK_UNITS,
  parseRestockQuantity,
  sanitizeQuantityInput
} from "./restockValidation";

describe("sanitizeQuantityInput", () => {
  it("quita letras, signos y notación científica", () => {
    expect(sanitizeQuantityInput("-5e3abc", true)).toBe("53");
  });
  it("unidad → solo enteros", () => {
    expect(sanitizeQuantityInput("12,5", false)).toBe("125");
  });
  it("decimales → un separador, máx. 3 decimales, coma normalizada", () => {
    expect(sanitizeQuantityInput("1.2.3,4567", true)).toBe("1,234");
  });
});

describe("parseRestockQuantity", () => {
  it("vacío", () => expect(parseRestockQuantity("", 5)).toEqual({ status: "empty" }));
  it("cero e inválidos", () => {
    expect(parseRestockQuantity("0", 5).status).toBe("invalid");
    expect(parseRestockQuantity("0,000", 5).status).toBe("invalid");
  });
  it("coma decimal", () =>
    expect(parseRestockQuantity("2,5", 10)).toEqual({ status: "valid", quantity: 2.5, unusuallyLarge: false }));
  it("tope duro", () =>
    expect(parseRestockQuantity(String(MAX_RESTOCK_UNITS + 1), 0).status).toBe("invalid"));
  it("inusual: > max(100, 10× stock)", () => {
    expect(parseRestockQuantity("101", 5)).toMatchObject({ unusuallyLarge: true });
    expect(parseRestockQuantity("100", 5)).toMatchObject({ unusuallyLarge: false });
    expect(parseRestockQuantity("500", 100)).toMatchObject({ unusuallyLarge: false });
  });
  it("sin stock real (enmascarado) nunca marca inusual", () =>
    expect(parseRestockQuantity("99999", null)).toMatchObject({ unusuallyLarge: false }));
});

describe("allowsDecimals", () => {
  it("unidad no, kg sí", () => {
    expect(allowsDecimals("unidad")).toBe(false);
    expect(allowsDecimals(undefined)).toBe(false);
    expect(allowsDecimals("kg")).toBe(true);
  });
});