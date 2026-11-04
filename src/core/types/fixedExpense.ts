/* ===========================================================================
   VIMDY Contable — tipos de gastos fijos
   Tabla: fixed_expenses (supabase/migrations/20261122000000_vimdy_contable_fixed_expenses.sql)
=========================================================================== */

export const FIXED_EXPENSE_CATEGORIES = [
  "arriendo",
  "servicios",
  "nomina",
  "proveedores",
  "otros"
] as const;

export type FixedExpenseCategory = (typeof FIXED_EXPENSE_CATEGORIES)[number];

/** Etiquetas para mostrar en pantalla (la base guarda el valor sin tildes). */
export const FIXED_EXPENSE_CATEGORY_LABELS: Record<FixedExpenseCategory, string> = {
  arriendo: "Arriendo",
  servicios: "Servicios",
  nomina: "Nómina",
  proveedores: "Proveedores",
  otros: "Otros"
};

export interface FixedExpense {
  id: string;
  businessId: string;
  /** Sucursal del gasto. null = gasto global del negocio. */
  branchId: string | null;
  category: FixedExpenseCategory;
  /** Valor en pesos colombianos (COP). Siempre mayor que 0. */
  amount: number;
  /** Fecha del gasto, formato YYYY-MM-DD (sin hora). */
  expenseDate: string;
  description: string;
  /** Fecha de registro, ISO 8601. */
  createdAt: string;
}

export interface NewFixedExpenseInput {
  /** Sucursal del gasto. Omitido o null = gasto global del negocio. */
  branchId?: string | null;
  category: FixedExpenseCategory;
  amount: number;
  /** YYYY-MM-DD. Si se omite, la base usa la fecha de hoy en Colombia. */
  expenseDate?: string;
  description?: string;
}

export interface FixedExpenseListFilter {
  /** Desde (incluida), YYYY-MM-DD. */
  from?: string;
  /** Hasta (incluida), YYYY-MM-DD. */
  to?: string;
  category?: FixedExpenseCategory;
  /** undefined = todos · null = solo gastos globales · id = solo esa sucursal. */
  branchId?: string | null;
}

export function isFixedExpenseCategory(value: unknown): value is FixedExpenseCategory {
  return (FIXED_EXPENSE_CATEGORIES as readonly unknown[]).includes(value);
}