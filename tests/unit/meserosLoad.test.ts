import { describe, expect, it, vi } from "vitest";
import { loadMeserosScreen } from "../../src/core/utils/meserosLoad";

/**
 * Slice 1 (Fase 2): Meseros abre con lo que ya hay en caché y NO espera a la
 * consulta más lenta (meseros por red, duración promedio).
 */

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function setup(overrides: Partial<Parameters<typeof loadMeserosScreen<string, string, string>>[0]> = {}) {
  const calls: string[] = [];
  const opts = {
    loadTables: async () => ["mesa-1"],
    loadProducts: async () => ["prod-1"],
    fetchWaiters: async () => ["ana-red"],
    readCachedWaiters: () => ["ana-cache"] as string[] | null,
    fetchAverage: async () => 1234,
    onTables: vi.fn((t: string[]) => calls.push(`tables:${t.join()}`)),
    onProducts: vi.fn((p: string[]) => calls.push(`products:${p.join()}`)),
    onWaiters: vi.fn((w: string[], source: string) => calls.push(`waiters:${source}:${w.join()}`)),
    onAverage: vi.fn((ms: number) => calls.push(`avg:${ms}`)),
    onBackgroundError: vi.fn(),
    ...overrides
  };
  return { opts, calls };
}

describe("loadMeserosScreen", () => {
  it("con copia local de meseros NO espera a la red de meseros ni a la duración promedio", async () => {
    const waiters = deferred<string[]>();
    const avg = deferred<number>();
    const { opts, calls } = setup({ fetchWaiters: () => waiters.promise, fetchAverage: () => avg.promise });

    await loadMeserosScreen(opts); // resuelve aunque meseros y promedio sigan pendientes
    expect(calls).toEqual(["waiters:cache:ana-cache", "tables:mesa-1", "products:prod-1"]);

    waiters.resolve(["ana-red", "luis-red"]);
    avg.resolve(900);
    await flush();
    expect(calls).toContain("waiters:network:ana-red,luis-red");
    expect(calls).toContain("avg:900");
  });

  it("sin copia local de meseros espera la red (no muestra un selector vacío)", async () => {
    const waiters = deferred<string[]>();
    const { opts, calls } = setup({ readCachedWaiters: () => null, fetchWaiters: () => waiters.promise });

    let done = false;
    const run = loadMeserosScreen(opts).then(() => (done = true));
    await flush();
    expect(done).toBe(false);
    expect(opts.onWaiters).not.toHaveBeenCalled();

    waiters.resolve(["ana-red"]);
    await run;
    expect(calls).toContain("waiters:network:ana-red");
  });

  it("todas las consultas arrancan a la vez, ninguna espera a otra", async () => {
    const started: string[] = [];
    const { opts } = setup({
      loadTables: () => (started.push("tables"), new Promise(() => {})),
      loadProducts: () => (started.push("products"), new Promise(() => {})),
      fetchWaiters: () => (started.push("waiters"), new Promise(() => {})),
      fetchAverage: () => (started.push("avg"), new Promise(() => {}))
    });
    void loadMeserosScreen(opts);
    expect(started.sort()).toEqual(["avg", "products", "tables", "waiters"]);
  });

  it("si la red de meseros falla pero hay copia, la pantalla abre y se avisa como error secundario", async () => {
    const { opts } = setup({ fetchWaiters: async () => { throw new Error("offline"); } });
    await expect(loadMeserosScreen(opts)).resolves.toBeUndefined();
    await flush();
    expect(opts.onBackgroundError).toHaveBeenCalledTimes(1);
    expect(opts.onWaiters).toHaveBeenCalledTimes(1); // solo la copia local
  });

  it("si la red de meseros falla y NO hay copia, es un error de carga", async () => {
    const { opts } = setup({ readCachedWaiters: () => null, fetchWaiters: async () => { throw new Error("offline"); } });
    await expect(loadMeserosScreen(opts)).rejects.toThrow("offline");
  });

  it("si fallan las mesas o los productos, es un error de carga", async () => {
    const a = setup({ loadTables: async () => { throw new Error("tablas"); } });
    await expect(loadMeserosScreen(a.opts)).rejects.toThrow("tablas");
    const b = setup({ loadProducts: async () => { throw new Error("productos"); } });
    await expect(loadMeserosScreen(b.opts)).rejects.toThrow("productos");
  });

  it("un fallo de la duración promedio se ignora", async () => {
    const { opts } = setup({ fetchAverage: async () => { throw new Error("lento"); } });
    await expect(loadMeserosScreen(opts)).resolves.toBeUndefined();
    await flush();
    expect(opts.onAverage).not.toHaveBeenCalled();
  });

  it("sin duración promedio (sin negocio) también funciona", async () => {
    const { opts } = setup({ fetchAverage: undefined });
    await expect(loadMeserosScreen(opts)).resolves.toBeUndefined();
    expect(opts.onAverage).not.toHaveBeenCalled();
  });

  it("si la pantalla se desmonta, no se entrega nada más", async () => {
    let cancelled = false;
    const tables = deferred<string[]>();
    const waiters = deferred<string[]>();
    const { opts } = setup({ loadTables: () => tables.promise, fetchWaiters: () => waiters.promise, isCancelled: () => cancelled });

    const run = loadMeserosScreen(opts);
    cancelled = true;
    tables.resolve(["mesa-1"]);
    waiters.resolve(["ana-red"]);
    await run;
    await flush();
    expect(opts.onTables).not.toHaveBeenCalled();
    expect(opts.onProducts).not.toHaveBeenCalled();
    expect(opts.onWaiters).not.toHaveBeenCalledWith(["ana-red"], "network");
  });
});