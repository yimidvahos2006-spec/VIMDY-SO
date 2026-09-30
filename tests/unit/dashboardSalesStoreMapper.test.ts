import { describe, expect, it } from "vitest";

import { mapSalesReconciliationToDashboard } from "../../src/core/dashboard/metrics/DashboardSalesStoreMapper";
import type { DashboardSalesReconciliation } from "../../src/core/dashboard/metrics/DashboardSalesReconciliationTypes";
import type { DashboardCashReconciliation } from "../../src/core/dashboard/metrics/DashboardCashReconciliationTypes";
import type { DashboardInventoryReconciliation } from "../../src/core/dashboard/metrics/DashboardInventoryReconciliationTypes";

function salesReconciliation(): DashboardSalesReconciliation {
  const start = new Date("2026-09-24T05:00:00.000Z");
  const end = new Date("2026-09-24T16:00:00.000Z");
  const period = {
    grossSales: 100,
    refundedSales: 10,
    netSales: 90,
    transactionCount: 3,
    unitsSold: 4,
    averageTicket: 30,
    periodStart: start,
    periodEnd: end,
    timezone: "America/Bogota",
  };
  return {
    today: period,
    yesterday: { ...period, netSales: 80, transactionCount: 2, averageTicket: 40 },
    comparable: {
      current: period,
      previous: { ...period, netSales: 70, transactionCount: 2, averageTicket: 35 },
      netSalesChangePercent: 28.57,
      netSalesChangeAmount: 20,
      transactionCountChangePercent: 50,
    },
    history: [period],
    generatedAt: new Date("2026-09-24T16:00:00.000Z"),
    timezone: "America/Bogota",
  };
}

const cash: DashboardCashReconciliation = {
  status: "CLOSED",
  generatedAt: new Date("2026-09-24T16:00:00.000Z"),
  timezone: "America/Bogota",
  shiftCount: 1,
  closedShiftCount: 1,
  openShiftCount: 0,
  latestClosedShift: {
    id: "shift-1",
    openingAmount: 100,
    totalIncome: 500,
    totalCashIncome: 400,
    totalExpense: 0,
    expectedAmount: 500,
    countedAmount: 500,
    difference: 0,
    openedAt: new Date("2026-09-24T12:00:00.000Z"),
    closedAt: new Date("2026-09-24T16:00:00.000Z"),
  } as never,
  openShift: null,
  totalIncome: 500,
  totalCashIncome: 400,
  totalExpense: 0,
  incomeByMethod: { CASH: 400 },
  closingExpectedAmount: 500,
  closingCountedAmount: 500,
  closingDifference: 0,
  closingDataComplete: true,
};

const inventory: DashboardInventoryReconciliation = {
  generatedAt: new Date("2026-09-24T16:00:00.000Z"),
  trackedProductCount: 3,
  valuedProductCount: 3,
  unvaluedProductCount: 0,
  totalStockUnits: 40,
  lowStockCount: 1,
  stockCostValue: 1250,
  valuationStatus: "COMPLETE",
  historicalValueAvailable: false,
};

describe("mapSalesReconciliationToDashboard", () => {
  it("preserves comparable-period references and uses purchase cost as the only inventory valuation basis", () => {
    const mapped = mapSalesReconciliationToDashboard(
      salesReconciliation(),
      cash,
      2,
      1,
      [1],
      999999,
      inventory,
      0,
    );

    expect(mapped.data.sales).toBe(90);
    expect(mapped.data.salesComparablePrevious).toBe(70);
    expect(mapped.data.transactionsComparablePrevious).toBe(2);
    expect(mapped.data.averageSaleComparablePrevious).toBe(35);
    expect(mapped.data.comparisonGeneratedAt).toBe("2026-09-24T16:00:00.000Z");
    expect(mapped.data.inventory).toBe(1250);
    expect(mapped.data.inventoryValueBasis).toBe("PURCHASE_COST");
    expect(mapped.data.inventoryHistoricalValueAvailable).toBe(false);
  });
});
