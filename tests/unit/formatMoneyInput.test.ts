import { describe, expect, it } from "vitest";
import { formatMoneyInput, toMoneyInputValue } from "../../src/core/utils/formatMoneyInput";
import { parseMoneyInput } from "../../src/core/utils/parseMoneyInput";

describe("formatMoneyInput", () => {
  it("agrega el punto de miles", () => {
    expect(formatMoneyInput("3")).toBe("3");
    expect(formatMoneyInput("300")).toBe("300");
    expect(formatMoneyInput("3000")).toBe("3.000");
    expect(formatMoneyInput("15000")).toBe("15.000");
    expect(formatMoneyInput("1250000")).toBe("1.250.000");
  });

  it("vuelve a formatear lo ya formateado y los puntos que escriba la persona", () => {
    expect(formatMoneyInput("3.0000")).toBe("30.000");
    expect(formatMoneyInput("3.00")).toBe("300");
    expect(formatMoneyInput("1.2.5.0.0.0")).toBe("125.000");
  });

  it("usa la coma como decimal, máximo 2 decimales", () => {
    expect(formatMoneyInput("3500,5")).toBe("3.500,5");
    expect(formatMoneyInput("3500,556")).toBe("3.500,55");
    expect(formatMoneyInput("3,")).toBe("3,");
    expect(formatMoneyInput(",5")).toBe("0,5");
    expect(formatMoneyInput("3,5,5")).toBe("3,55");
  });

  it("descarta letras, signos y $", () => {
    expect(formatMoneyInput("$ 3000")).toBe("3.000");
    expect(formatMoneyInput("3e3")).toBe("33");
    expect(formatMoneyInput("-500")).toBe("500");
    expect(formatMoneyInput("abc")).toBe("");
    expect(formatMoneyInput("")).toBe("");
  });

  it("quita ceros a la izquierda", () => {
    expect(formatMoneyInput("0003")).toBe("3");
    expect(formatMoneyInput("0")).toBe("0");
    expect(formatMoneyInput("00")).toBe("0");
  });

  it("lo que produce siempre lo lee bien parseMoneyInput", () => {
    for (const typed of ["3000", "15000", "1250000", "3500,5", "0,5", "999", "12,75", "1000000000"]) {
      const formatted = formatMoneyInput(typed);
      expect(parseMoneyInput(formatted)).toBe(parseMoneyInput(typed.replace(",", ".")));
    }
    expect(parseMoneyInput(formatMoneyInput("3000"))).toBe(3000);
  });
});

describe("toMoneyInputValue", () => {
  it("convierte números guardados al texto del campo", () => {
    expect(toMoneyInputValue(3000)).toBe("3.000");
    expect(toMoneyInputValue(3.5)).toBe("3,5");
    expect(toMoneyInputValue(0)).toBe("0");
    expect(toMoneyInputValue(undefined)).toBe("");
    expect(toMoneyInputValue("")).toBe("");
  });
});