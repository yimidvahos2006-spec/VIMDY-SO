import {
  FIXED_EXPENSE_CATEGORIES,
  type FixedExpense,
  type FixedExpenseCategory
} from "../../types/fixedExpense";

/* ===========================================================================
   VIMDY Contable — cálculos puros de gastos fijos (sin acceso a datos)
   Meses como "AAAA-MM"; fechas como "AAAA-MM-DD" (sin zona horaria).
=========================================================================== */

export type MonthKey = string; // "2026-11"

export interface CategoryTotal {
  total: number;
  count: number;
}

export interface FixedExpenseSummary {
  total: number;
  count: number;
  byCategory: Record<FixedExpenseCategory, CategoryTotal>;
  /** Categoría con mayor total (null si no hay gastos). */
  topCategory: FixedExpenseCategory | null;
}

const MONTH_RE = /^(\d{4})-(\d{2})$/;

export function monthKeyOfDate(isoDate: string): MonthKey {
  return isoDate.slice(0, 7);
}

function parseMonth(key: MonthKey): { year: number; month: number } {
  const match = MONTH_RE.exec(key);
  if (!match) throw new Error(`Mes inválido: ${key}`);
  const month = Number(match[2]);
  if (month < 1 || month > 12) throw new Error(`Mes inválido: ${key}`);
  return { year: Number(match[1]), month };
}

export function shiftMonth(key: MonthKey, delta: number): MonthKey {
  const { year, month } = parseMonth(key);
  const index = year * 12 + (month - 1) + delta;
  const nextYear = Math.floor(index / 12);
  const nextMonth = (index % 12) + 1;
  return `${String(nextYear).padStart(4, "0")}-${String(nextMonth).padStart(2, "0")}`;
}

/** Primer y último día del mes, ambos incluidos. */
export function monthRange(key: MonthKey): { from: string; to: string } {
  const { year, month } = parseMonth(key);
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return { from: `${key}-01`, to: `${key}-${String(lastDay).padStart(2, "0")}` };
}

/** "noviembre de 2026" */
export function formatMonthLabel(key: MonthKey, locale = "es-CO"): string {
  const { year, month } = parseMonth(key);
  return new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" }).format(
    new Date(Date.UTC(year, month - 1, 1))
  );
}

/** "3 nov" — sin pasar por la zona horaria del dispositivo. */
export function formatShortDate(isoDate: string, locale = "es-CO"): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const parts = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" }).formatToParts(
    new Date(Date.UTC(year, month - 1, day))
  );
  const dayText = parts.find((p) => p.type === "day")?.value ?? String(day);
  const monthText = (parts.find((p) => p.type === "month")?.value ?? "").replace(".", "");
  return `${dayText} ${monthText}`;
}

export function summarizeFixedExpenses(expenses: readonly FixedExpense[]): FixedExpenseSummary {
  const byCategory = Object.fromEntries(
    FIXED_EXPENSE_CATEGORIES.map((category) => [category, { total: 0, count: 0 }])
  ) as Record<FixedExpenseCategory, CategoryTotal>;

  let total = 0;
  for (const expense of expenses) {
    byCategory[expense.category].total += expense.amount;
    byCategory[expense.category].count += 1;
    total += expense.amount;
  }

  let topCategory: FixedExpenseCategory | null = null;
  for (const category of FIXED_EXPENSE_CATEGORIES) {
    if (byCategory[category].total > 0 && (topCategory === null || byCategory[category].total > byCategory[topCategory].total)) {
      topCategory = category;
    }
  }

  return { total, count: expenses.length, byCategory, topCategory };
}

/** Más recientes primero (fecha del gasto y luego fecha de registro). */
export function sortFixedExpenses(expenses: readonly FixedExpense[]): FixedExpense[] {
  return [...expenses].sort((a, b) =>
    a.expenseDate !== b.expenseDate
      ? a.expenseDate < b.expenseDate ? 1 : -1
      : a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0
  );
}

/** undefined = todas · null = solo globales · id = esa sucursal. */
export type BranchScope = string | null | undefined;

export function filterByBranchScope(expenses: readonly FixedExpense[], scope: BranchScope): FixedExpense[] {
  if (scope === undefined) return [...expenses];
  return expenses.filter((expense) => expense.branchId === scope);
}