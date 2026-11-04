import type { FixedExpenseCategory } from "../../../core/types/fixedExpense";

/**
 * Color de cada categoría, usando solo tokens vimdy-* de tailwind.config.js.
 * Las clases van completas (no armadas con template strings) para que Tailwind
 * las detecte al compilar.
 */
export const CATEGORY_STYLE: Record<FixedExpenseCategory, { dot: string; badge: string }> = {
  arriendo: { dot: "bg-vimdy-accent", badge: "bg-vimdy-accent/15 text-vimdy-accent-hover" },
  servicios: { dot: "bg-vimdy-blue", badge: "bg-vimdy-blue/15 text-vimdy-blue" },
  nomina: { dot: "bg-vimdy-recipe", badge: "bg-vimdy-recipe/15 text-vimdy-recipe-hover" },
  proveedores: { dot: "bg-vimdy-warning", badge: "bg-vimdy-warning/15 text-vimdy-warning" },
  otros: { dot: "bg-vimdy-silver", badge: "bg-vimdy-text-tertiary/20 text-vimdy-text-secondary" }
};

/** Roles con acceso al módulo (el servidor lo vuelve a exigir con RLS). */
export const EXPENSE_VIEW_ROLES = ["ADMIN", "GERENTE", "CONTADOR"] as const;
export const EXPENSE_WRITE_ROLES = ["ADMIN", "GERENTE"] as const;

export function roleIn(role: string | null | undefined, allowed: readonly string[]): boolean {
  return !!role && allowed.includes(role.toUpperCase());
}