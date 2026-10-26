import { describe, it, expect, vi } from "vitest";
import { CachedList, type ListPersistence } from "../../src/infrastructure/cache/CachedList";

interface Item {
  id: string;
  name: string;
}

function memoryPersistence(): ListPersistence<Item> & { store: Map<string, Item[]> } {
  const store = new Map<string, Item[]>();
  return {
    store,
    read: async (businessId) => store.get(businessId) ?? null,
    write: async (businessId, items) => {
      store.set(businessId, [...items]);
    }
  };
}

function setup(overrides: {
  fetchRemote?: () => Promise<Item[]>;
  isOnline?: () => boolean;
  businessId?: { current: string | null };
  ttlMs?: number;
} = {}) {
  const persistence = memoryPersistence();
  const businessId = overrides.businessId ?? { current: "negocio-A" };
  const clock = { now: 1_000 };
  const fetchRemote = vi.fn(overrides.fetchRemote ?? (async () => [{ id: "1", name: "Ana" }]));
  const list = new CachedList<Item>({
    label: "test",
    fetchRemote,
    persistence,
    ttlMs: overrides.ttlMs ?? 15_000,
    getBusinessId: () => businessId.current,
    isOnline: overrides.isOnline ?? (() => true),
    now: () => clock.now
  });
  return { list, fetchRemote, persistence, businessId, clock };
}

describe("CachedList", () => {
  it("dos pantallas que piden la lista a la vez hacen UNA sola petición", async () => {
    const { list, fetchRemote } = setup();
    const [a, b, c] = await Promise.all([list.get(), list.get(), list.getFresh()]);

    expect(fetchRemote).toHaveBeenCalledTimes(1);
    expect(a).toEqual(b);
    expect(b).toEqual(c);
  });

  it("reutiliza la memoria dentro del TTL y vuelve a pedir al vencer", async () => {
    const { list, fetchRemote, clock } = setup({ ttlMs: 15_000 });

    await list.get();
    clock.now += 10_000;
    await list.get();
    expect(fetchRemote).toHaveBeenCalledTimes(1);

    clock.now += 6_000; // 16 s en total
    await list.get();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it("getFresh ignora la memoria y siempre consulta", async () => {
    const { list, fetchRemote } = setup();
    await list.get();
    await list.getFresh();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it("invalidate descarta la memoria", async () => {
    const { list, fetchRemote } = setup();
    await list.get();
    list.invalidate();
    await list.get();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
  });

  it("una respuesta que venía en camino ANTES de invalidar no se guarda como vigente", async () => {
    let call = 0;
    let releaseFirst!: (items: Item[]) => void;
    const { list, persistence } = setup({
      fetchRemote: () => {
        call += 1;
        if (call === 1) return new Promise<Item[]>((resolve) => (releaseFirst = resolve));
        return Promise.resolve([{ id: "2", name: "Después del cambio" }]);
      }
    });

    const first = list.get(); // petición vieja en camino
    list.invalidate(); // alguien escribió algo
    releaseFirst([{ id: "1", name: "Dato viejo" }]);
    await first;
    await new Promise((r) => setTimeout(r, 0));

    // El dato viejo no quedó en disco ni en memoria.
    expect(persistence.store.get("negocio-A")).toBeUndefined();
    const current = await list.get();
    expect(current).toEqual([{ id: "2", name: "Después del cambio" }]);
  });

  it("guarda en disco lo que trae la red y readCached lo entrega sin tocar la red", async () => {
    const { list, fetchRemote, persistence } = setup();
    await list.get();
    await new Promise((r) => setTimeout(r, 0));

    expect(persistence.store.get("negocio-A")).toEqual([{ id: "1", name: "Ana" }]);

    list.invalidate();
    const cached = await list.readCached();
    expect(cached).toEqual([{ id: "1", name: "Ana" }]);
    expect(fetchRemote).toHaveBeenCalledTimes(1);
  });

  it("sin internet responde con el caché de disco sin esperar a la red", async () => {
    const { list, fetchRemote, persistence } = setup({ isOnline: () => false });
    persistence.store.set("negocio-A", [{ id: "9", name: "Guardado" }]);

    await expect(list.get()).resolves.toEqual([{ id: "9", name: "Guardado" }]);
    expect(fetchRemote).not.toHaveBeenCalled();
  });

  it("si la red falla y hay caché, responde con el caché; si no hay, propaga el error", async () => {
    const failing = setup({
      fetchRemote: async () => {
        throw new Error("Supabase caído");
      }
    });
    failing.persistence.store.set("negocio-A", [{ id: "9", name: "Guardado" }]);
    await expect(failing.list.get()).resolves.toEqual([{ id: "9", name: "Guardado" }]);

    const noCache = setup({
      fetchRemote: async () => {
        throw new Error("Supabase caído");
      }
    });
    await expect(noCache.list.get()).rejects.toThrow("Supabase caído");
  });

  it("aísla por negocio: otro negocio no ve la memoria ni el disco del anterior", async () => {
    const { list, fetchRemote, persistence, businessId } = setup();
    await list.get();
    await new Promise((r) => setTimeout(r, 0));

    businessId.current = "negocio-B";
    expect(await list.readCached()).toBeNull();

    await list.get();
    expect(fetchRemote).toHaveBeenCalledTimes(2);
    expect(persistence.store.get("negocio-B")).toBeDefined();
  });

  it("sin negocio activo no guarda nada en disco", async () => {
    const { list, persistence } = setup({ businessId: { current: null } });
    await list.get();
    await new Promise((r) => setTimeout(r, 0));
    expect(persistence.store.size).toBe(0);
    expect(await list.readCached()).toBeNull();
  });
});