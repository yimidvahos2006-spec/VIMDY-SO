import { describe, it, expect } from "vitest";

import { Product } from "../../src/core/entities/Entities";
import { InventoryEngine } from "../../src/core/engines/InventoryEngine";
import { KardexEngine } from "../../src/core/engines/KardexEngine";
import { FakeProductRepository } from "../fakes/FakeProductRepository";
import { InMemoryRepository } from "../fakes/InMemoryRepository";
import { setCurrentBusinessId, setCurrentBranchId } from "../../src/infrastructure/supabase/supabaseClient";

function buildInventory() {
  const repository = new FakeProductRepository();
  const kardex = new KardexEngine(new InMemoryRepository("inventory_movements"));
  const inventory = new InventoryEngine(repository, kardex);
  return { inventory, repository };
}

describe("Smoke: aislamiento multi-tenant y multi-sucursal", () => {
  it("no mezcla stock entre negocios ni sucursales", async () => {
    setCurrentBusinessId("business-a");
    setCurrentBranchId("branch-a");

    const { inventory, repository } = buildInventory();

    const productA: Product = {
      id: "product-a",
      name: "Producto A",
      categoryId: "cat-a",
      price: 1000,
      stock: 10,
      minStock: 0,
      lastUpdated: new Date(),
      active: true
    };

    await repository.save(productA);

    await inventory.decreaseStock(productA.id, 2, "Venta A", "cashier-a", undefined, "move-a");

    const productAAfter = await repository.findById(productA.id);
    expect(productAAfter?.stock).toBe(8);

    setCurrentBusinessId("business-b");
    setCurrentBranchId("branch-b");

    const productB: Product = {
      id: "product-b",
      name: "Producto B",
      categoryId: "cat-b",
      price: 1000,
      stock: 10,
      minStock: 0,
      lastUpdated: new Date(),
      active: true
    };

    await repository.save(productB);

    await inventory.decreaseStock(productB.id, 1, "Venta B", "cashier-b", undefined, "move-b");

    const productAAfterSwitch = await repository.findById(productA.id);
    const productBAfterSwitch = await repository.findById(productB.id);

    expect(productAAfterSwitch?.stock).toBe(8);
    expect(productBAfterSwitch?.stock).toBe(9);
  });
});
