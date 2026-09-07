import { describe, it, expect } from "vitest";
import { Table } from "../../src/core/entities/Entities";
import { getTableUrgency, AVG_DURATION_FALLBACK_MS } from "../../src/core/services/tableUrgency";

function buildTable(overrides: Partial<Table> = {}): Table {
  const now = new Date();
  return {
    id: "table-test",
    name: "Mesa 1",
    capacity: 4,
    peopleCount: 2,
    status: "BUSY",
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    updatedAt: now,
    ...overrides
  };
}

describe("getTableUrgency", () => {
  it("mesa fresca (< 60% del promedio) -> tranquila", () => {
    const table = buildTable({
      status: "BUSY",
      openedAt: new Date(Date.now() - 20 * 60 * 1000) // 20 min
    });
    const avg = 45 * 60 * 1000; // 45 min

    const result = getTableUrgency(table, avg);

    expect(result.level).toBe("low");
    expect(result.action).toBe("Todo tranquilo");
    expect(result.progress).toBeCloseTo((20 / 45) * 100, 1);
  });

  it("mesa a mitad (60-85% del promedio) -> media, sin cuenta pedida", () => {
    const table = buildTable({
      status: "EATING",
      openedAt: new Date(Date.now() - 32 * 60 * 1000) // 32 min
    });
    const avg = 45 * 60 * 1000;

    const result = getTableUrgency(table, avg);

    expect(result.level).toBe("medium");
    expect(result.action).toBe("Ir preguntando");
    expect(result.progress).toBeCloseTo((32 / 45) * 100, 1);
  });

  it("mesa a mitad esperando comida -> Verificar con cocina", () => {
    const table = buildTable({
      status: "WAITING_FOOD",
      openedAt: new Date(Date.now() - 32 * 60 * 1000)
    });
    const avg = 45 * 60 * 1000;

    const result = getTableUrgency(table, avg);

    expect(result.level).toBe("medium");
    expect(result.action).toBe("Verificar con cocina");
  });

  it("mesa urgente (> 85% del promedio) -> roja", () => {
    const table = buildTable({
      status: "EATING",
      openedAt: new Date(Date.now() - 40 * 60 * 1000) // 40 min
    });
    const avg = 45 * 60 * 1000;

    const result = getTableUrgency(table, avg);

    expect(result.level).toBe("high");
    expect(result.action).toBe("Pasar cuenta ya");
    expect(result.progress).toBeCloseTo((40 / 45) * 100, 1);
  });

  it("cuenta pedida + más de 5 min sin cerrar -> siempre roja, sin importar el %", () => {
    const table = buildTable({
      status: "CUENTA_SOLICITADA",
      openedAt: new Date(Date.now() - 10 * 60 * 1000) // 10 min, muy fresca
    });
    const avg = 45 * 60 * 1000;

    const result = getTableUrgency(table, avg);

    expect(result.level).toBe("high");
    expect(result.action).toBe("Pasar cuenta ya");
    expect(result.progress).toBe(100);
  });

  it("mesa libre -> sin acción, progress 0", () => {
    const table = buildTable({ status: "FREE" });

    const result = getTableUrgency(table, 45 * 60 * 1000);

    expect(result.level).toBe("free");
    expect(result.action).toBe("Sin acción");
    expect(result.progress).toBe(0);
  });

  it("mesa sin openedAt -> sin acción, progress 0", () => {
    const table = buildTable({
      status: "BUSY",
      openedAt: undefined
    });

    const result = getTableUrgency(table, 45 * 60 * 1000);

    expect(result.level).toBe("free");
    expect(result.action).toBe("Sin acción");
    expect(result.progress).toBe(0);
  });

  it("fallback de 45 min está documentado como constante exportada", () => {
    expect(AVG_DURATION_FALLBACK_MS).toBe(45 * 60 * 1000);
  });
});
