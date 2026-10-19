import { describe, it, expect } from "vitest";
import { splitBillEvenly } from "../../src/core/utils/splitBill";

describe("dividir cuenta", () => {
  it("reparte justo cuando se puede", () => {
    const split = splitBillEvenly(90000, 3);
    expect(split.shares).toEqual([30000, 30000, 30000]);
    expect(split.even).toBe(true);
  });

  it("reparte el resto en pesos enteros y siempre suma el total", () => {
    const split = splitBillEvenly(100, 3);
    expect(split.shares).toEqual([34, 33, 33]);
    expect(split.shares.reduce((a, b) => a + b, 0)).toBe(100);
    expect(split).toMatchObject({ low: 33, high: 34, highCount: 1, even: false });
  });

  it("nunca pierde pesos, con cualquier combinación", () => {
    for (const total of [1, 7, 999, 34000, 123457, 1000001]) {
      for (let people = 1; people <= 12; people++) {
        const split = splitBillEvenly(total, people);
        expect(split.shares.reduce((a, b) => a + b, 0)).toBe(total);
        expect(split.high - split.low).toBeLessThanOrEqual(1);
      }
    }
  });

  it("rechaza personas inválidas", () => {
    expect(() => splitBillEvenly(1000, 0)).toThrow("SPLIT_PEOPLE_INVALID");
    expect(() => splitBillEvenly(1000, NaN)).toThrow("SPLIT_PEOPLE_INVALID");
  });
});