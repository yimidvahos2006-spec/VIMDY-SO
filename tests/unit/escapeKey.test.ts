import { describe, it, expect, vi } from "vitest";
import {
  isEscapeKey,
  listenForEscape,
  type EscapeKeyEvent,
  type EscapeKeyTarget,
} from "../../src/core/utils/escapeKey";

function fakeTarget() {
  const listeners = new Set<(event: EscapeKeyEvent) => void>();
  const target: EscapeKeyTarget = {
    addEventListener: (_type, listener) => { listeners.add(listener); },
    removeEventListener: (_type, listener) => { listeners.delete(listener); },
  };
  const press = (event: EscapeKeyEvent) => listeners.forEach((listener) => listener(event));
  return { target, press, count: () => listeners.size };
}

describe("isEscapeKey", () => {
  it("solo reconoce Escape", () => {
    expect(isEscapeKey({ key: "Escape" })).toBe(true);
    expect(isEscapeKey({ key: "Enter" })).toBe(false);
    expect(isEscapeKey({ key: "esc" })).toBe(false);
  });

  it("ignora Escape ya manejado por otro componente o mientras se compone con IME", () => {
    expect(isEscapeKey({ key: "Escape", defaultPrevented: true })).toBe(false);
    expect(isEscapeKey({ key: "Escape", isComposing: true })).toBe(false);
  });
});

describe("listenForEscape", () => {
  it("cierra con Escape y no con otras teclas", () => {
    const { target, press } = fakeTarget();
    const onEscape = vi.fn();
    listenForEscape(target, onEscape);

    press({ key: "a" });
    press({ key: "Enter" });
    expect(onEscape).not.toHaveBeenCalled();

    press({ key: "Escape" });
    expect(onEscape).toHaveBeenCalledTimes(1);
  });

  it("al desmontar deja de escuchar (sin fugas de listeners)", () => {
    const { target, press, count } = fakeTarget();
    const onEscape = vi.fn();
    const stop = listenForEscape(target, onEscape);
    expect(count()).toBe(1);

    stop();
    expect(count()).toBe(0);
    press({ key: "Escape" });
    expect(onEscape).not.toHaveBeenCalled();
  });
});