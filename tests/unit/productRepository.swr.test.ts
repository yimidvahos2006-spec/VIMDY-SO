import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../src/core/entities/Entities";

/**
 * Slice 1 (Fase 2): ProductRepository.findAll() es stale-while-revalidate.
 *  - Con internet y caché: responde AL INSTANTE con la caché y revalida por detrás.
 *  - Si lo fresco trae algo distinto emite "inventory" (una sola vez: converge).
 *  - Sin caché (primer uso) espera al servidor; sin internet nunca lo consulta.
 *  - findAllPreferFresh() conserva el comportamiento anterior para administración.
 */

const h = vi.hoisted(() => ({
  online: true,
  cache: [] as unknown[],
  serverCalls: 0,
  server: vi.fn(),
  emit: vi.fn()
}));

vi.mock("../../src/infrastructure/di/repositories/SupabaseRepository", () => ({
  reviveDates: (x: unknown) => x,
  SupabaseRepository: class {
    findAll() { return h.server(); }
    reviveRow(row: { data: unknown; version: number }) { return { ...(row.data as object), version: row.version }; }
  }
}));
vi.mock("../../src/infrastructure/di/repositories/ProductLocalRepository", () => ({
  ProductLocalRepository: class {
    async findAll() { return [...h.cache]; }
    async replaceAll(items: unknown[]) { h.cache = [...items]; }
    async deleteMany() {}
    async save() {}
    async delete() {}
    async findById() { return null; }
  }
}));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    rpc: async () => {
      h.serverCalls += 1;
      const rows = (await h.server()) as Array<{ id: string }>;
      return { data: rows.map((row) => ({ id: row.id, data: row, version: 1 })), error: null };
    }
  },
  getCurrentBusinessId: () => "biz-1",
  getCurrentBranchId: () => "br-1"
}));
vi.mock("../../src/core/store/connectionStore", () => ({ connectionStore: { isOnline: () => h.online } }));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({ logWarning: vi.fn() }));
vi.mock("../../src/core/VimdyCore", () => ({ vimdyCore: { emit: h.emit } }));

import { ProductRepository } from "../../src/infrastructure/di/repositories/ProductRepository";

const p = (id: string, stock: number, price = 1000): Product =>
  ({ id, name: id, stock, price, active: true, branchId: "br-1", businessId: "biz-1", version: 1 }) as unknown as Product;

const flush = async () => {
  for (let i = 0; i < 10; i += 1) await Promise.resolve();
};

describe("ProductRepository.findAll — stale-while-revalidate", () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.online = true;
    h.cache = [p("a", 10)];
    h.serverCalls = 0;
    h.emit.mockReset();
    h.server.mockReset();
    h.server.mockImplementation(async () => [p("a", 10)]);
  });

  it("con caché responde al instante aunque el servidor tarde muchísimo", async () => {
    vi.useFakeTimers();
    h.server.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([p("a", 7)]), 60_000)));
    const repo = new ProductRepository();

    const result = await repo.findAll(); // si esperara al servidor, esto no resolvería sin avanzar el reloj
    expect(result.map((x) => x.stock)).toEqual([10]);
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("revalida por detrás y avisa UNA vez cuando lo fresco es distinto", async () => {
    h.server.mockImplementation(async () => [p("a", 7), p("b", 3)]);
    const repo = new ProductRepository();

    const first = await repo.findAll();
    expect(first.map((x) => x.id)).toEqual(["a"]); // lo viejo, al instante
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect(h.emit).toHaveBeenCalledWith("inventory", { source: "cache-refresh" });

    const second = await repo.findAll(); // ya sale de la caché actualizada
    expect(second.map((x) => x.id).sort()).toEqual(["a", "b"]);
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1); // converge: no vuelve a emitir
  });

  it("detecta un cambio de precio y de stock", async () => {
    h.server.mockImplementation(async () => [p("a", 10, 1500)]);
    const repo = new ProductRepository();
    await repo.findAll();
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1);
  });

  it("si lo fresco es igual a la caché no avisa a nadie", async () => {
    const repo = new ProductRepository();
    await repo.findAll();
    await flush();
    expect(h.serverCalls).toBeGreaterThan(0); // sí revalidó
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("un producto borrado en otro dispositivo desaparece tras la revalidación", async () => {
    h.cache = [p("a", 10), p("gone", 1)];
    h.server.mockImplementation(async () => [p("a", 10)]);
    const repo = new ProductRepository();
    expect((await repo.findAll()).map((x) => x.id)).toEqual(["a", "gone"]);
    await flush();
    expect(h.emit).toHaveBeenCalledTimes(1);
    expect((await repo.findAll()).map((x) => x.id)).toEqual(["a"]);
  });

  it("si el servidor falla por detrás, la pantalla conserva la caché y no se avisa", async () => {
    h.server.mockRejectedValue(new Error("Failed to fetch"));
    const repo = new ProductRepository();
    expect((await repo.findAll()).map((x) => x.id)).toEqual(["a"]);
    await flush();
    expect(h.emit).not.toHaveBeenCalled();
  });

  it("sin caché (primer uso) espera al servidor para tener algo que pintar", async () => {
    h.cache = [];
    h.server.mockImplementation(async () => [p("a", 5), p("b", 6)]);
    const repo = new ProductRepository();
    expect((await repo.findAll()).map((x) => x.id).sort()).toEqual(["a", "b"]);
  });

  it("sin caché y con el servidor colgado, no espera más de 2,5 s", async () => {
    vi.useFakeTimers();
    h.cache = [];
    h.server.mockImplementation(() => new Promise(() => {}));
    const repo = new ProductRepository();
    const result = repo.findAll();
    await vi.advanceTimersByTimeAsync(2500);
    expect(await result).toEqual([]);
  });

  it("sin internet devuelve la caché y no consulta al servidor", async () => {
    h.online = false;
    const repo = new ProductRepository();
    expect((await repo.findAll()).map((x) => x.id)).toEqual(["a"]);
    await flush();
    expect(h.serverCalls).toBe(0);
    expect(h.emit).not.toHaveBeenCalled();
  });
});

describe("ProductRepository.findAllPreferFresh — para administración del catálogo", () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.online = true;
    h.cache = [p("a", 10)];
    h.serverCalls = 0;
    h.emit.mockReset();
    h.server.mockReset();
  });

  it("espera al servidor y devuelve lo fresco (detecta un nombre creado en otro equipo)", async () => {
    h.server.mockImplementation(async () => [p("a", 10), p("nuevo", 1)]);
    const repo = new ProductRepository();
    expect((await repo.findAllPreferFresh()).map((x) => x.id).sort()).toEqual(["a", "nuevo"]);
  });

  it("si el servidor falla cae a la caché", async () => {
    h.server.mockRejectedValue(new Error("Failed to fetch"));
    const repo = new ProductRepository();
    expect((await repo.findAllPreferFresh()).map((x) => x.id)).toEqual(["a"]);
  });

  it("sin internet devuelve la caché", async () => {
    h.online = false;
    const repo = new ProductRepository();
    expect((await repo.findAllPreferFresh()).map((x) => x.id)).toEqual(["a"]);
    expect(h.serverCalls).toBe(0);
  });
});