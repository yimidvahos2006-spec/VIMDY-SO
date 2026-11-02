import { describe, it, expect, vi, beforeEach } from "vitest";

const state: {
  select: { data: unknown; error: { message: string } | null };
  rpc: { error: { message: string } | null };
  throwOnSelect: boolean;
} = { select: { data: null, error: null }, rpc: { error: null }, throwOnSelect: false };
const rpcCalls: Array<{ fn: string; args: unknown }> = [];
const selectCalls: Array<{ table: string; columns: string; id?: string }> = [];

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {
    from: (table: string) => ({
      select: (columns: string) => ({
        eq: (_c: string, id: string) => ({
          maybeSingle: async () => {
            selectCalls.push({ table, columns, id });
            if (state.throwOnSelect) throw new Error("red caída");
            return state.select;
          },
        }),
      }),
    }),
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return state.rpc;
    },
  },
}));

import { loadBusinessPlanTier, setMainBranch } from "../../src/infrastructure/supabase/branchAdmin";

beforeEach(() => {
  state.select = { data: null, error: null };
  state.rpc = { error: null };
  state.throwOnSelect = false;
  rpcCalls.length = 0;
  selectCalls.length = 0;
});

describe("loadBusinessPlanTier", () => {
  it("lee plan_tier del negocio", async () => {
    state.select = { data: { plan_tier: "multi" }, error: null };
    expect(await loadBusinessPlanTier("biz-1")).toBe("multi");
    expect(selectCalls[0]).toEqual({ table: "businesses", columns: "plan_tier", id: "biz-1" });
  });

  it("ante la duda devuelve el plan de 1 sede (fail-closed)", async () => {
    state.select = { data: { plan_tier: "enterprise" }, error: null };
    expect(await loadBusinessPlanTier("biz-1")).toBe("single");
    state.select = { data: null, error: { message: 'column "plan_tier" does not exist' } };
    expect(await loadBusinessPlanTier("biz-1")).toBe("single");
    state.select = { data: null, error: null };
    expect(await loadBusinessPlanTier("biz-1")).toBe("single");
    state.throwOnSelect = true;
    expect(await loadBusinessPlanTier("biz-1")).toBe("single");
    expect(await loadBusinessPlanTier("  ")).toBe("single");
  });
});

describe("setMainBranch", () => {
  it("llama a la función atómica de la base con el id de la sucursal", async () => {
    await setMainBranch("branch-9");
    expect(rpcCalls).toEqual([{ fn: "set_main_branch", args: { p_branch_id: "branch-9" } }]);
  });

  it("traduce los errores conocidos de la función", async () => {
    state.rpc = { error: { message: "BRANCH_INACTIVE: reactiva la sucursal antes de marcarla como principal." } };
    await expect(setMainBranch("b")).rejects.toThrow("Reactiva la sucursal antes de marcarla como principal.");
    state.rpc = { error: { message: "BRANCH_FORBIDDEN: no tienes permiso" } };
    await expect(setMainBranch("b")).rejects.toThrow("No tienes permiso para cambiar la sucursal principal.");
    state.rpc = { error: { message: "boom" } };
    await expect(setMainBranch("b")).rejects.toThrow("boom");
  });
});