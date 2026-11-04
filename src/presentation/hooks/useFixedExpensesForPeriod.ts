import { useEffect, useState } from "react";

import { summarizeFixedExpenses, type FixedExpenseSummary } from "../../core/domain/accounting/fixedExpenseSummary";
import { listFixedExpenses } from "../../infrastructure/supabase/fixedExpenseService";

interface State {
  summary: FixedExpenseSummary | null;
  loading: boolean;
  error: string | null;
}

const IDLE: State = { summary: null, loading: false, error: null };

/**
 * Resumen de los gastos fijos de un rango de fechas (para el Centro de
 * Ganancias). Con `enabled = false` no consulta nada: el negocio no tiene
 * VIMDY Contable o el rol no puede verlo (la base solo deja leer a ADMIN,
 * GERENTE y CONTADOR; sin este chequeo un rol sin acceso vería "0 gastos" y,
 * con él, una utilidad inflada).
 *
 * Si la consulta falla NO devuelve resumen (queda `error`): jamás se debe
 * tratar un fallo como "cero gastos".
 */
export function useFixedExpensesForPeriod(
  businessId: string | null,
  enabled: boolean,
  from: string | undefined,
  to: string
): State {
  const active = enabled && !!businessId;
  const [state, setState] = useState<State>(active ? { ...IDLE, loading: true } : IDLE);

  useEffect(() => {
    if (!active || !businessId) {
      setState(IDLE);
      return;
    }
    let cancelled = false;
    setState((prev) => ({ summary: prev.summary, loading: true, error: null }));
    listFixedExpenses(businessId, { ...(from ? { from } : {}), to })
      .then((rows) => {
        if (!cancelled) setState({ summary: summarizeFixedExpenses(rows), loading: false, error: null });
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setState({
          summary: null,
          loading: false,
          error: err instanceof Error ? err.message : "No se pudieron cargar los gastos fijos."
        });
      });
    return () => {
      cancelled = true; // ignora respuestas viejas si cambia el periodo o se desmonta
    };
  }, [active, businessId, from, to]);

  return state;
}