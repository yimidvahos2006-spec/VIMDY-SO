import { describe, expect, it } from "vitest";
import type { DashboardData, DashboardSnapshot } from "../../src/core/store/dashboardStore";

const baseData: DashboardData = {
  sales: 100,
  customers: 2,
  orders: 4,
  inventory: 500,
  todaySales: 100,
  cashAmount: 80,
  productsSold: 5,
  averageTicket: 25,
  pendingKitchen: 0,
  cashStatus: "CLOSED",
  cashExpectedAmount: 82,
  cashCountedAmount: 80,
  cashDifference: -2,
  cashClosedAt: "2026-09-24T20:00:00.000Z",
  inventoryValuationStatus: "COMPLETE",
  inventoryValueBasis: "PURCHASE_COST",
  inventoryLowStockCount: 1,
  inventoryHistoricalValueAvailable: false,
};

describe("Dashboard operational metadata", () => {
  it("permite representar un cierre de caja real sin convertirlo en saldo genérico", () => {
    expect(baseData.cashStatus).toBe("CLOSED");
    expect(baseData.cashExpectedAmount).toBe(82);
    expect(baseData.cashCountedAmount).toBe(80);
    expect(baseData.cashDifference).toBe(-2);
  });

  it("no representa un histórico de inventario inexistente como números reales", () => {
    const snapshot: DashboardSnapshot = {
      data: baseData,
      yesterday: { sales: 90, customers: 1, orders: 3, inventory: null },
      history: {
        sales: [70, 80, 90, 100],
        customers: [1, 1, 2, 2],
        orders: [2, 3, 3, 4],
        inventory: [null, null, null, null],
      },
    };

    expect(snapshot.yesterday.inventory).toBeNull();
    expect(snapshot.history.inventory.every((value) => value === null)).toBe(true);
  });
});
