// @vitest-environment jsdom
import { createElement as h } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render } from "@testing-library/react";

import { KitchenOrderTimer } from "../../src/presentation/components/dashboard/kitchen/KitchenOrderTimer";

const NOW = new Date("2026-11-03T19:00:00Z").getTime();

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function mount(ageSeconds: number, estimatedMinutes?: number) {
  return render(
    h(KitchenOrderTimer, {
      createdAt: new Date(NOW - ageSeconds * 1000),
      estimatedMinutes
    })
  );
}

describe("cronómetro de Cocina", () => {
  it("muestra el tiempo correcto desde el primer dibujo (sin '0m 00s' de pasada)", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(125, 30);
    expect(container.textContent).toContain("2m 05s");
    expect(container.textContent).not.toContain("0m 00s");
  });

  it("avanza un segundo a la vez", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(59, 30);
    expect(container.textContent).toContain("0m 59s");

    act(() => {
      vi.advanceTimersByTime(1010);
    });
    expect(container.textContent).toContain("1m 00s");
  });

  it("en tiempo: sin etiqueta de alerta", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(60, 30);
    expect(container.textContent).not.toMatch(/POR VENCER|DEMORADO/);
  });

  it("por vencer cerca de la meta del pedido", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(8 * 60, 10); // 80 % de 10 min
    expect(container.textContent).toContain("POR VENCER");
  });

  it("demorado: dice cuántos minutos se pasó, según la meta DE ESE pedido", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(13 * 60, 10);
    expect(container.textContent).toContain("DEMORADO +3 min");
  });

  it("sin tiempo estimado usa la meta de 15 min", () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    const { container } = mount(16 * 60);
    expect(container.textContent).toContain("DEMORADO +1 min");
  });
});