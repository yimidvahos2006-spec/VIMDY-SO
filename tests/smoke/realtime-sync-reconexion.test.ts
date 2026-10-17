// Regresión: "cannot add `postgres_changes` callbacks ... after `subscribe()`".
// Antes, al reconectar (o al reintentar el arranque) se pedía un canal con el
// mismo nombre; supabase-js devolvía el ya suscrito y `.on()` lanzaba, dejando
// la app en "No pudimos cargar tu negocio" sin salida.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const registry = new Map<string, any>();

function makeChannel(name: string) {
  const ch: any = {
    name,
    subscribed: false,
    on() {
      if (ch.subscribed) throw new Error("cannot add `postgres_changes` callbacks after `subscribe()`.");
      return ch;
    },
    subscribe(cb?: (s: string) => void) {
      ch.subscribed = true;
      ch.cb = cb;
      return ch;
    }
  };
  return ch;
}

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    // Igual que supabase-js: mismo nombre => mismo canal mientras no se haya quitado del registro.
    channel: (name: string) => {
      if (!registry.has(name)) registry.set(name, makeChannel(name));
      return registry.get(name);
    },
    // El cierre real es asíncrono: el canal sigue en el registro un rato.
    removeChannel: async () => undefined
  }
}));

import { startRealtimeSync, stopRealtimeSync } from "../../src/infrastructure/supabase/realtimeSync";

describe("realtimeSync", () => {
  beforeEach(() => { registry.clear(); vi.useFakeTimers(); });
  afterEach(() => { stopRealtimeSync(); vi.useRealTimers(); });

  it("reabrir el canal del mismo negocio no lanza error", () => {
    startRealtimeSync("biz-1");
    stopRealtimeSync();
    expect(() => startRealtimeSync("biz-1")).not.toThrow();
    expect(registry.size).toBe(2);
  });

  it("si la conexión se cae, reconecta con un canal nuevo sin romper", () => {
    startRealtimeSync("biz-1");
    const first = [...registry.values()][0];
    first.cb("CLOSED");
    expect(() => vi.advanceTimersByTime(3100)).not.toThrow();
    expect(registry.size).toBe(2);
  });

  it("un aviso tardío de un canal viejo no tumba el canal nuevo", () => {
    startRealtimeSync("biz-1");
    const first = [...registry.values()][0];
    stopRealtimeSync();
    startRealtimeSync("biz-1");
    first.cb("CLOSED");
    vi.advanceTimersByTime(3100);
    expect(registry.size).toBe(2);
  });
});