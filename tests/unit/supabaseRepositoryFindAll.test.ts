import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({ total: 0, calls: [] as Array<[number, number]>, failAt: -1 }));

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => {
  const makeQuery = () => {
    const q: any = {
      eq: () => q,
      order: () => q,
      range: (from: number, to: number) => {
        state.calls.push([from, to]);
        if (state.calls.length - 1 === state.failAt) {
          return Promise.resolve({ data: null, error: { message: "boom" } });
        }
        const rows = [];
        for (let i = from; i <= to && i < state.total; i += 1) {
          rows.push({ data: { id: `p${i}`, name: `Producto ${i}` }, version: 1 });
        }
        return Promise.resolve({ data: rows, error: null });
      }
    };
    return q;
  };
  return {
    supabase: { from: () => ({ select: () => makeQuery() }) },
    getCurrentBusinessId: () => "biz-1",
    getCurrentBranchId: () => "branch-1"
  };
});

import { SupabaseRepository } from "../../src/infrastructure/di/repositories/SupabaseRepository";

class TestRepo extends SupabaseRepository<{ id: string; name: string; version?: number }> {
  protected readonly tableName = "products";
}

describe("SupabaseRepository.findAll con paginas", () => {
  beforeEach(() => {
    state.total = 0;
    state.calls = [];
    state.failAt = -1;
  });

  it("trae las 2500 filas (no se corta en 1000)", async () => {
    state.total = 2500;
    const all = await new TestRepo().findAll();
    expect(all).toHaveLength(2500);
    expect(new Set(all.map((p) => p.id)).size).toBe(2500);
    expect(state.calls).toEqual([[0, 999], [1000, 1999], [2000, 2999]]);
  });

  it("con exactamente 1000 pide una pagina mas y termina", async () => {
    state.total = 1000;
    const all = await new TestRepo().findAll();
    expect(all).toHaveLength(1000);
    expect(state.calls).toHaveLength(2);
  });

  it("con pocas filas hace una sola consulta", async () => {
    state.total = 5;
    expect(await new TestRepo().findAll()).toHaveLength(5);
    expect(state.calls).toHaveLength(1);
  });

  it("sin filas devuelve lista vacia", async () => {
    expect(await new TestRepo().findAll()).toEqual([]);
  });

  it("si una pagina falla, lanza error y no devuelve lista incompleta", async () => {
    state.total = 2500;
    state.failAt = 1;
    await expect(new TestRepo().findAll()).rejects.toThrow("SUPABASE_FIND_ALL_FAILED");
  });
});
