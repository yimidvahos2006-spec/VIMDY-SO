// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

import type { Table } from "../../src/core/entities/Entities";

vi.mock("../../src/core/store/useConnection", () => ({
  useConnection: () => ({ isOnline: true })
}));

import { FloorPlan } from "../../src/presentation/components/floorplan/FloorPlan";

const NOW = new Date("2026-11-03T20:00:00Z").getTime();
const MIN = 60_000;

function table(partial: Partial<Table> & { id: string }): Table {
  return {
    name: `Mesa ${partial.id}`, capacity: 4, peopleCount: 0, status: "FREE", items: [],
    subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date(NOW), ...partial
  } as Table;
}

const TABLES: Table[] = [
  table({ id: "1" }),
  table({ id: "2", status: "BUSY", openedAt: new Date(NOW - 47 * MIN), total: 124_500, peopleCount: 4 }),
  table({ id: "3", status: "CUENTA_SOLICITADA", openedAt: new Date(NOW - 62 * MIN), total: 80_000 }),
  table({ id: "4", zone: "Terraza", capacity: 2 })
];

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(extra: Partial<Parameters<typeof FloorPlan>[0]> = {}) {
  const onSelect = vi.fn();
  render(h(FloorPlan, { tables: TABLES, avgDurationMs: 45 * MIN, onSelect, ...extra }));
  return { onSelect };
}

describe("Mapa de Mesas Visual", () => {
  it("pinta cada mesa con su estado: verde / rojo / ámbar", () => {
    mount();
    const states = Object.fromEntries(
      screen.getAllByRole("button").filter((b) => b.dataset.state).map((b) => [b.getAttribute("aria-label")!.split(",")[0], b.dataset.state])
    );
    expect(states).toMatchObject({ "Mesa 1": "free", "Mesa 2": "occupied", "Mesa 3": "alert", "Mesa 4": "free" });
  });

  it("la mesa ocupada muestra tiempo abierta y consumo; la libre no", () => {
    mount();
    const busy = screen.getByRole("button", { name: /^Mesa 2,/ });
    expect(busy.textContent).toContain("47 min");
    expect(busy.textContent).toMatch(/124\.500|124,500/);
    const free = screen.getByRole("button", { name: /^Mesa 1,/ });
    expect(free.textContent).not.toContain("min");
  });

  it("la mesa pidiendo cuenta lo dice con texto (no solo color)", () => {
    mount();
    expect(screen.getByRole("button", { name: /^Mesa 3,/ }).textContent).toContain("Pidiendo cuenta");
  });

  it("el resumen cuenta libres, ocupadas y alertas, y suma el consumo en vivo", () => {
    mount();
    const group = screen.getByRole("group", { name: "Resumen del salón" });
    const buttons = within(group).getAllByRole("button");
    expect(buttons[0].textContent).toContain("Libres");
    expect(buttons[0].textContent).toContain("2");
    expect(buttons[1].textContent).toContain("Ocupadas");
    expect(buttons[2].textContent).toContain("Pidiendo cuenta / alerta");
    expect(group.textContent).toMatch(/204\.500|204,500/);
    expect(group.textContent).toContain("2 cuentas abiertas");
  });

  it("el cronómetro avanza solo con el reloj (sin recargar)", () => {
    mount();
    expect(screen.getByRole("button", { name: /^Mesa 2,/ }).textContent).toContain("47 min");
    act(() => {
      vi.advanceTimersByTime(3 * MIN);
    });
    expect(screen.getByRole("button", { name: /^Mesa 2,/ }).textContent).toContain("50 min");
  });

  it("tocar una mesa la abre; filtrar por estado atenúa el resto", () => {
    const { onSelect } = mount();
    fireEvent.click(screen.getByRole("button", { name: /^Mesa 2,/ }));
    expect(onSelect).toHaveBeenCalledWith(expect.objectContaining({ id: "2" }));

    const alertFilter = within(screen.getByRole("group", { name: "Resumen del salón" })).getAllByRole("button")[2];
    fireEvent.click(alertFilter);
    expect(alertFilter.getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: /^Mesa 1,/ }).className).toContain("opacity-30");
    expect(screen.getByRole("button", { name: /^Mesa 3,/ }).className).not.toContain("opacity-30");
  });

  it("con varias zonas hay pestañas y se puede ver solo una", () => {
    mount();
    const tabs = screen.getAllByRole("tab");
    // Orden: "Todo el salón", zonas A–Z y "Sin zona" al final (la insignia numérica es el conteo de alertas).
    expect(tabs.map((t) => (t.textContent ?? "").replace(/\d+$/, ""))).toEqual(["Todo el salón", "Terraza", "Sin zona"]);
    fireEvent.click(screen.getByRole("tab", { name: /^Terraza/ }));
    expect(screen.queryByRole("button", { name: /^Mesa 1,/ })).toBeNull();
    expect(screen.getByRole("button", { name: /^Mesa 4,/ })).toBeTruthy();
  });

  it("'Editar plano' solo aparece si la persona puede editar", () => {
    mount();
    expect(screen.queryByRole("button", { name: /Editar plano/ })).toBeNull();
    cleanup();
    mount({ onSaveLayouts: vi.fn() });
    expect(screen.getByRole("button", { name: /Editar plano/ })).toBeTruthy();
  });

  it("en modo edición tocar no abre la mesa, y mover con flechas habilita Guardar", async () => {
    vi.useRealTimers();
    const onSaveLayouts = vi.fn(async (u: unknown[]) => ({ saved: u.length, failed: [] }));
    const { onSelect } = mount({ onSaveLayouts });
    fireEvent.click(screen.getByRole("button", { name: /Editar plano/ }));

    const save = screen.getByRole("button", { name: /Guardar plano/ }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);

    const node = screen.getByRole("button", { name: /^Mesa 1,/ });
    fireEvent.click(node);
    expect(onSelect).not.toHaveBeenCalled();

    // Hacia la derecha chocaría con la Mesa 2: el plano lo rechaza y no hay cambios.
    fireEvent.keyDown(node, { key: "ArrowRight", shiftKey: true });
    expect((screen.getByRole("button", { name: /Guardar plano/ }) as HTMLButtonElement).disabled).toBe(true);

    // Hacia abajo hay espacio libre: se acepta.
    fireEvent.keyDown(node, { key: "ArrowDown", shiftKey: true });
    const saveAfter = screen.getByRole("button", { name: /Guardar plano \(/ }) as HTMLButtonElement;
    expect(saveAfter.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(saveAfter);
    });
    expect(onSaveLayouts).toHaveBeenCalledTimes(1);
    const updates = onSaveLayouts.mock.calls[0][0] as { tableId: string; layout?: { x: number; y: number } }[];
    // Al mover una mesa se congelan las demás de su zona: ninguna "salta".
    expect(updates.map((u) => u.tableId).sort()).toEqual(["1", "2", "3"]);
    expect(updates.every((u) => Number.isFinite(u.layout?.x) && Number.isFinite(u.layout?.y))).toBe(true);
  });

  it("sin mesas muestra el estado vacío con salida a la vista Lista", () => {
    const onGoToList = vi.fn();
    render(h(FloorPlan, { tables: [], avgDurationMs: 45 * MIN, onSelect: vi.fn(), onGoToList }));
    fireEvent.click(screen.getByRole("button", { name: /Ir a la vista Lista/ }));
    expect(onGoToList).toHaveBeenCalled();
  });
});