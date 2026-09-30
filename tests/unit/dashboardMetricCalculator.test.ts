import { describe, expect, it } from "vitest";
import type { Sale } from "../../src/core/entities/Entities";
import {
  calculateClosedBusinessDayMetrics,
  calculateDashboardSalesMetrics,
  calculateDashboardTodayComparison,
} from "../../src/core/dashboard/metrics/DashboardMetricCalculator";

let idCounter = 0;

function sale(partial: Partial<Sale>): Sale {
  const baseDate = new Date("2026-09-24T15:00:00.000Z");
  return {
    id: partial.id ?? `test-sale-${++idCounter}`,
    businessId: "business-1",
    branchId: "branch-1",
    customerId: "customer-1",
    items: partial.items ?? [{ productId: "p1", quantity: 2, price: 100 }],
    total: partial.total ?? 200,
    createdAt: partial.createdAt ?? baseDate,
    updatedAt: partial.updatedAt ?? baseDate,
    status: partial.status ?? "PAID",
    type: partial.type ?? "QUICK",
    ...partial,
  };
}

describe("DashboardMetricCalculator", () => {
  it("calcula ventas netas y no usa sale.total a secas después de un reembolso", () => {
    const createdAt = new Date("2026-09-24T14:00:00.000Z");
    const s = sale({
      id: "sale-refunded",
      createdAt,
      total: 500,
      items: [{ productId: "p1", quantity: 5, price: 100 }],
      refunds: [
        {
          id: "refund-1",
          amount: 200,
          reason: "Devolución",
          createdAt,
          items: [{ productId: "p1", quantity: 2 }],
        },
      ],
    });

    const result = calculateDashboardSalesMetrics({
      sales: [s],
      periodStart: new Date("2026-09-24T00:00:00.000Z"),
      periodEnd: new Date("2026-09-25T00:00:00.000Z"),
      timezone: "America/Bogota",
    });

    expect(result.grossSales).toBe(500);
    expect(result.refundedSales).toBe(200);
    expect(result.netSales).toBe(300);
    expect(result.transactionCount).toBe(1);
    expect(result.unitsSold).toBe(3);
    expect(result.averageTicket).toBe(300);
  });

  it("no cuenta una venta totalmente reembolsada como transacción neta", () => {
    const createdAt = new Date("2026-09-24T14:00:00.000Z");
    const s = sale({
      id: "sale-full-refund",
      createdAt,
      total: 500,
      items: [{ productId: "p1", quantity: 5, price: 100 }],
      refunds: [
        {
          id: "refund-1",
          amount: 500,
          reason: "Devolución total",
          createdAt,
          items: [{ productId: "p1", quantity: 5 }],
        },
      ],
    });

    const result = calculateDashboardSalesMetrics({
      sales: [s],
      periodStart: new Date("2026-09-24T00:00:00.000Z"),
      periodEnd: new Date("2026-09-25T00:00:00.000Z"),
      timezone: "America/Bogota",
    });

    expect(result.netSales).toBe(0);
    expect(result.transactionCount).toBe(0);
    expect(result.unitsSold).toBe(0);
    expect(result.averageTicket).toBeNull();
  });

  it("ignora ventas canceladas y pendientes", () => {
    const createdAt = new Date("2026-09-24T14:00:00.000Z");
    const result = calculateDashboardSalesMetrics({
      sales: [
        sale({ id: "paid", createdAt, total: 100 }),
        sale({ id: "cancelled", createdAt, total: 999, status: "CANCELLED" }),
        sale({ id: "pending", createdAt, total: 999, status: "PENDING_PAYMENT" }),
      ],
      periodStart: new Date("2026-09-24T00:00:00.000Z"),
      periodEnd: new Date("2026-09-25T00:00:00.000Z"),
      timezone: "America/Bogota",
    });

    expect(result.netSales).toBe(100);
    expect(result.transactionCount).toBe(1);
  });

  it("devuelve null para el cambio porcentual cuando el período anterior no tuvo ventas", () => {
    const now = new Date("2026-09-24T15:00:00.000Z");
    const saleBeforeCutoff = new Date("2026-09-24T14:59:59.000Z");
    const result = calculateDashboardTodayComparison(
      [sale({ id: "today", createdAt: saleBeforeCutoff, total: 300 })],
      now,
      "America/Bogota",
    );

    expect(result.current.netSales).toBe(300);
    expect(result.previous.netSales).toBe(0);
    expect(result.netSalesChangePercent).toBeNull();
    expect(result.netSalesChangeAmount).toBe(300);
  });

  it("cierra un día empresarial usando la zona horaria indicada", () => {
    const saleInside = sale({
      id: "inside",
      createdAt: new Date("2026-09-24T05:00:00.000Z"), // 00:00 en America/Bogota
      total: 150,
    });
    const saleOutside = sale({
      id: "outside",
      createdAt: new Date("2026-09-25T05:00:00.000Z"), // siguiente día empresarial
      total: 900,
    });

    const result = calculateClosedBusinessDayMetrics(
      [saleInside, saleOutside],
      new Date("2026-09-24T12:00:00.000Z"),
      "America/Bogota",
    );

    expect(result.netSales).toBe(150);
    expect(result.transactionCount).toBe(1);
  });

  it("rechaza rangos inválidos", () => {
    expect(() =>
      calculateDashboardSalesMetrics({
        sales: [],
        periodStart: new Date("2026-09-25T00:00:00.000Z"),
        periodEnd: new Date("2026-09-24T00:00:00.000Z"),
        timezone: "America/Bogota",
      }),
    ).toThrow("INVALID_PERIOD");
  });
});