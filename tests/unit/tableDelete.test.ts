import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {},
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: () => "business-1",
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: () => "branch-1"
}));

import { TableEngine } from "../../src/core/engines/TableEngine";
import type { Table, Order } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { OrderEngine } from "../../src/core/engines/OrderEngine";

function buildEngine() {
  const repository = new InMemoryRepository<Table>("tables");
  const orders = new InMemoryRepository<Order>("orders");
  const engine = new TableEngine(
    repository as never,
    {} as never,
    {} as never,
    new OrderEngine(orders as never, {} as never, {} as never)
  );
  return { engine, repository };
}

describe("TableEngine — eliminar mesa y zona", () => {
  let ctx: ReturnType<typeof buildEngine>;

  beforeEach(() => {
    ctx = buildEngine();
  });

  it("elimina una mesa libre", async () => {
    const table = await ctx.engine.createTable({ name: "Mesa 1", zone: "Terraza" });
    await ctx.engine.deleteTable(table.id);
    expect(await ctx.repository.findAll()).toHaveLength(0);
  });

  it("es idempotente si la mesa ya no existe", async () => {
    await expect(ctx.engine.deleteTable("no-existe")).resolves.toBeUndefined();
  });

  it("NO elimina una mesa ocupada", async () => {
    const table = await ctx.engine.createTable({ name: "Mesa 1", zone: "Terraza", status: "BUSY", peopleCount: 3 });
    await expect(ctx.engine.deleteTable(table.id)).rejects.toThrow(/TABLE_DELETE_NOT_FREE/);
    expect(await ctx.repository.findAll()).toHaveLength(1);
  });

  it("elimina toda una zona libre y respeta las otras", async () => {
    await ctx.engine.createTable({ name: "Mesa 1", zone: "Terraza" });
    await ctx.engine.createTable({ name: "Mesa 2", zone: "Terraza" });
    await ctx.engine.createTable({ name: "Mesa 3", zone: "VIP" });

    const removed = await ctx.engine.deleteZone("terraza");

    expect(removed).toBe(2);
    const left = await ctx.repository.findAll();
    expect(left.map((t) => t.name)).toEqual(["Mesa 3"]);
  });

  it("NO elimina una zona con una mesa ocupada y no borra nada a medias", async () => {
    await ctx.engine.createTable({ name: "Mesa 1", zone: "Terraza" });
    await ctx.engine.createTable({ name: "Mesa 2", zone: "Terraza", status: "CUENTA_SOLICITADA", peopleCount: 2 });

    await expect(ctx.engine.deleteZone("Terraza")).rejects.toThrow(/ZONE_HAS_OCCUPIED_TABLES/);
    expect(await ctx.repository.findAll()).toHaveLength(2);
  });
});