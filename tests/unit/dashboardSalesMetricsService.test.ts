import { describe, expect, it } from "vitest";

import type { Sale } from "../../src/core/entities/Entities";
import { DashboardSalesMetricsService } from "../../src/core/dashboard/metrics/DashboardSalesMetricsService";

function sale(overrides: Partial<Sale>): Sale {
  const createdAt = overrides.createdAt ?? new Date("2026-09-24T15:00:00.000Z");
  return {
    id: overrides.id ?? crypto.randomUUID(),
    customerId: overrides.customerId ?? "customer-1",
    items:
      overrides.items ?? [
        {
          productId: "product-1",
          quantity: 1,
          price: 100,
        },
      ],
    total: overrides.total ?? 100,
    createdAt,
    updatedAt: overrides.updatedAt ?? createdAt,
    status: overrides.status ?? "PAID",
    businessId: "business-1",
    branchId: "branch-1",
    refunds: overrides.refunds,
  };
}

describe("DashboardSalesMetricsService", () => {
  it("usa una sola lectura y calcula ventas netas con reembolsos", async () => {
    let calls = 0;
    const source = {
      async findByDateRange() {
        calls += 1;
        return [
          sale({
            id: "sale-1",
            total: 100,
            createdAt: new Date("2026-09-24T15:00:00.000Z"),
            refunds: [
              {
                id: "refund-1",
                amount: 20,
                reason: "devolución",
                items: [{ productId: "product-1", quantity: 1 }],
                createdAt: new Date("2026-09-24T15:10:00.000Z"),
              },
            ],
          }),
          sale({
            id: "sale-2",
            total: 200,
            createdAt: new Date("2026-09-23T15:00:00.000Z"),
          }),
        ];
      },
    };

    const service = new DashboardSalesMetricsService(source);
    const result = await service.buildReconciliation(
      new Date("2026-09-24T16:00:00.000Z"),
      "America/Bogota",
    );

    expect(calls).toBe(1);
    expect(result.today.netSales).toBe(80);
    expect(result.today.refundedSales).toBe(20);
    expect(result.today.transactionCount).toBe(1);
    expect(result.yesterday.netSales).toBe(200);
    expect(result.history).toHaveLength(14);
  });

  it("rechaza fechas inválidas y zonas horarias inválidas", async () => {
    const service = new DashboardSalesMetricsService({
      async findByDateRange() {
        return [];
      },
    });

    await expect(
      service.buildReconciliation(new Date("invalid"), "America/Bogota"),
    ).rejects.toThrow("INVALID_NOW");

    await expect(
      service.buildReconciliation(new Date("2026-09-24T16:00:00.000Z"), "Invalid/Timezone"),
    ).rejects.toThrow("INVALID_TIMEZONE");
  });
});
