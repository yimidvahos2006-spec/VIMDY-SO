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
import {
  canLinkAsExtra,
  healOrphanLinkedTables,
  isLinkedAccountActive,
  isOrphanLinkedTable
} from "../../src/core/utils/tableMerge";

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

const base = (over: Partial<Table>): Table =>
  ({
    id: "t", name: "Mesa", capacity: 4, peopleCount: 0, status: "FREE", items: [],
    subtotal: 0, tax: 0, discount: 0, total: 0, updatedAt: new Date(), ...over
  }) as Table;

describe("reglas puras de mesas anexadas", () => {
  it("la principal sostiene a las anexas solo con cuenta abierta", () => {
    expect(isLinkedAccountActive(base({ status: "BUSY" }))).toBe(true);
    expect(isLinkedAccountActive(base({ status: "PAYING" }))).toBe(true);
    expect(isLinkedAccountActive(base({ status: "FREE" }))).toBe(false);
    expect(isLinkedAccountActive(base({ status: "RESERVED" }))).toBe(false);
    expect(isLinkedAccountActive(null)).toBe(false);
  });

  it("solo se anexa una mesa libre, sin unir y distinta de la principal", () => {
    const primary = base({ id: "a", status: "BUSY" });
    expect(canLinkAsExtra(base({ id: "b" }), primary)).toBe(true);
    expect(canLinkAsExtra(base({ id: "a" }), primary)).toBe(false);
    expect(canLinkAsExtra(base({ id: "b", status: "BUSY" }), primary)).toBe(false);
    expect(canLinkAsExtra(base({ id: "b", mergedInto: "z" }), primary)).toBe(false);
    expect(canLinkAsExtra(base({ id: "b", businessId: "x" }), base({ id: "a", businessId: "y" }))).toBe(false);
  });

  it("una anexa cuya principal ya no tiene cuenta es huérfana y se ve libre", () => {
    const extra = base({ id: "b", status: "CLOSED", mergedInto: "a" });
    const freePrimary = base({ id: "a", status: "FREE" });
    const busyPrimary = base({ id: "a", status: "BUSY" });

    expect(isOrphanLinkedTable(extra, freePrimary)).toBe(true);
    expect(isOrphanLinkedTable(extra, null)).toBe(true);
    expect(isOrphanLinkedTable(extra, busyPrimary)).toBe(false);

    const healed = healOrphanLinkedTables([freePrimary, extra]);
    expect(healed[1]).toMatchObject({ status: "FREE", mergedInto: undefined });
    const kept = healOrphanLinkedTables([busyPrimary, extra]);
    expect(kept[1]).toMatchObject({ status: "CLOSED", mergedInto: "a" });
  });
});

describe("TableEngine — unir mesa libre a una mesa abierta", () => {
  let ctx: ReturnType<typeof buildEngine>;
  let a: Table, b: Table, c: Table;

  beforeEach(async () => {
    ctx = buildEngine();
    a = await ctx.engine.createTable({ name: "Mesa 1", zone: "Salón" });
    b = await ctx.engine.createTable({ name: "Mesa 2", zone: "Salón" });
    c = await ctx.engine.createTable({ name: "Mesa 3", zone: "Salón" });
    await ctx.engine.updateTable(a.id, { status: "BUSY", peopleCount: 5 });
  });

  it("anexa las mesas libres elegidas a la principal", async () => {
    const result = await ctx.engine.linkExtraTables(a.id, [b.id, c.id]);
    expect(result.linked.sort()).toEqual([b.id, c.id].sort());
    expect(await ctx.repository.findById(b.id)).toMatchObject({ status: "CLOSED", mergedInto: a.id, peopleCount: 0 });
  });

  it("no anexa una mesa que otra persona ya ocupó y avisa cuál", async () => {
    await ctx.engine.updateTable(b.id, { status: "BUSY" });
    const result = await ctx.engine.linkExtraTables(a.id, [b.id, c.id]);
    expect(result).toEqual({ linked: [c.id], skipped: [b.id] });
    expect((await ctx.repository.findById(b.id))?.mergedInto).toBeUndefined();
  });

  it("exige que la principal tenga la cuenta abierta", async () => {
    await expect(ctx.engine.linkExtraTables(b.id, [c.id])).rejects.toThrow(/TABLE_NOT_OPEN/);
  });

  it("liberar la principal sin consumo libera también las anexas", async () => {
    await ctx.engine.linkExtraTables(a.id, [b.id]);
    await ctx.engine.releaseEmptyTable(a.id);
    expect(await ctx.repository.findById(b.id)).toMatchObject({ status: "FREE", mergedInto: undefined });
  });

  it("releaseLinkedTables deja las anexas libres y reutilizables", async () => {
    await ctx.engine.linkExtraTables(a.id, [b.id, c.id]);
    await ctx.engine.releaseLinkedTables(a.id);
    const all = await ctx.repository.findAll();
    expect(all.filter((t) => t.id !== a.id).every((t) => t.status === "FREE" && !t.mergedInto)).toBe(true);
  });

  it("repointLinkedTables pasa las anexas a la nueva mesa principal", async () => {
    await ctx.engine.linkExtraTables(a.id, [b.id]);
    await ctx.engine.repointLinkedTables(a.id, c.id);
    expect((await ctx.repository.findById(b.id))?.mergedInto).toBe(c.id);
  });

  it("una anexa huérfana se puede volver a unir a otra mesa", async () => {
    await ctx.engine.linkExtraTables(a.id, [b.id]);
    // La principal se libera por fuera (p. ej. el trigger de la base) y b queda huérfana.
    await ctx.engine.updateTable(a.id, { status: "FREE" });
    await ctx.engine.updateTable(c.id, { status: "BUSY", peopleCount: 6 });
    const result = await ctx.engine.linkExtraTables(c.id, [b.id]);
    expect(result.linked).toEqual([b.id]);
    expect((await ctx.repository.findById(b.id))?.mergedInto).toBe(c.id);
  });
});