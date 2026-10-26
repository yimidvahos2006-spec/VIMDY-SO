import { describe, it, expect, vi } from "vitest";
import { staleWhileRevalidate } from "../../src/core/utils/staleWhileRevalidate";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("staleWhileRevalidate", () => {
  it("entrega el caché primero y luego el dato fresco", async () => {
    const network = deferred<string[]>();
    const seen: Array<[string[], string]> = [];

    const run = staleWhileRevalidate<string[]>({
      readCache: async () => ["viejo"],
      fetchFresh: () => network.promise,
      onData: (data, source) => seen.push([data, source])
    });

    await new Promise((r) => setTimeout(r, 0));
    expect(seen).toEqual([[["viejo"], "cache"]]);

    network.resolve(["nuevo"]);
    const result = await run;

    expect(result).toEqual(["nuevo"]);
    expect(seen).toEqual([
      [["viejo"], "cache"],
      [["nuevo"], "network"]
    ]);
  });

  it("descarta un caché que llega DESPUÉS de la red (nunca pisa un dato fresco)", async () => {
    const cache = deferred<string | null>();
    const seen: Array<[string, string]> = [];

    const run = staleWhileRevalidate<string>({
      readCache: () => cache.promise,
      fetchFresh: async () => "fresco",
      onData: (data, source) => seen.push([data, source])
    });

    // La red ya terminó; el caché llega tarde.
    await new Promise((r) => setTimeout(r, 0));
    cache.resolve("viejo");
    await run;

    expect(seen).toEqual([["fresco", "network"]]);
  });

  it("si la red falla pero había caché, conserva el caché y avisa sin lanzar error", async () => {
    const onRevalidateError = vi.fn();
    const seen: string[] = [];
    const network = deferred<string>();

    const run = staleWhileRevalidate<string>({
      readCache: async () => "guardado",
      fetchFresh: () => network.promise,
      onData: (data) => seen.push(data),
      onRevalidateError
    });

    await new Promise((r) => setTimeout(r, 0));
    network.reject(new Error("sin internet"));

    await expect(run).resolves.toBe("guardado");
    expect(seen).toEqual(["guardado"]);
    expect(onRevalidateError).toHaveBeenCalledTimes(1);
    expect(onRevalidateError.mock.calls[0][1]).toBe(true);
  });

  it("si la red falla y no hay caché, propaga el error (no hay nada que mostrar)", async () => {
    const onData = vi.fn();
    const onRevalidateError = vi.fn();

    await expect(
      staleWhileRevalidate<string>({
        readCache: async () => null,
        fetchFresh: async () => {
          throw new Error("sin internet");
        },
        onData,
        onRevalidateError
      })
    ).rejects.toThrow("sin internet");

    expect(onData).not.toHaveBeenCalled();
    expect(onRevalidateError.mock.calls[0][1]).toBe(false);
  });

  it("un caché que falla al leerse se trata como 'sin caché' y no rompe la carga", async () => {
    const seen: Array<[string, string]> = [];

    const result = await staleWhileRevalidate<string>({
      readCache: async () => {
        throw new Error("IndexedDB no disponible");
      },
      fetchFresh: async () => "fresco",
      onData: (data, source) => seen.push([data, source])
    });

    expect(result).toBe("fresco");
    expect(seen).toEqual([["fresco", "network"]]);
  });

  it("no entrega nada si se canceló (componente desmontado)", async () => {
    const onData = vi.fn();
    let cancelled = false;
    const network = deferred<string>();

    const run = staleWhileRevalidate<string>({
      readCache: async () => "guardado",
      fetchFresh: () => network.promise,
      onData,
      isCancelled: () => cancelled
    });

    await new Promise((r) => setTimeout(r, 0));
    cancelled = true;
    network.resolve("fresco");

    await expect(run).resolves.toBeNull();
    expect(onData).toHaveBeenCalledTimes(1); // solo el caché, que llegó antes de cancelar
    expect(onData).toHaveBeenCalledWith("guardado", "cache");
  });

  it("la red arranca sin esperar al caché (no se suman las esperas)", async () => {
    const order: string[] = [];
    const cache = deferred<string | null>();

    const run = staleWhileRevalidate<string>({
      readCache: () => {
        order.push("cache-start");
        return cache.promise;
      },
      fetchFresh: async () => {
        order.push("network-start");
        return "fresco";
      },
      onData: () => undefined
    });

    expect(order).toEqual(["network-start", "cache-start"]);
    cache.resolve(null);
    await run;
  });
});