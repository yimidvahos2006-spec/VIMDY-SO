import { describe, expect, it, vi } from "vitest";

import type { Table, TableLayout } from "../../src/core/entities/Entities";
import {
  CANVAS_W, CRITICAL_BILL_WAIT_MS, MIN_CANVAS_H, SHAPE_SIZE,
  buildFloorViews, clampPosition, defaultShape, formatElapsed, groupByZone,
  overlapsAny, placeZone, summarizeFloor, tableConsumption
} from "../../src/core/services/floorPlan";
import { saveTableLayouts } from "../../src/core/services/tableLayoutService";
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";

const NOW = new Date("2026-11-03T20:00:00Z").getTime();
const MIN = 60_000;
const AVG = 45 * MIN;

function table(partial: Partial<Table> & { id: string }): Table {
  return {
    name: `Mesa ${partial.id}`,
    capacity: 4,
    peopleCount: 0,
    status: "FREE",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: new Date(NOW),
    ...partial
  } as Table;
}

const opened = (minutesAgo: number) => new Date(NOW - minutesAgo * MIN);
const view = (t: Table, extra: Partial<Parameters<typeof buildFloorViews>[1]> = {}) =>
  buildFloorViews([t], { now: NOW, avgDurationMs: AVG, ...extra })[0];

describe("estado y color de cada mesa", () => {
  it("FREE → verde (free) sin tiempo ni consumo", () => {
    const v = view(table({ id: "1" }));
    expect(v.state).toBe("free");
    expect(v.elapsedMs).toBeNull();
    expect(v.total).toBe(0);
  });

  it.each(["BUSY", "WAITING_FOOD", "EATING"] as const)("%s → rojo (occupied) con tiempo y consumo", (status) => {
    const v = view(table({ id: "1", status, openedAt: opened(20), total: 85_000 }));
    expect(v.state).toBe("occupied");
    expect(v.elapsedMs).toBe(20 * MIN);
    expect(v.total).toBe(85_000);
  });

  it.each(["CUENTA_SOLICITADA", "WAITING_BILL"] as const)("%s → ámbar por cuenta", (status) => {
    const v = view(table({ id: "1", status, openedAt: opened(30), total: 50_000 }));
    expect(v.state).toBe("alert");
    expect(v.alertReason).toBe("bill");
    expect(v.label).toBe("Pidiendo cuenta");
  });

  it("PAYING → ámbar por cobro en curso", () => {
    const v = view(table({ id: "1", status: "PAYING", openedAt: opened(30) }));
    expect(v.state).toBe("alert");
    expect(v.alertReason).toBe("paying");
  });

  it("cuenta pedida hace 5+ min es crítica (late); antes no", () => {
    const fresh = view(table({ id: "1", status: "CUENTA_SOLICITADA", openedAt: new Date(NOW - CRITICAL_BILL_WAIT_MS + 1) }));
    const stale = view(table({ id: "1", status: "CUENTA_SOLICITADA", openedAt: new Date(NOW - CRITICAL_BILL_WAIT_MS) }));
    expect(fresh.critical).toBe(false);
    expect(stale.critical).toBe(true);
  });

  it("ocupada pasa a ámbar solo al superar 1.5× el promedio", () => {
    expect(view(table({ id: "1", status: "EATING", openedAt: opened(67) })).state).toBe("occupied");
    const late = view(table({ id: "1", status: "EATING", openedAt: opened(68) }));
    expect(late.state).toBe("alert");
    expect(late.alertReason).toBe("overstay");
  });

  it("overstayFactor: null desactiva la alerta por tiempo", () => {
    const v = view(table({ id: "1", status: "BUSY", openedAt: opened(300) }), { overstayFactor: null });
    expect(v.state).toBe("occupied");
  });

  it("RESERVED e CLOSED no son verde/rojo/ámbar", () => {
    expect(view(table({ id: "1", status: "RESERVED" })).state).toBe("reserved");
    const main = table({ id: "main", name: "Mesa 9", status: "BUSY", openedAt: opened(5) });
    const merged = table({ id: "2", status: "CLOSED", mergedInto: "main" });
    const [, v] = buildFloorViews([main, merged], { now: NOW, avgDurationMs: AVG });
    expect(v.state).toBe("merged");
    expect(v.mergedIntoName).toBe("Mesa 9");
  });

  it("mesa abierta sin openedAt no rompe: tiempo null", () => {
    const v = view(table({ id: "1", status: "BUSY" }));
    expect(v.state).toBe("occupied");
    expect(v.elapsedMs).toBeNull();
    expect(formatElapsed(v.elapsedMs)).toBe("—");
  });

  it("openedAt en el futuro (reloj desfasado) no da tiempo negativo", () => {
    expect(view(table({ id: "1", status: "BUSY", openedAt: new Date(NOW + 5 * MIN) })).elapsedMs).toBe(0);
  });

  it("resuelve el nombre del mesero", () => {
    const v = view(table({ id: "1", status: "BUSY", openedAt: opened(1), waiterId: "w1" }), { waiters: [{ id: "w1", name: "Juan Pérez" }] });
    expect(v.waiterName).toBe("Juan Pérez");
  });
});

describe("consumo en vivo", () => {
  it("usa total guardado; si es 0 pero hay líneas, las suma", () => {
    expect(tableConsumption({ total: 12_000, items: [] })).toBe(12_000);
    expect(
      tableConsumption({ total: 0, items: [{ price: 5_000, quantity: 2 }, { price: 1_500, quantity: 1 }] as Table["items"] })
    ).toBe(11_500);
    expect(tableConsumption({ total: Number.NaN, items: [] })).toBe(0);
  });
});

describe("formatElapsed", () => {
  it.each([
    [0, "<1 min"], [59_000, "<1 min"], [MIN, "1 min"], [47 * MIN, "47 min"],
    [60 * MIN, "1 h 00 min"], [65 * MIN, "1 h 05 min"], [135 * MIN, "2 h 15 min"]
  ])("%i ms → %s", (ms, text) => expect(formatElapsed(ms)).toBe(text));
  it("null/NaN → guion", () => {
    expect(formatElapsed(null)).toBe("—");
    expect(formatElapsed(Number.NaN)).toBe("—");
  });
});

describe("resumen del salón", () => {
  it("cuenta por estado, suma consumo abierto y calcula ocupación", () => {
    const tables = [
      table({ id: "1" }),
      table({ id: "2", status: "BUSY", openedAt: opened(10), total: 40_000 }),
      table({ id: "3", status: "CUENTA_SOLICITADA", openedAt: opened(50), total: 60_000 }),
      table({ id: "4", status: "RESERVED" }),
      table({ id: "5", status: "CLOSED", mergedInto: "2" })
    ];
    const s = summarizeFloor(buildFloorViews(tables, { now: NOW, avgDurationMs: AVG }));
    expect(s).toMatchObject({ free: 1, occupied: 1, alert: 1, reserved: 1, active: 4, liveTotal: 100_000, occupancyPct: 50 });
  });
  it("salón vacío no divide por cero", () => {
    expect(summarizeFloor([]).occupancyPct).toBe(0);
  });
});

describe("zonas", () => {
  it("ordena alfabético y deja 'Sin zona' al final", () => {
    const views = buildFloorViews(
      [table({ id: "1" }), table({ id: "2", zone: "Terraza" }), table({ id: "3", zone: "Barra" })],
      { now: NOW, avgDurationMs: AVG }
    );
    expect(groupByZone(views).map((g) => g.zone)).toEqual(["Barra", "Terraza", "Sin zona"]);
  });
});

describe("acomodo del plano", () => {
  const rect = (p: { x: number; y: number; w: number; h: number }) => ({ x: p.x, y: p.y, w: p.w, h: p.h });

  it("forma por defecto según capacidad", () => {
    expect([1, 2, 3, 5, 6, 10].map(defaultShape)).toEqual(["round", "round", "square", "square", "rect", "rect"]);
  });

  it("sin posiciones guardadas: ninguna mesa se encima y todas caben en el lienzo", () => {
    const tables = Array.from({ length: 25 }, (_, i) => table({ id: String(i + 1), capacity: (i % 8) + 1 }));
    const { placed, height } = placeZone(tables);
    expect(placed).toHaveLength(25);
    for (const p of placed) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.w).toBeLessThanOrEqual(CANVAS_W);
      expect(p.auto).toBe(true);
    }
    placed.forEach((a, i) => placed.slice(i + 1).forEach((b) => expect(overlapsAny(rect(a), [rect(b)])).toBe(false)));
    expect(height).toBeGreaterThanOrEqual(MIN_CANVAS_H);
    expect(height).toBeGreaterThanOrEqual(Math.max(...placed.map((p) => p.y + p.h)));
  });

  it("respeta posiciones guardadas y acomoda las nuevas debajo, sin encimar", () => {
    const saved: TableLayout = { x: 400, y: 200, shape: "rect" };
    const tables = [table({ id: "1", layout: saved }), table({ id: "2" }), table({ id: "3" })];
    const { placed } = placeZone(tables);
    const one = placed.find((p) => p.id === "1")!;
    expect(one).toMatchObject({ x: 400, y: 200, shape: "rect", auto: false });
    for (const p of placed.filter((p) => p.id !== "1")) {
      expect(p.y).toBeGreaterThanOrEqual(one.y + one.h);
      expect(overlapsAny(rect(p), [rect(one)])).toBe(false);
    }
  });

  it("el borrador gana sobre lo guardado y null vuelve a acomodar solo", () => {
    const t = table({ id: "1", layout: { x: 400, y: 200 } });
    expect(placeZone([t], new Map([["1", { x: 80, y: 96 }]])).placed[0]).toMatchObject({ x: 80, y: 96 });
    expect(placeZone([t], new Map([["1", null]])).placed[0].auto).toBe(true);
  });

  it("layouts corruptos (NaN, fuera del lienzo) se corrigen o se ignoran", () => {
    const bad = table({ id: "1", layout: { x: Number.NaN, y: 10 } });
    expect(placeZone([bad]).placed[0].auto).toBe(true);
    const far = table({ id: "2", capacity: 4, layout: { x: 99_999, y: -50 } });
    const p = placeZone([far]).placed[0];
    expect(p.x + p.w).toBeLessThanOrEqual(CANVAS_W);
    expect(p.y).toBe(0);
  });

  it("clampPosition ajusta a la cuadrícula de 8 px y al borde", () => {
    expect(clampPosition(13, 21, "square")).toEqual({ x: 16, y: 24 });
    expect(clampPosition(-40, -3, "round")).toEqual({ x: 0, y: 0 });
    const right = clampPosition(5_000, 10, "rect");
    expect(right.x + SHAPE_SIZE.rect.w).toBeLessThanOrEqual(CANVAS_W);
    expect(right.x % 8).toBe(0);
  });

  it("detecta encimes con margen", () => {
    const a = { x: 0, y: 0, w: 100, h: 100 };
    expect(overlapsAny({ x: 50, y: 50, w: 100, h: 100 }, [a])).toBe(true);
    expect(overlapsAny({ x: 104, y: 0, w: 100, h: 100 }, [a])).toBe(true); // dentro del margen de 8
    expect(overlapsAny({ x: 108, y: 0, w: 100, h: 100 }, [a])).toBe(false);
  });
});

describe("guardado del plano", () => {
  it("reintenta cuando otro dispositivo cambió la mesa (bloqueo optimista)", async () => {
    let calls = 0;
    const engine = {
      updateTable: vi.fn(async () => {
        calls += 1;
        if (calls < 3) throw new OptimisticLockError("tables", "1");
      })
    };
    const result = await saveTableLayouts(engine, [{ tableId: "1", layout: { x: 8, y: 8 } }]);
    expect(result).toEqual({ saved: 1, failed: [] });
    expect(engine.updateTable).toHaveBeenCalledTimes(3);
  });

  it("un fallo no tumba al resto y se reporta por mesa", async () => {
    const engine = {
      updateTable: vi.fn(async (id: string) => {
        if (id === "bad") throw new Error("SUPABASE_UPDATE_FAILED");
      })
    };
    const result = await saveTableLayouts(engine, [
      { tableId: "ok", layout: { x: 0, y: 0 } },
      { tableId: "bad", layout: { x: 0, y: 0 } },
      { tableId: "reset", layout: undefined }
    ]);
    expect(result.saved).toBe(2);
    expect(result.failed.map((f) => f.tableId)).toEqual(["bad"]);
    expect(engine.updateTable).toHaveBeenCalledWith("reset", { layout: undefined });
  });

  it("se rinde tras 4 conflictos seguidos", async () => {
    const engine = { updateTable: vi.fn(async () => { throw new OptimisticLockError("tables", "1"); }) };
    const result = await saveTableLayouts(engine, [{ tableId: "1", layout: { x: 0, y: 0 } }]);
    expect(result.failed).toHaveLength(1);
    expect(engine.updateTable).toHaveBeenCalledTimes(4);
  });
});