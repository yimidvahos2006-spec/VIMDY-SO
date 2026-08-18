import { beforeEach, describe, expect, it, vi } from "vitest";

const mockGetCurrentBusinessId = vi.fn(() => "business-1");
const mockGetCurrentBranchId = vi.fn(() => "branch-1");

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: {},
  setCurrentBusinessId: vi.fn(),
  getCurrentBusinessId: () => mockGetCurrentBusinessId(),
  setCurrentBranchId: vi.fn(),
  getCurrentBranchId: () => mockGetCurrentBranchId()
}));

import { TableEngine } from "../../src/core/engines/TableEngine";
import type { Table, Order } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { OrderEngine } from "../../src/core/engines/OrderEngine";

describe("TableEngine branch scope", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetCurrentBusinessId.mockReturnValue("business-1");
    mockGetCurrentBranchId.mockReturnValue("branch-1");
  });

  it("asigna la sucursal activa al crear una mesa cuando no se pasa una explícita", async () => {
    const repository = new InMemoryRepository<Table>("tables");
    const orders = new InMemoryRepository<Order>("orders");
    const engine = new TableEngine(
      repository as never,
      {} as never,
      {} as never,
      new OrderEngine(orders as never, {} as never, {} as never)
    );

    const created = await engine.createTable({ name: "Mesa 1", capacity: 4 });

    expect(created.branchId).toBe("branch-1");
  });

  it("no mezcla datos entre ramas distintas al persistir", async () => {
    const repository = new InMemoryRepository<Table>("tables");
    const orders = new InMemoryRepository<Order>("orders");
    const engine = new TableEngine(
      repository as never,
      {} as never,
      {} as never,
      new OrderEngine(orders as never, {} as never, {} as never)
    );

    await engine.createTable({ name: "Mesa 1", capacity: 4 });
    mockGetCurrentBranchId.mockReturnValue("branch-2");
    const created = await engine.createTable({ name: "Mesa 2", capacity: 4 });

    expect(created.branchId).toBe("branch-2");
    const all = await repository.findAll();
    expect(all).toHaveLength(2);
    expect(all.map((item) => item.branchId)).toEqual(expect.arrayContaining(["branch-1", "branch-2"]));
  });
});
