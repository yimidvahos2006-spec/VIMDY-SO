import { useCallback, useEffect, useRef, useState } from "react";

import {
  monthRange,
  sortFixedExpenses,
  type MonthKey
} from "../../core/domain/accounting/fixedExpenseSummary";
import type { FixedExpense } from "../../core/types/fixedExpense";
import { listFixedExpenses } from "../../infrastructure/supabase/fixedExpenseService";

/**
 * Gastos fijos de UN mes. Se trae el mes completo y los filtros (categoría,
 * sucursal) se aplican en pantalla, así los totales cambian al instante sin
 * volver a consultar. Ignora respuestas viejas si la persona cambia de mes
 * rápido.
 */
export function useFixedExpenses(businessId: string | null, month: MonthKey) {
  const [expenses, setExpenses] = useState<FixedExpense[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestId = useRef(0);

  const reload = useCallback(async () => {
    if (!businessId) return;
    const current = ++requestId.current;
    setLoading(true);
    setError(null);
    try {
      const { from, to } = monthRange(month);
      const rows = await listFixedExpenses(businessId, { from, to });
      if (current !== requestId.current) return;
      setExpenses(rows);
    } catch (err) {
      if (current !== requestId.current) return;
      setError(err instanceof Error ? err.message : "No se pudieron cargar los gastos.");
    } finally {
      if (current === requestId.current) setLoading(false);
    }
  }, [businessId, month]);

  useEffect(() => {
    void reload();
    return () => {
      requestId.current += 1; // invalida la consulta en vuelo al desmontar / cambiar de mes
    };
  }, [reload]);

  const addLocal = useCallback((expense: FixedExpense) => {
    setExpenses((prev) => sortFixedExpenses([expense, ...prev.filter((e) => e.id !== expense.id)]));
  }, []);

  const removeLocal = useCallback((id: string) => {
    setExpenses((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return { expenses, loading, error, reload, addLocal, removeLocal };
}