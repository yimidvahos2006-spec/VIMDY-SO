import { beforeEach, describe, expect, it, vi } from "vitest";

function data(sales: number, orders: number, customers: number) {
  return {
    sales, customers, orders, inventory: 5, todaySales: sales, cashAmount: 0, productsSold: orders, averageTicket: orders > 0 ? sales / orders : 0, pendingKitchen: 0,
    cashStatus: "NO_SHIFT" as const, cashExpectedAmount: null, cashCountedAmount: null, cashDifference: null, cashClosedAt: null,
    inventoryValuationStatus: "COMPLETE" as const, inventoryValueBasis: "PURCHASE_COST" as const, inventoryLowStockCount: 0, inventoryHistoricalValueAvailable: false,
  };
}

describe("dashboardStore — reconciled vs optimistic", () => {
  let dashboardStore: typeof import("../../src/core/store/dashboardStore").dashboardStore;
  beforeEach(async () => { vi.resetModules(); const mod = await import("../../src/core/store/dashboardStore"); dashboardStore = mod.dashboardStore; });

  it("applyReconciled siempre sobrescribe datos optimistas previos", () => {
    dashboardStore.applyReconciled(data(1000, 10, 50), { sales: 800, customers: 40, orders: 8, inventory: 5 }, { sales: [100], customers: [10], orders: [1], inventory: [5] });
    dashboardStore.addSale(500, 3, 999);
    expect(dashboardStore.getData().sales).toBe(1500);
    expect(dashboardStore.getData().cashAmount).toBe(0);
    dashboardStore.applyReconciled(data(1200, 12, 60), { sales: 1100, customers: 55, orders: 11, inventory: 5 }, { sales: [1200], customers: [60], orders: [12], inventory: [null] });
    expect(dashboardStore.getData().sales).toBe(1200);
    expect(dashboardStore.getData().orders).toBe(12);
    expect(dashboardStore.getData().cashAmount).toBe(0);
  });

  it("optimistic updates no sobreviven a una reconciliación posterior", () => {
    dashboardStore.applyReconciled(data(1000, 10, 50), { sales: 800, customers: 40, orders: 8, inventory: 5 }, { sales: [100], customers: [10], orders: [1], inventory: [5] });
    dashboardStore.addSale(100, 1); dashboardStore.addSale(200, 2); dashboardStore.reverseSale(50, 1);
    expect(dashboardStore.getData().sales).toBe(1250);
    dashboardStore.applyReconciled(data(1300, 13, 55), { sales: 1100, customers: 50, orders: 11, inventory: 5 }, { sales: [1300], customers: [55], orders: [13], inventory: [null] });
    expect(dashboardStore.getData().sales).toBe(1300);
    expect(dashboardStore.getData().orders).toBe(13);
  });
});
