import { beforeEach, describe, expect, it, vi } from "vitest";

const store = new Map<string, any>();

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {},
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: () => "business-1",
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: () => "branch-1"
}));

vi.mock("../../src/infrastructure/di/repositories/TableLocalRepository", () => ({
  TableLocalRepository: class {
    async findAll() { return [...store.values()]; }
    async findById(id: string) { return store.get(id) ?? null; }
    async save(item: any) { store.set(item.id, item); }
    async saveMany(items: any[]) { items.forEach((i) => store.set(i.id, i)); }
    async replaceAll(items: any[]) { store.clear(); items.forEach((i) => store.set(i.id, i)); }
    async delete(id: string) { store.delete(id); }
    async deleteMany(ids: string[]) { ids.forEach((id) => store.delete(id)); }
  }
}));

vi.mock("../../src/core/store/connectionStore", () => ({ connectionStore: { isOnline: () => true } }));

import { TableRepository } from "../../src/infrastructure/di/repositories/TableRepository";
import { SupabaseRepository } from "../../src/infrastructure/di/repositories/SupabaseRepository";
import { vimdyCore } from "../../src/core/VimdyCore";

const table = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, name: `Mesa ${id}`, capacity: 4, peopleCount: 0, status: "FREE", items: [], subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date(1000), ...extra }) as any;

describe("TableRepository — la caché local se actualiza al guardar", () => {
  let repo: TableRepository;

  beforeEach(() => {
    store.clear();
    vi.restoreAllMocks();
    repo = new TableRepository();
    vi.spyOn(SupabaseRepository.prototype, "findAll").mockResolvedValue([]);
  });

  it("save: la mesa nueva aparece en findAll sin recargar", async () => {
    vi.spyOn(SupabaseRepository.prototype, "save").mockResolvedValue();
    await repo.save(table("1"));
    expect((await repo.findAll()).map((t) => t.id)).toEqual(["1"]);
  });

  it("save: si Supabase falla, la caché no se toca", async () => {
    vi.spyOn(SupabaseRepository.prototype, "save").mockRejectedValue(new Error("SUPABASE_SAVE_FAILED"));
    await expect(repo.save(table("1"))).rejects.toThrow();
    expect(store.size).toBe(0);
  });

  it("saveMany: todas las mesas de una zona nueva aparecen de inmediato", async () => {
    vi.spyOn(SupabaseRepository.prototype, "saveMany").mockResolvedValue();
    await repo.saveMany([table("1"), table("2"), table("3")]);
    expect(store.size).toBe(3);
  });

  it("update: la copia local queda con la versión +1 que deja la nube", async () => {
    vi.spyOn(SupabaseRepository.prototype, "update").mockResolvedValue();
    await repo.update(table("1", { version: 3, status: "BUSY" }));
    expect(store.get("1")).toMatchObject({ status: "BUSY", version: 4 });
  });

  it("update: si Supabase falla, la caché conserva lo anterior", async () => {
    store.set("1", table("1", { version: 3 }));
    vi.spyOn(SupabaseRepository.prototype, "update").mockRejectedValue(new Error("lock"));
    await expect(repo.update(table("1", { version: 3, status: "BUSY" }))).rejects.toThrow();
    expect(store.get("1").status).toBe("FREE");
  });

  it("findAll: si otro dispositivo cambió algo, refresca la caché y avisa una sola vez", async () => {
    const emit = vi.spyOn(vimdyCore, "emit");
    store.set("1", table("1", { version: 1 }));
    vi.spyOn(SupabaseRepository.prototype, "findAll").mockResolvedValue([table("1", { version: 1 }), table("2", { version: 1 })]);

    const first = await repo.findAll();
    expect(first).toHaveLength(1); // responde con la caché
    await vi.waitFor(() => expect(store.size).toBe(2));
    await vi.waitFor(() => expect(emit).toHaveBeenCalledWith("table", expect.objectContaining({ source: "cache-refresh" })));

    emit.mockClear();
    await repo.findAll(); // ya coincide: no emite de nuevo (sin bucle)
    await new Promise((r) => setTimeout(r, 20));
    expect(emit).not.toHaveBeenCalled();
  });

  it("findAll: un refresco en vuelo no borra una mesa guardada durante ese refresco", async () => {
    vi.spyOn(SupabaseRepository.prototype, "save").mockResolvedValue();
    let release: (v: any[]) => void = () => {};
    vi.spyOn(SupabaseRepository.prototype, "findAll").mockReturnValue(new Promise((r) => (release = r)));

    await repo.findAll();            // arranca el refresco (aún sin respuesta)
    await repo.save(table("9"));     // el usuario crea una mesa mientras tanto
    release([]);                     // la nube responde con la foto vieja
    await new Promise((r) => setTimeout(r, 20));

    expect(store.has("9")).toBe(true);
  });
});