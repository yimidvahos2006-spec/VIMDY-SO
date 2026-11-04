import type { ProfitInput, ProfitOperatingExpense, ProfitSummary } from "../profit/profitEngine";
import {
  FIXED_EXPENSE_CATEGORIES,
  FIXED_EXPENSE_CATEGORY_LABELS,
  type FixedExpenseCategory,
  type FixedExpenseListFilter
} from "../../types/fixedExpense";
import { getBusinessDateKey } from "../../utils/businessTime";
import type { FixedExpenseSummary } from "./fixedExpenseSummary";

/* ===========================================================================
   VIMDY Contable — Utilidad Neta Real (cálculos puros, sin acceso a datos)

   Utilidad neta real = Ventas − Costo de insumos − Gastos fijos

   El motor de ganancias (profitEngine) ya calcula
   `netProfit = ventas − costo de ventas − gastos operativos`. Aquí solo se
   convierten los gastos fijos en gastos operativos del motor y se arma el
   desglose que muestra el Centro de Ganancias. No se duplica ninguna fórmula:
   la cifra final siempre sale del motor.
=========================================================================== */

/** Un gasto operativo del motor por cada categoría de gasto fijo con valor. */
export function fixedExpensesAsOperatingExpenses(summary: FixedExpenseSummary): ProfitOperatingExpense[] {
  return FIXED_EXPENSE_CATEGORIES.filter((category) => summary.byCategory[category].total > 0).map((category) => ({
    label: FIXED_EXPENSE_CATEGORY_LABELS[category],
    amount: summary.byCategory[category].total
  }));
}

/** Copia de `input` con los gastos fijos sumados a sus gastos operativos (no muta `input`). */
export function withFixedExpenses(input: ProfitInput, summary: FixedExpenseSummary): ProfitInput {
  return {
    ...input,
    operatingExpenses: [...(input.operatingExpenses ?? []), ...fixedExpensesAsOperatingExpenses(summary)]
  };
}

export interface RealNetProfitCategoryLine {
  category: FixedExpenseCategory;
  label: string;
  total: number;
}

export interface RealNetProfitBreakdown {
  /** Ventas netas del periodo (después de descuentos y devoluciones). */
  sales: number;
  /** Costo de insumos de lo vendido (costo de ventas). */
  supplyCosts: number;
  /** Gastos fijos del periodo (VIMDY Contable). */
  fixedExpenses: number;
  /** Otros gastos operativos que no son gastos fijos (0 si no hay). */
  otherExpenses: number;
  /** Ventas − costo de insumos − gastos fijos − otros gastos. */
  realNetProfit: number;
  /** Utilidad neta real sobre ventas (0–100). */
  netMarginPercent: number;
  /** Gastos fijos por categoría, de mayor a menor (solo las que tienen valor). */
  byCategory: RealNetProfitCategoryLine[];
}

/**
 * Desglose de la utilidad neta real a partir del resumen del motor.
 * `profit` debe haberse calculado con `withFixedExpenses` (así sus gastos
 * operativos ya incluyen los gastos fijos).
 */
export function buildRealNetProfitBreakdown(profit: ProfitSummary, fixed: FixedExpenseSummary): RealNetProfitBreakdown {
  // Resta con tolerancia: sumar y restar decimales puede dejar residuos como 1e-9.
  const rawOther = profit.operatingExpenses - fixed.total;
  const otherExpenses = rawOther > 0.005 ? rawOther : 0;

  const byCategory = FIXED_EXPENSE_CATEGORIES.map((category) => ({
    category,
    label: FIXED_EXPENSE_CATEGORY_LABELS[category],
    total: fixed.byCategory[category].total
  }))
    .filter((line) => line.total > 0)
    .sort((a, b) => b.total - a.total);

  return {
    sales: profit.revenue,
    supplyCosts: profit.cogs,
    fixedExpenses: fixed.total,
    otherExpenses,
    realNetProfit: profit.netProfit,
    netMarginPercent: profit.netMarginPercent,
    byCategory
  };
}

/**
 * Rango de fechas de los gastos fijos que corresponden a un periodo del
 * Centro de Ganancias: desde el inicio del periodo hasta HOY (misma regla que
 * las ventas, que llegan hasta este momento), en la zona horaria del negocio.
 * `periodStart` null = "Todo" (sin fecha inicial).
 */
export function fixedExpenseFilterForPeriod(
  periodStart: Date | null,
  now: Date,
  timezone: string
): Required<Pick<FixedExpenseListFilter, "to">> & Pick<FixedExpenseListFilter, "from"> {
  const to = getBusinessDateKey(now, timezone);
  if (periodStart === null) return { to };
  return { from: getBusinessDateKey(periodStart, timezone), to };
}