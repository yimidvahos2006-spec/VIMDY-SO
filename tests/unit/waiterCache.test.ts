import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { Waiter } from "../../src/core/entities/Entities";
import { readCachedWaiters, writeCachedWaiters } from "../../src/core/utils/waiterCache";

class FakeStorage {
  data = new Map<string, string>();
  getItem(key: string) {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string) {
    this.data.set(key, value);
  }
}

const waiter = (id: string, extra: Partial<Waiter> = {}): Waiter => ({
  id,
  name: `Mesero ${id}`,
  active: true,
  createdAt: new Date("2026-10-01T10:00:00.000Z"),
  ...extra
});

describe("caché local de meseros", () => {
  let storage: FakeStorage;

  beforeEach(() => {
    storage = new FakeStorage();
    (globalThis as { window?: unknown }).window = { localStorage: storage };
  });

  afterEach(() => {
    delete (globalThis as { window?: unknown }).window;
  });

  it("guarda y vuelve a leer la lista, con la fecha como Date", () => {
    writeCachedWaiters("neg-1", [waiter("a"), waiter("b")]);
    const cached = readCachedWaiters("neg-1");
    expect(cached?.map((w) => w.id)).toEqual(["a", "b"]);
    expect(cached?.[0].createdAt).toBeInstanceOf(Date);
    expect(cached?.[0].createdAt.toISOString()).toBe("2026-10-01T10:00:00.000Z");
  });

  it("cada negocio tiene su propia lista (no se mezclan)", () => {
    writeCachedWaiters("neg-1", [waiter("a")]);
    writeCachedWaiters("neg-2", [waiter("z")]);
    expect(readCachedWaiters("neg-1")?.map((w) => w.id)).toEqual(["a"]);
    expect(readCachedWaiters("neg-2")?.map((w) => w.id)).toEqual(["z"]);
  });

  it("distingue 'lista vacía guardada' de 'nunca se guardó'", () => {
    expect(readCachedWaiters("neg-1")).toBeNull();
    writeCachedWaiters("neg-1", []);
    expect(readCachedWaiters("neg-1")).toEqual([]);
  });

  it("no guarda fotos pesadas (data: URL) pero sí enlaces cortos", () => {
    writeCachedWaiters("neg-1", [
      waiter("a", { photoUrl: "data:image/png;base64," + "A".repeat(5000) }),
      waiter("b", { photoUrl: "https://cdn.vimdy.co/b.jpg" })
    ]);
    const cached = readCachedWaiters("neg-1")!;
    expect(cached[0].photoUrl).toBeUndefined();
    expect(cached[1].photoUrl).toBe("https://cdn.vimdy.co/b.jpg");
  });

  it("una caché dañada se descarta completa en vez de mostrar datos a medias", () => {
    storage.setItem("vimdy:cache:waiters:v1:neg-1", "{no es json");
    expect(readCachedWaiters("neg-1")).toBeNull();
    storage.setItem("vimdy:cache:waiters:v1:neg-1", JSON.stringify([{ id: "a", name: "A", active: true }, { id: 5 }]));
    expect(readCachedWaiters("neg-1")).toBeNull();
    storage.setItem("vimdy:cache:waiters:v1:neg-1", JSON.stringify({ id: "a" }));
    expect(readCachedWaiters("neg-1")).toBeNull();
  });

  it("sin negocio o sin window no hace nada y no lanza", () => {
    writeCachedWaiters(null, [waiter("a")]);
    expect(readCachedWaiters(undefined)).toBeNull();
    delete (globalThis as { window?: unknown }).window;
    expect(() => writeCachedWaiters("neg-1", [waiter("a")])).not.toThrow();
    expect(readCachedWaiters("neg-1")).toBeNull();
  });
});