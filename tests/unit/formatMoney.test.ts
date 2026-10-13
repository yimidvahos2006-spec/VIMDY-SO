import { describe, expect, it } from "vitest";
import { formatMoney } from "../../src/core/utils/formatMoney";

describe("formatMoney", () => {
  it("COP se ve como $36.000 (no '36.000 COP')", () => {
    expect(formatMoney(36000, "COP", "es")).toBe("$36.000");
    expect(formatMoney(100000, "COP")).toBe("$100.000");
  });
  it("COP no lleva decimales", () => {
    expect(formatMoney(3500.4, "COP", "es")).toBe("$3.500");
  });
  it("MXN conserva centavos", () => {
    expect(formatMoney(1250.5, "MXN", "es-MX")).toBe("$1,250.50");
  });
});