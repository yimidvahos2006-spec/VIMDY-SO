import { describe, it, expect } from "vitest";
import { RANGE_LABEL } from "../../src/core/store/useReports";

describe("useReports - criterio de simplicidad", () => {
  it("RANGE_LABEL tiene exactamente 5 opciones", () => {
    expect(Object.keys(RANGE_LABEL)).toHaveLength(5);
  });

  it("las 5 opciones son las esperadas", () => {
    expect(RANGE_LABEL["hoy"]).toBe("Hoy");
    expect(RANGE_LABEL["7d"]).toBe("Últimos 7 días");
    expect(RANGE_LABEL["30d"]).toBe("Últimos 30 días");
    expect(RANGE_LABEL["mes"]).toBe("Este mes");
    expect(RANGE_LABEL["todo"]).toBe("Todo");
  });

  it("no tiene opciones extra ni faltantes", () => {
    const keys = Object.keys(RANGE_LABEL) as Array<keyof typeof RANGE_LABEL>;
    expect(keys).toEqual(["hoy", "7d", "30d", "mes", "todo"]);
  });
});
