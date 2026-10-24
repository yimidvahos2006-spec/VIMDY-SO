import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../src/core/entities/Entities";

/**
 * findAllAuthoritative(): lectura directa al servidor, nunca caché, nunca una lectura
 * que ya venía en vuelo. Se prueban los 3 escenarios en que findAll() SÍ devuelve caché.
 */

const h = vi.hoisted(() => ({
  online: true,
  cache: [] as unknown[],
  baseFindAll: vi.fn(),
  rowsNow: [] as unknown[],
  replaced: [] as unknown[][]
}));

vi.mock("../../src/infrastructure/di/repositories/SupabaseRepository", () => ({
  reviveDates: (x: unknown) => x,
  SupabaseRepository: class {
    findAll() { return h.baseFindAll(); }
    reviveRow(row: { data: unknown; version: number }) { return { ...(row.data as object), version: row.version }; }
  }
}));
vi.mock("../../src/infrastructure/di/repositories/ProductLocalRepository", () => ({
  ProductLocalRepository: class {
    async findAll() { return h.cache; }
    async replaceAll(items: unknown[]) { h.replaced.push(items); }
    async deleteMany() {}
    async save() {}
    async delete() {}
    async findById() { return null; }
  }
}));
vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  // La lectura del catálogo ahora pasa por la función segura inventory_products_read
  // (decide en el servidor si el stock llega real o enmascarado). El simulado la
  // alimenta con lo que devuelve `baseFindAll`, igual que antes la tabla.
  supabase: {
    rpc: async (name: string) => {
      if (name !== "inventory_products_read") return { data: null, error: { message: `rpc inesperado: ${name}` } };
      const rows = (await h.baseFindAll()) as Array<{ id: string }>;
      return { data: rows.map((row) => ({ id: row.id, data: row, version: 1 })), error: null };
    }
  },
  getCurrentBusinessId: () => "biz-1",
  getCurrentBranchId: () => "br-1"
}));
vi.mock("../../src/core/store/connectionStore", () => ({ connectionStore: { isOnline: () => h.online } }));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({ logWarning: vi.fn() }));
vi.mock("../../src/core/VimdyCore", () => ({ vimdyCore: { emit: vi.fn() } }));

import { ProductRepository } from "../../src/infrastructure/di/repositories/ProductRepository";

const p = (id: string, stock: number, branchId = "br-1"): Product =>
  ({ id, name: id, stock, branchId, businessId: "biz-1", version: 1 }) as unknown as Product;

describe("ProductRepository.findAllAuthoritative", () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.online = true;
    h.cache = [p("a", 10)]; // caché viejo
    h.replaced = [];
    h.baseFindAll.mockReset();
    h.baseFindAll.mockImplementation(async () => [p("a", 7)]); // servidor
  });

  it("devuelve lo del servidor aunque connectionStore diga que no hay internet", async () => {
    h.online = false;
    const repo = new ProductRepository();
    expect((await repo.findAll())[0].stock).toBe(10); // findAll() sí sirve el caché
    expect((await repo.findAllAuthoritative())[0].stock).toBe(7);
  });

  it("si el servidor falla, LANZA en vez de devolver el caché (findAll sí lo devolvería)", async () => {
    h.baseFindAll.mockRejectedValue(new Error("SUPABASE_FIND_ALL_FAILED (products): Failed to fetch"));
    const repo = new ProductRepository();
    expect((await repo.findAll())[0].stock).toBe(10);
    await expect(repo.findAllAuthoritative()).rejects.toThrow("SUPABASE_FIND_ALL_FAILED");
  });

  it("si el servidor tarda más de 2,5 s espera la respuesta real (findAll devolvería el caché)", async () => {
    vi.useFakeTimers();
    h.baseFindAll.mockImplementation(() => new Promise((resolve) => setTimeout(() => resolve([p("a", 7)]), 4000)));
    const repo = new ProductRepository();
    const result = repo.findAllAuthoritative();
    await vi.advanceTimersByTimeAsync(4000);
    expect((await result)[0].stock).toBe(7);
  });

  it("si el servidor no responde nunca, falla por tiempo (no cae al caché)", async () => {
    vi.useFakeTimers();
    h.baseFindAll.mockImplementation(() => new Promise(() => {}));
    const repo = new ProductRepository();
    const result = repo.findAllAuthoritative();
    const assertion = expect(result).rejects.toThrow("AUTHORITATIVE_READ_TIMEOUT");
    await vi.advanceTimersByTimeAsync(15000);
    await assertion;
  });

  it("no se cuelga de una lectura que ya venía en vuelo: hace la suya, empezada AHORA", async () => {
    const releases: Array<() => void> = [];
    h.rowsNow = [p("a", 10)];
    h.baseFindAll.mockImplementation(() => {
      const snapshotAtCall = [...h.rowsNow]; // lo que la base tenía cuando empezó esa lectura
      return new Promise((resolve) => releases.push(() => resolve(snapshotAtCall)));
    });
    const repo = new ProductRepository();

    const inFlight = repo.findAll(); // arranca un fetch interno (lee stock 10)
    await vi.waitFor(() => expect(releases.length).toBe(1));
    h.rowsNow = [p("a", 7)]; // entra una venta
    const authoritative = repo.findAllAuthoritative(); // debe leer de nuevo
    await vi.waitFor(() => expect(releases.length).toBe(2));
    releases.forEach((r) => r());

    expect((await authoritative)[0].stock).toBe(7);
    expect(h.baseFindAll).toHaveBeenCalledTimes(2);
    await inFlight;
  });

  it("respeta el alcance de sucursal actual", async () => {
    h.baseFindAll.mockImplementation(async () => [p("a", 7), p("x", 3, "otra-sucursal")]);
    const repo = new ProductRepository();
    expect((await repo.findAllAuthoritative()).map((x) => x.id)).toEqual(["a"]);
  });
});

describe("ProductRepository.reloadCatalogFromServer", () => {
  beforeEach(() => {
    vi.useRealTimers();
    h.online = true;
    h.cache = [p("a", 10)]; // caché con la cifra real de antes del conteo
    h.replaced = [];
    h.baseFindAll.mockReset();
  });

  it("reemplaza el caché local con lo que el servidor entrega ahora (stock enmascarado)", async () => {
    h.baseFindAll.mockImplementation(async () => [{ ...p("a", 4), stockMasked: true }]);
    const repo = new ProductRepository();
    const result = await repo.reloadCatalogFromServer();
    expect(result).toHaveLength(1);
    expect(h.replaced).toHaveLength(1);
    expect(h.replaced[0]).toEqual([expect.objectContaining({ id: "a", stock: 4, stockMasked: true })]);
  });

  it("si el servidor falla, LANZA y no toca el caché", async () => {
    h.baseFindAll.mockRejectedValue(new Error("SUPABASE_FIND_ALL_FAILED (products): Failed to fetch"));
    const repo = new ProductRepository();
    await expect(repo.reloadCatalogFromServer()).rejects.toThrow("SUPABASE_FIND_ALL_FAILED");
    expect(h.replaced).toHaveLength(0);
  });

  it("no depende de que connectionStore diga que hay internet", async () => {
    h.online = false;
    h.baseFindAll.mockImplementation(async () => [p("a", 7)]);
    const repo = new ProductRepository();
    await repo.reloadCatalogFromServer();
    expect(h.replaced).toHaveLength(1);
  });
});