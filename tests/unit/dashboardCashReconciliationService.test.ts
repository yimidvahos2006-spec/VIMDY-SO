import { describe, expect, it } from "vitest";
import type { Shift } from "../../src/core/entities/Entities";
import { DashboardCashReconciliationService } from "../../src/core/dashboard/metrics/DashboardCashReconciliationService";

function shift(overrides: Partial<Shift>): Shift { return { id: overrides.id ?? crypto.randomUUID(), businessId: "business-1", branchId: "branch-1", cashierId: "cashier-1", status: "CLOSED", openingAmount: 100, openedAt: new Date("2026-09-24T10:00:00.000Z"), ...overrides }; }

describe("DashboardCashReconciliationService", () => {
  it("usa el último cierre físico sin sumar conteos entre turnos", async () => {
    const service = new DashboardCashReconciliationService({ async findAll() { return [
      shift({ id: "shift-1", totalIncome: 300, totalCashIncome: 300, totalExpense: 20, expectedAmount: 380, countedAmount: 375, difference: -5, closedAt: new Date("2026-09-24T16:00:00.000Z") }),
      shift({ id: "shift-2", openingAmount: 375, totalIncome: 250, totalCashIncome: 200, totalExpense: 25, expectedAmount: 550, countedAmount: 550, difference: 0, closedAt: new Date("2026-09-24T22:00:00.000Z") }),
    ]; } });
    const result = await service.buildReconciliation({ now: new Date("2026-09-24T23:00:00.000Z"), timezone: "America/Bogota", businessId: "business-1", branchId: "branch-1" });
    expect(result.status).toBe("CLOSED"); expect(result.closedShiftCount).toBe(2); expect(result.totalIncome).toBe(550); expect(result.totalCashIncome).toBe(500); expect(result.totalExpense).toBe(45); expect(result.closingExpectedAmount).toBe(550); expect(result.closingCountedAmount).toBe(550); expect(result.closingDifference).toBe(0); expect(result.latestClosedShift?.id).toBe("shift-2");
  });

  it("incluye un turno abierto de hoy", async () => {
    const service = new DashboardCashReconciliationService({ async findAll() { return [shift({ id: "open-shift", status: "OPEN", openedAt: new Date("2026-09-24T14:00:00.000Z"), closedAt: undefined, totalIncome: undefined, totalCashIncome: undefined, totalExpense: undefined, expectedAmount: undefined, countedAmount: undefined, difference: undefined })]; } });
    const result = await service.buildReconciliation({ now: new Date("2026-09-24T18:00:00.000Z"), timezone: "America/Bogota", businessId: "business-1", branchId: "branch-1" });
    expect(result.status).toBe("OPEN"); expect(result.openShift?.id).toBe("open-shift"); expect(result.closingDataComplete).toBe(false); expect(result.closingCountedAmount).toBeNull();
  });

  it("asigna al día del cierre un turno que abrió la noche anterior", async () => {
    const service = new DashboardCashReconciliationService({ async findAll() { return [shift({ id: "overnight", openedAt: new Date("2026-09-23T23:30:00.000Z"), closedAt: new Date("2026-09-24T05:30:00.000Z"), totalIncome: 100, totalCashIncome: 100, totalExpense: 0, expectedAmount: 200, countedAmount: 200, difference: 0 })]; } });
    const result = await service.buildReconciliation({ now: new Date("2026-09-24T06:00:00.000Z"), timezone: "America/Bogota", businessId: "business-1", branchId: "branch-1" });
    expect(result.status).toBe("CLOSED"); expect(result.latestClosedShift?.id).toBe("overnight");
  });
});