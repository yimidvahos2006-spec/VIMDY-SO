import { describe, expect, it } from "vitest";

import type { Sale } from "../../src/core/entities/Entities";
import { DashboardSalesMetricsService } from "../../src/core/dashboard/metrics/DashboardSalesMetricsService";

function makeSale(id: string, createdAt: string, total = 100): Sale {
  return {
    id,
    customerId: "customer-1",
    businessId: "business-1",
    branchId: "branch-1",
    items: [{ productId: "product-1", quantity: 1, price: total }],
    total,
    createdAt: new Date(createdAt),
    updatedAt: new Date(createdAt),
    status: "PAID",
  };
}

describe("DashboardSalesMetricsService historical boundaries", () => {
  it("treats the previous business day as a full day", async () => {
    const sales: Sale[] = [
      makeSale("early-yesterday", "2026-09-23T05:10:00.000Z", 100),
      makeSale("late-yesterday", "2026-09-24T03:30:00.000Z", 200),
      makeSale("today", "2026-09-24T15:00:00.000Z", 300),
    ];

    const service = new DashboardSalesMetricsService({
      async findByDateRange() {
        return sales;
      },
    });

    const result = await service.buildReconciliation(
      new Date("2026-09-24T16:00:00.000Z"),
      "America/Bogota",
    );

    expect(result.yesterday.netSales).toBe(300);
    expect(result.today.netSales).toBe(300);
  });
});
