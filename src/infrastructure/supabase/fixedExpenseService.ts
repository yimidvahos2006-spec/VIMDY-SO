import { supabase } from "./supabaseClient";
import {
  isFixedExpenseCategory,
  type FixedExpense,
  type FixedExpenseCategory,
  type FixedExpenseListFilter,
  type NewFixedExpenseInput
} from "../../core/types/fixedExpense";

/* ===========================================================================
   fixedExpenseService — VIMDY Contable
   ---------------------------------------------------------------------------
   Gastos fijos del negocio (arriendo, servicios, nómina, proveedores, otros).
   Tabla: fixed_expenses. Todas las consultas filtran por business_id de forma
   explícita, además del RLS (regla multi-tenant de VIMDY OS).
   Permisos (RLS): leen ADMIN, GERENTE y CONTADOR; escriben ADMIN y GERENTE.
=========================================================================== */

interface FixedExpenseRow {
  id: string;
  business_id: string;
  branch_id: string | null;
  category: FixedExpenseCategory;
  amount: number | string; // numeric puede llegar como string desde PostgREST
  expense_date: string;
  description: string | null;
  created_at: string;
}

const TABLE = "fixed_expenses";
const COLUMNS = "id, business_id, branch_id, category, amount, expense_date, description, created_at";
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_DESCRIPTION = 200;

function mapRow(row: FixedExpenseRow): FixedExpense {
  return {
    id: row.id,
    businessId: row.business_id,
    branchId: row.branch_id,
    category: row.category,
    amount: Number(row.amount),
    expenseDate: row.expense_date,
    description: row.description ?? "",
    createdAt: row.created_at
  };
}

function friendlyError(message: string | undefined, fallback: string): Error {
  if (!message) return new Error(fallback);
  if (message.includes("row-level security") || message.includes("permission denied")) {
    return new Error(
      "No tienes permiso para esta acción o la suscripción del negocio no está activa. " +
        "Solo el administrador y el gerente pueden registrar gastos."
    );
  }
  if (message.includes("fixed_expenses_amount_check")) {
    return new Error("El valor del gasto debe ser mayor que cero.");
  }
  if (message.includes("fixed_expenses_category_check")) {
    return new Error("La categoría del gasto no es válida.");
  }
  if (message.includes("fixed_expenses_branch_id_fkey")) {
    return new Error("La sucursal elegida ya no existe.");
  }
  if (message.includes("fixed_expenses_description_check")) {
    return new Error(`La descripción no puede pasar de ${MAX_DESCRIPTION} caracteres.`);
  }
  if (message.includes('relation "public.fixed_expenses" does not exist') || message.includes("schema cache")) {
    return new Error("Falta actualizar la base de datos: aplica la migración de VIMDY Contable.");
  }
  return new Error(fallback);
}

function requireBusinessId(businessId: string): void {
  if (!businessId) throw new Error("No se pudo identificar el negocio.");
}

function assertDate(value: string, label: string): void {
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) {
    throw new Error(`${label} no es una fecha válida (usa AAAA-MM-DD).`);
  }
}

/** Registra un gasto fijo y devuelve el registro guardado. */
export async function createFixedExpense(
  businessId: string,
  input: NewFixedExpenseInput
): Promise<FixedExpense> {
  requireBusinessId(businessId);

  if (!isFixedExpenseCategory(input.category)) {
    throw new Error("Elige una categoría de gasto válida.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    throw new Error("El valor del gasto debe ser mayor que cero.");
  }
  const description = input.description?.trim() ?? "";
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`La descripción no puede pasar de ${MAX_DESCRIPTION} caracteres.`);
  }
  if (input.expenseDate) assertDate(input.expenseDate, "La fecha del gasto");

  const { data, error } = await supabase
    .from(TABLE)
    .insert({
      business_id: businessId,
      branch_id: input.branchId ?? null,
      category: input.category,
      amount: input.amount,
      // Si no viene fecha, la base pone la de hoy en Colombia (DEFAULT de la columna).
      ...(input.expenseDate ? { expense_date: input.expenseDate } : {}),
      description: description || null
    })
    .select(COLUMNS)
    .single();

  if (error || !data) throw friendlyError(error?.message, "No se pudo guardar el gasto.");
  return mapRow(data as FixedExpenseRow);
}

/** Lista los gastos del negocio (más recientes primero), con filtros opcionales. */
export async function listFixedExpenses(
  businessId: string,
  filter: FixedExpenseListFilter = {}
): Promise<FixedExpense[]> {
  requireBusinessId(businessId);
  if (filter.from) assertDate(filter.from, "La fecha inicial");
  if (filter.to) assertDate(filter.to, "La fecha final");
  if (filter.category && !isFixedExpenseCategory(filter.category)) {
    throw new Error("Elige una categoría de gasto válida.");
  }

  let query = supabase.from(TABLE).select(COLUMNS).eq("business_id", businessId);
  if (filter.from) query = query.gte("expense_date", filter.from);
  if (filter.to) query = query.lte("expense_date", filter.to);
  if (filter.category) query = query.eq("category", filter.category);
  if (filter.branchId === null) query = query.is("branch_id", null);
  else if (filter.branchId) query = query.eq("branch_id", filter.branchId);

  const { data, error } = await query
    .order("expense_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) throw friendlyError(error.message, "No se pudieron cargar los gastos.");
  return ((data ?? []) as FixedExpenseRow[]).map(mapRow);
}

/**
 * Elimina un gasto del negocio. Si el gasto no existe o no se puede borrar
 * (otro negocio, sin permiso), lanza error en vez de fallar en silencio.
 */
export async function deleteFixedExpense(businessId: string, expenseId: string): Promise<void> {
  requireBusinessId(businessId);
  if (!expenseId) throw new Error("No se pudo identificar el gasto.");

  const { data, error } = await supabase
    .from(TABLE)
    .delete()
    .eq("business_id", businessId)
    .eq("id", expenseId)
    .select("id");

  if (error) throw friendlyError(error.message, "No se pudo eliminar el gasto.");
  if (!data || data.length === 0) {
    throw new Error("No se encontró el gasto o no tienes permiso para eliminarlo.");
  }
}