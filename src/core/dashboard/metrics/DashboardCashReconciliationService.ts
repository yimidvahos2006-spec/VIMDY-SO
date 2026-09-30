import type { Shift } from "../../entities/Entities";
import { getBusinessDateKey } from "../../utils/businessTime";
import type { DashboardCashDayStatus, DashboardCashReconciliation } from "./DashboardCashReconciliationTypes";

export interface DashboardShiftSource { findAll(): Promise<Shift[]>; }

function finiteOrNull(value: number | undefined): number | null {
  return value !== undefined && Number.isFinite(value) ? value : null;
}

function strictSum(shifts: readonly Shift[], getter: (shift: Shift) => number | undefined): number | null {
  if (shifts.length === 0) return null;
  let total = 0;
  for (const shift of shifts) {
    const value = getter(shift);
    if (value === undefined || !Number.isFinite(value)) return null;
    total += value;
  }
  return total;
}

function normalizeShiftDates(shifts: readonly Shift[]): Shift[] {
  return shifts.map((shift) => ({
    ...shift,
    openedAt: shift.openedAt instanceof Date ? new Date(shift.openedAt.getTime()) : new Date(shift.openedAt),
    closedAt: shift.closedAt instanceof Date ? new Date(shift.closedAt.getTime()) : shift.closedAt ? new Date(shift.closedAt) : undefined,
  }));
}

function sortByClosedTimeDesc(shifts: readonly Shift[]): Shift[] {
  return [...shifts].sort((a, b) => (b.closedAt?.getTime() ?? 0) - (a.closedAt?.getTime() ?? 0));
}

function normalizeIncomeByMethod(shifts: readonly Shift[]): Readonly<Record<string, number>> {
  const result: Record<string, number> = {};
  for (const shift of shifts) {
    for (const [method, amount] of Object.entries(shift.incomeByMethod ?? {})) {
      if (!Number.isFinite(amount)) continue;
      result[method] = (result[method] ?? 0) + amount;
    }
  }
  return result;
}

function resolveStatus(openCount: number, closedCount: number): DashboardCashDayStatus {
  if (openCount > 0) return "OPEN";
  if (closedCount > 0) return "CLOSED";
  return "NO_SHIFT";
}

export class DashboardCashReconciliationService {
  constructor(private readonly source: DashboardShiftSource) {}

  public async buildReconciliation(params: {
    now?: Date;
    timezone: string;
    businessId?: string;
    branchId?: string;
  }): Promise<DashboardCashReconciliation> {
    const now = params.now ?? new Date();
    if (Number.isNaN(now.getTime())) throw new Error("INVALID_NOW: now no es una fecha válida.");
    try { new Intl.DateTimeFormat("en-GB", { timeZone: params.timezone }).format(now); }
    catch { throw new Error(`INVALID_TIMEZONE: ${params.timezone}`); }

    const allShifts = normalizeShiftDates(await this.source.findAll());
    const scoped = allShifts.filter((shift) => {
      if (params.businessId && shift.businessId && shift.businessId !== params.businessId) return false;
      if (params.branchId && shift.branchId && shift.branchId !== params.branchId) return false;
      if (shift.status === "CLOSED") {
        return !!shift.closedAt && getBusinessDateKey(shift.closedAt, params.timezone) === getBusinessDateKey(now, params.timezone);
      }
      if (shift.status === "OPEN") {
        return getBusinessDateKey(shift.openedAt, params.timezone) === getBusinessDateKey(now, params.timezone);
      }
      return false;
    });

    const closed = sortByClosedTimeDesc(scoped.filter((shift) => shift.status === "CLOSED" && shift.closedAt));
    const open = [...scoped.filter((shift) => shift.status === "OPEN")].sort((a, b) => b.openedAt.getTime() - a.openedAt.getTime());
    const latestClosedShift = closed[0] ?? null;
    const openShift = open[0] ?? null;

    const totalIncome = strictSum(closed, (shift) => shift.totalIncome);
    const totalCashIncome = strictSum(closed, (shift) => shift.totalCashIncome);
    const totalExpense = strictSum(closed, (shift) => shift.totalExpense);
    const closingExpectedAmount = latestClosedShift ? finiteOrNull(latestClosedShift.expectedAmount) : null;
    const closingCountedAmount = latestClosedShift ? finiteOrNull(latestClosedShift.countedAmount) : null;
    const closingDifference = latestClosedShift ? finiteOrNull(latestClosedShift.difference) : null;
    const closingDataComplete = latestClosedShift !== null && closingExpectedAmount !== null && closingCountedAmount !== null && closingDifference !== null;

    return {
      status: resolveStatus(open.length, closed.length),
      generatedAt: new Date(now.getTime()),
      timezone: params.timezone,
      shiftCount: scoped.length,
      closedShiftCount: closed.length,
      openShiftCount: open.length,
      latestClosedShift,
      openShift,
      totalIncome,
      totalCashIncome,
      totalExpense,
      incomeByMethod: normalizeIncomeByMethod(closed),
      closingExpectedAmount,
      closingCountedAmount,
      closingDifference,
      closingDataComplete,
    };
  }

  public static getBusinessDayKey(now: Date, timezone: string): string {
    return getBusinessDateKey(now, timezone);
  }
}
