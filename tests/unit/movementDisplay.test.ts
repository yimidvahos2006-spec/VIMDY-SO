import { describe, expect, it } from "vitest";
import {
  MOVEMENT_VISIBLE_DAYS,
  businessDaysAgo,
  describeMovement,
  filterVisibleMovements,
  getRelativeMovementTime
} from "../../src/core/utils/movementDisplay";
import type { InventoryMovement } from "../../src/core/entities/Entities";

const TZ = "America/Bogota";
// 15:00 en Bogotá (UTC-5) del 22 oct 2026
const NOW = new Date("2026-10-22T20:00:00.000Z");

function movement(partial: Partial<InventoryMovement> & { date: Date }): InventoryMovement {
  return {
    id: crypto.randomUUID(),
    productId: "p1",
    quantity: 1,
    type: "INCREASE",
    reason: "Stock inicial",
    ...partial
  };
}

describe("movementDisplay — tiempo relativo en zona del negocio", () => {
  it("mismo día: 'hoy a las ...' con la hora de Bogotá", () => {
    // 14:09 en Bogotá
    const label = getRelativeMovementTime(new Date("2026-10-22T19:09:00.000Z"), NOW, TZ);
    expect(label.startsWith("hoy a las")).toBe(true);
    expect(label).toContain("2:09");
  });

  it("antes de medianoche del negocio pero ya es otro día en UTC sigue siendo 'hoy'", () => {
    // 23:30 en Bogotá del 22 oct = 04:30 UTC del 23 oct
    const now = new Date("2026-10-23T04:45:00.000Z");
    const date = new Date("2026-10-23T04:30:00.000Z");
    expect(getRelativeMovementTime(date, now, TZ).startsWith("hoy a las")).toBe(true);
  });

  it("día anterior: 'ayer'", () => {
    expect(getRelativeMovementTime(new Date("2026-10-21T15:00:00.000Z"), NOW, TZ)).toBe("ayer");
  });

  it("2 a 6 días: 'hace N días'", () => {
    expect(getRelativeMovementTime(new Date("2026-10-19T15:00:00.000Z"), NOW, TZ)).toBe("hace 3 días");
    expect(getRelativeMovementTime(new Date("2026-10-16T15:00:00.000Z"), NOW, TZ)).toBe("hace 6 días");
  });

  it("7 días o más: fecha corta del negocio", () => {
    const label = getRelativeMovementTime(new Date("2026-10-12T15:00:00.000Z"), NOW, TZ);
    expect(label.startsWith("el 12")).toBe(true);
  });

  it("una fecha un poco en el futuro (reloj desfasado) se trata como hoy", () => {
    expect(getRelativeMovementTime(new Date("2026-10-22T20:05:00.000Z"), NOW, TZ).startsWith("hoy a las")).toBe(true);
  });
});

describe("movementDisplay — ventana de 30 días (solo oculta, no borra)", () => {
  it("conserva hasta 30 días y oculta lo más viejo sin mutar la lista original", () => {
    const hoy = movement({ date: new Date("2026-10-22T19:00:00.000Z") });
    const hace30 = movement({ date: new Date("2026-09-22T19:00:00.000Z") });
    const hace31 = movement({ date: new Date("2026-09-21T19:00:00.000Z") });
    const original = [hoy, hace30, hace31];

    const visibles = filterVisibleMovements(original, NOW, TZ);

    expect(MOVEMENT_VISIBLE_DAYS).toBe(30);
    expect(businessDaysAgo(hace30.date, NOW, TZ)).toBe(30);
    expect(visibles).toEqual([hoy, hace30]);
    expect(original).toHaveLength(3);
  });
});

describe("movementDisplay — frases", () => {
  it("entrada: 'Agregaste X' con signo +", () => {
    expect(describeMovement({ type: "INCREASE", reason: "Stock inicial" }, "Queso")).toEqual({
      title: "Agregaste Queso",
      sign: "+",
      tone: "up"
    });
  });

  it("salida por venta: 'Vendiste X'", () => {
    expect(describeMovement({ type: "DECREASE", reason: "Venta V-1024" }, "Gaseosa").title).toBe("Vendiste Gaseosa");
    expect(describeMovement({ type: "DECREASE", reason: "SALE" }, "Gaseosa").title).toBe("Vendiste Gaseosa");
  });

  it("otra salida (merma, ajuste, salida rápida): 'Sacaste X' con signo -", () => {
    expect(describeMovement({ type: "DECREASE", reason: "Salida rápida: Vencido" }, "Leche")).toEqual({
      title: "Sacaste Leche",
      sign: "-",
      tone: "down"
    });
  });

  it("ajuste sin dirección: 'Ajustaste X' neutro", () => {
    expect(describeMovement({ type: "ADJUST", reason: "Conteo" }, "Harina")).toEqual({
      title: "Ajustaste Harina",
      sign: "",
      tone: "neutral"
    });
  });
});