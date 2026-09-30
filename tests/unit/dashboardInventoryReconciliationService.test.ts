import { describe, expect, it } from "vitest";
import type { Product } from "../../src/core/entities/Entities";
import { DashboardInventoryReconciliationService } from "../../src/core/dashboard/metrics/DashboardInventoryReconciliationService";

function product(overrides: Partial<Product>): Product {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: overrides.name ?? "Producto",
    categoryId: "cat-1",
    price: 100,
    stock: 10,
    minStock: 2,
    lastUpdated: new Date("2026-09-24T10:00:00.000Z"),
    businessId: "business-1",
    branchId: "branch-1",
    ...overrides,
  };
}

describe("DashboardInventoryReconciliationService", () => {
  it("calcula valor actual a costo solo cuando todos los productos controlados tienen costo", async () => {
    const service = new DashboardInventoryReconciliationService({
      async listAll() {
        return [
          product({ id: "p1", stock: 10, purchasePrice: 30 }),
          product({ id: "p2", stock: 4, purchasePrice: 50, minStock: 5 }),
          product({ id: "service", trackStock: false, stock: 0 }),
        ];
      },
    });

    const result = await service.buildReconciliation(new Date("2026-09-24T18:00:00.000Z"));

    expect(result.trackedProductCount).toBe(2);
    expect(result.stockCostValue).toBe(500);
    expect(result.valuationStatus).toBe("COMPLETE");
    expect(result.lowStockCount).toBe(1);
    expect(result.historicalValueAvailable).toBe(false);
  });

  it("no inventa una valoración total cuando falta costo de un producto", async () => {
    const service = new DashboardInventoryReconciliationService({
      async listAll() {
        return [
          product({ id: "p1", stock: 10, purchasePrice: 30 }),
          product({ id: "p2", stock: 4, purchasePrice: undefined }),
        ];
      },
    });

    const result = await service.buildReconciliation(new Date("2026-09-24T18:00:00.000Z"));

    expect(result.valuationStatus).toBe("INCOMPLETE");
    expect(result.stockCostValue).toBeNull();
    expect(result.unvaluedProductCount).toBe(1);
  });
});
