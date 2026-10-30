import { describe, expect, it } from "vitest";
import {
  filterByReportRange,
  getPreviousReportRange,
  isInReportWindow,
  isReportRange,
  normalizeReportTimezone,
  resolveReportRange
} from "../../src/core/utils/reportRanges";

const BOG = "America/Bogota";
const iso = (d: Date | null) => (d ? d.toISOString() : null);

describe("reportRanges — Colombia", () => {
  // 2026-10-30 10:28 en Bogotá = 15:28 UTC
  const now = new Date("2026-10-30T15:28:00.000Z");

  it("hoy: de 00:00 de hoy a 00:00 de mañana (hora Colombia)", () => {
    const r = resolveReportRange("hoy", now, BOG);
    expect(iso(r.start)).toBe("2026-10-30T05:00:00.000Z");
    expect(iso(r.endExclusive)).toBe("2026-10-31T05:00:00.000Z");
    expect([r.startKey, r.endKey, r.dayCount]).toEqual(["2026-10-30", "2026-10-30", 1]);
  });

  it("hoy a las 8:30 pm sigue siendo hoy (UTC ya es mañana)", () => {
    const night = new Date("2026-10-31T01:30:00.000Z"); // 20:30 del 30 en Bogotá
    const r = resolveReportRange("hoy", night, BOG);
    expect(r.startKey).toBe("2026-10-30");
    expect(iso(r.start)).toBe("2026-10-30T05:00:00.000Z");
  });

  it("7d: hoy + 6 días anteriores", () => {
    const r = resolveReportRange("7d", now, BOG);
    expect(r.startKey).toBe("2026-10-24");
    expect(iso(r.start)).toBe("2026-10-24T05:00:00.000Z");
    expect(r.dayCount).toBe(7);
  });

  it("30d: hoy + 29 días anteriores", () => {
    const r = resolveReportRange("30d", now, BOG);
    expect(r.startKey).toBe("2026-10-01");
    expect(r.dayCount).toBe(30);
  });

  it("mes: desde el día 1 del mes de negocio", () => {
    const r = resolveReportRange("mes", now, BOG);
    expect(iso(r.start)).toBe("2026-10-01T05:00:00.000Z");
    expect([r.startKey, r.endKey, r.dayCount]).toEqual(["2026-10-01", "2026-10-30", 30]);
  });

  it("mes: 23:59:59 del 31 aún es octubre; 00:00:00 del 1 ya es noviembre", () => {
    const lastSecond = new Date("2026-11-01T04:59:59.000Z");
    const firstSecond = new Date("2026-11-01T05:00:00.000Z");
    expect(resolveReportRange("mes", lastSecond, BOG).startKey).toBe("2026-10-01");
    expect(resolveReportRange("mes", firstSecond, BOG).startKey).toBe("2026-11-01");
  });

  it("7d cruza el fin de año", () => {
    const r = resolveReportRange("7d", new Date("2027-01-03T15:00:00.000Z"), BOG);
    expect(r.startKey).toBe("2026-12-28");
  });

  it("todo: sin límites", () => {
    const r = resolveReportRange("todo", now, BOG);
    expect(r.start).toBeNull();
    expect(r.endExclusive).toBeNull();
    expect(r.dayCount).toBeNull();
    expect(isInReportWindow(new Date("2001-01-01T00:00:00Z"), r)).toBe(true);
  });

  it("los límites del día son exactos (inicio incluido, fin excluido)", () => {
    const r = resolveReportRange("hoy", now, BOG);
    expect(isInReportWindow(new Date("2026-10-30T04:59:59.999Z"), r)).toBe(false);
    expect(isInReportWindow(new Date("2026-10-30T05:00:00.000Z"), r)).toBe(true);
    expect(isInReportWindow(new Date("2026-10-31T04:59:59.999Z"), r)).toBe(true);
    expect(isInReportWindow(new Date("2026-10-31T05:00:00.000Z"), r)).toBe(false);
  });

  it("fechas inválidas nunca entran en la ventana", () => {
    expect(isInReportWindow(new Date("nope"), resolveReportRange("todo", now, BOG))).toBe(false);
  });

  it("filterByReportRange filtra por la fecha elegida", () => {
    const sales = [
      { id: "a", at: new Date("2026-10-30T14:00:00Z") },
      { id: "b", at: new Date("2026-10-29T14:00:00Z") }
    ];
    const r = resolveReportRange("hoy", now, BOG);
    expect(filterByReportRange(sales, (s) => s.at, r).map((s) => s.id)).toEqual(["a"]);
  });
});

describe("reportRanges — periodo anterior", () => {
  const now = new Date("2026-10-30T15:28:00.000Z");

  it("hoy -> ayer completo", () => {
    const p = getPreviousReportRange(resolveReportRange("hoy", now, BOG))!;
    expect([p.startKey, p.endKey]).toEqual(["2026-10-29", "2026-10-29"]);
    expect(iso(p.endExclusive)).toBe("2026-10-30T05:00:00.000Z");
  });

  it("7d -> los 7 días previos, pegados al periodo actual", () => {
    const p = getPreviousReportRange(resolveReportRange("7d", now, BOG))!;
    expect([p.startKey, p.endKey]).toEqual(["2026-10-17", "2026-10-23"]);
    expect(iso(p.endExclusive)).toBe("2026-10-24T05:00:00.000Z");
  });

  it("mes -> N días previos al día 1, con N = días transcurridos", () => {
    const p = getPreviousReportRange(resolveReportRange("mes", now, BOG))!;
    expect([p.startKey, p.endKey, p.dayCount]).toEqual(["2026-09-01", "2026-09-30", 30]);
  });

  it("todo no tiene periodo anterior", () => {
    expect(getPreviousReportRange(resolveReportRange("todo", now, BOG))).toBeNull();
  });
});

describe("reportRanges — robustez", () => {
  const now = new Date("2026-10-30T15:28:00.000Z");

  it("zona inválida o vacía -> America/Bogota", () => {
    expect(normalizeReportTimezone("Mars/Olympus")).toBe(BOG);
    expect(normalizeReportTimezone("")).toBe(BOG);
    expect(normalizeReportTimezone(undefined)).toBe(BOG);
    expect(resolveReportRange("hoy", now, "Mars/Olympus").startKey).toBe("2026-10-30");
  });

  it("`now` inválido lanza un error claro", () => {
    expect(() => resolveReportRange("hoy", new Date("x"), BOG)).toThrow(RangeError);
  });

  it("isReportRange valida valores de entrada", () => {
    expect(isReportRange("7d")).toBe(true);
    expect(isReportRange("ayer")).toBe(false);
    expect(isReportRange(7)).toBe(false);
  });

  it("zona con horario de verano: el día del cambio dura 25 h y 7d usa días calendario", () => {
    // EE. UU. retrocede el reloj el 2026-11-01. "Hoy" (1 nov) empieza a las 00:00 EDT = 04:00Z y termina a las 00:00 EST = 05:00Z del 2.
    const ny = "America/New_York";
    const day = resolveReportRange("hoy", new Date("2026-11-01T18:00:00.000Z"), ny);
    expect(iso(day.start)).toBe("2026-11-01T04:00:00.000Z");
    expect(iso(day.endExclusive)).toBe("2026-11-02T05:00:00.000Z");
    // 7d desde el 3 nov incluye el 28 oct como primer día (no el 28 a las 23:00 por restar 144 h).
    const week = resolveReportRange("7d", new Date("2026-11-03T18:00:00.000Z"), ny);
    expect(week.startKey).toBe("2026-10-28");
    expect(iso(week.start)).toBe("2026-10-28T04:00:00.000Z");
  });
});