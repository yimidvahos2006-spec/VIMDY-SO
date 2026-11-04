import { describe, expect, it } from "vitest";

import {
  filterByBranchScope,
  formatMonthLabel,
  formatShortDate,
  monthKeyOfDate,
  monthRange,
  shiftMonth,
  sortFixedExpenses,
  summarizeFixedExpenses
} from "../../src/core/domain/accounting/fixedExpenseSummary";
import type { FixedExpense } from "../../src/core/types/fixedExpense";

const expense = (over: Partial<FixedExpense>): FixedExpense => ({
  id: "e",
  businessId: "b1",
  branchId: null,
  category: "otros",
  amount: 1000,
  expenseDate: "2026-11-03",
  description: "",
  createdAt: "2026-11-03T12:00:00Z",
  ...over
});

describe("meses", () => {
  it("monthRange cubre del día 1 al último (incluye bisiesto y diciembre)", () => {
    expect(monthRange("2026-11")).toEqual({ from: "2026-11-01", to: "2026-11-30" });
    expect(monthRange("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
    expect(monthRange("2026-12")).toEqual({ from: "2026-12-01", to: "2026-12-31" });
  });

  it("shiftMonth cruza años en ambos sentidos", () => {
    expect(shiftMonth("2026-01", -1)).toBe("2025-12");
    expect(shiftMonth("2026-12", 1)).toBe("2027-01");
    expect(shiftMonth("2026-11", -12)).toBe("2025-11");
  });

  it("rechaza meses inválidos", () => {
    expect(() => monthRange("2026-13")).toThrow();
    expect(() => shiftMonth("nov", 1)).toThrow();
  });

  it("monthKeyOfDate y etiquetas no dependen de la zona horaria del dispositivo", () => {
    expect(monthKeyOfDate("2026-11-30")).toBe("2026-11");
    expect(formatMonthLabel("2026-11")).toBe("noviembre de 2026");
    expect(formatShortDate("2026-11-01")).toBe("1 nov");
  });
});

describe("summarizeFixedExpenses", () => {
  it("suma total, por categoría y encuentra la mayor", () => {
    const s = summarizeFixedExpenses([
      expense({ category: "arriendo", amount: 2_000_000 }),
      expense({ category: "servicios", amount: 300_000 }),
      expense({ category: "servicios", amount: 150_000 })
    ]);
    expect(s.total).toBe(2_450_000);
    expect(s.count).toBe(3);
    expect(s.byCategory.servicios).toEqual({ total: 450_000, count: 2 });
    expect(s.byCategory.nomina).toEqual({ total: 0, count: 0 });
    expect(s.topCategory).toBe("arriendo");
  });

  it("sin gastos: ceros y sin categoría mayor", () => {
    const s = summarizeFixedExpenses([]);
    expect(s.total).toBe(0);
    expect(s.topCategory).toBeNull();
  });
});

describe("orden y alcance de sucursal", () => {
  it("ordena por fecha del gasto y luego por registro, más reciente primero", () => {
    const sorted = sortFixedExpenses([
      expense({ id: "a", expenseDate: "2026-11-01" }),
      expense({ id: "b", expenseDate: "2026-11-05", createdAt: "2026-11-05T08:00:00Z" }),
      expense({ id: "c", expenseDate: "2026-11-05", createdAt: "2026-11-05T09:00:00Z" })
    ]);
    expect(sorted.map((e) => e.id)).toEqual(["c", "b", "a"]);
  });

  it("filterByBranchScope: undefined = todo, null = globales, id = esa sucursal", () => {
    const list = [expense({ id: "g" }), expense({ id: "s1", branchId: "x" }), expense({ id: "s2", branchId: "y" })];
    expect(filterByBranchScope(list, undefined)).toHaveLength(3);
    expect(filterByBranchScope(list, null).map((e) => e.id)).toEqual(["g"]);
    expect(filterByBranchScope(list, "x").map((e) => e.id)).toEqual(["s1"]);
  });
});