import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "../../src/core/entities/Entities";

/**
 * Slice 1 (Fase 2): la Caja (productCatalogStore) se actualiza sola cuando la
 * revalidación en segundo plano trae algo distinto (evento "inventory").
 */

const h = vi.hoisted(() => ({ listAll: vi.fn() }));

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  productsReady: Promise.resolve(),
  container: { inventoryEngine: { get: () => ({ listAll: h.listAll }) } }
}));
vi.mock("../../src/infrastructure/logging/opsLogger", () => ({ logWarning: vi.fn() }));

import { productCatalogStore } from "../../src/core/store/productCatalogStore";
import { vimdyCore } from "../../src/core/VimdyCore";

const p = (id: string, stock: number): Product =>
  ({ id, name: id, stock, price: 1000, categoryId: "c", active: true }) as unknown as Product;

const flush = async () => {
  for (let i = 0; i < 20; i += 1) await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((res) => (resolve = res));
  return { promise, resolve };
}

describe("productCatalogStore — se actualiza con el evento inventory", () => {
  beforeEach(async () => {
    productCatalogStore.reset();
    h.listAll.mockReset();
  });

  it("antes de cargar no hace nada con el evento", async () => {
    vimdyCore.emit("inventory", { source: "cache-refresh" });
    await flush();
    expect(h.listAll).not.toHaveBeenCalled();
  });

  it("tras cargar, un evento vuelve a leer el catálogo y publica lo nuevo", async () => {
    h.listAll.mockResolvedValueOnce([p("a", 10)]);
    await productCatalogStore.init();
    expect(productCatalogStore.getById("a")?.stock).toBe(10);

    h.listAll.mockResolvedValueOnce([p("a", 7)]);
    vimdyCore.emit("inventory", { source: "cache-refresh" });
    await flush();
    expect(productCatalogStore.getById("a")?.stock).toBe(7);
  });

  it("una ráfaga de eventos se resuelve sin lecturas simultáneas (máximo 1 más en cola)", async () => {
    h.listAll.mockResolvedValueOnce([p("a", 10)]);
    await productCatalogStore.init();

    const callsAfterInit = h.listAll.mock.calls.length;
    const gate = deferred<Product[]>();
    let running = 0;
    let maxRunning = 0;
    h.listAll.mockImplementation(async () => {
      running += 1;
      maxRunning = Math.max(maxRunning, running);
      try {
        return await gate.promise;
      } finally {
        running -= 1;
      }
    });

    for (let i = 0; i < 6; i += 1) vimdyCore.emit("inventory", { source: "cache-refresh" });
    await flush();
    gate.resolve([p("a", 3)]);
    await flush();
    await flush();

    expect(maxRunning).toBe(1);
    // 6 eventos -> 1 lectura en curso + como mucho 1 repetición en cola (no 6).
    expect(h.listAll.mock.calls.length - callsAfterInit).toBeLessThanOrEqual(2);
    expect(productCatalogStore.getById("a")?.stock).toBe(3);
  });

  it("si la lectura falla, conserva el catálogo que ya tenía", async () => {
    h.listAll.mockResolvedValueOnce([p("a", 10)]);
    await productCatalogStore.init();

    h.listAll.mockRejectedValueOnce(new Error("boom"));
    vimdyCore.emit("inventory", { source: "cache-refresh" });
    await flush();
    expect(productCatalogStore.getById("a")?.stock).toBe(10);
  });

  it("tras reset() (cambio de negocio) el evento ya no repuebla el catálogo", async () => {
    h.listAll.mockResolvedValueOnce([p("a", 10)]);
    await productCatalogStore.init();
    productCatalogStore.reset();
    h.listAll.mockResolvedValue([p("a", 99)]);

    vimdyCore.emit("inventory", { source: "cache-refresh" });
    await flush();
    expect(productCatalogStore.getById("a")).toBeUndefined();
  });
});