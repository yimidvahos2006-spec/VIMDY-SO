import { useCallback, useEffect, useRef, useState } from "react";

import {
  listActivePaymentAccounts,
  type PaymentAccount
} from "../infrastructure/supabase/paymentAccountsRepository";

/* ===========================================================================
   usePaymentAccounts
   ---------------------------------------------------------------------------
   Cuentas de cobro ACTIVAS del negocio actual (business_payment_accounts,
   is_active = true) para el selector de transferencia del POS.

   - Caché en memoria por negocio (stale-while-revalidate): la segunda vez que
     se abre el selector aparece al instante y se refresca en segundo plano.
   - Si el refresco falla (sin internet), se siguen mostrando las cuentas de la
     última carga; el error solo se reporta cuando no hay nada que mostrar.
=========================================================================== */

const accountsCache = new Map<string, PaymentAccount[]>();

export interface UsePaymentAccountsResult {
  accounts: PaymentAccount[];
  loading: boolean;
  /** Solo se llena si falló la carga y no hay cuentas en caché. */
  error: string | null;
  reload: () => Promise<void>;
}

export function usePaymentAccounts(businessId: string | null): UsePaymentAccountsResult {
  const [accounts, setAccounts] = useState<PaymentAccount[]>(() =>
    businessId ? accountsCache.get(businessId) ?? [] : []
  );
  const [loading, setLoading] = useState<boolean>(() =>
    businessId ? !accountsCache.has(businessId) : false
  );
  const [error, setError] = useState<string | null>(null);
  const requestRef = useRef(0);

  const reload = useCallback(async () => {
    const requestId = ++requestRef.current;

    if (!businessId) {
      setAccounts([]);
      setLoading(false);
      setError(null);
      return;
    }

    const cached = accountsCache.get(businessId);
    setAccounts(cached ?? []);
    setLoading(!cached);
    setError(null);

    try {
      const fresh = await listActivePaymentAccounts(businessId);
      if (requestId !== requestRef.current) return;
      accountsCache.set(businessId, fresh);
      setAccounts(fresh);
    } catch (err) {
      if (requestId !== requestRef.current) return;
      if (!cached) {
        setError(
          err instanceof Error ? err.message : "No se pudieron cargar las cuentas de cobro."
        );
      }
    } finally {
      if (requestId === requestRef.current) setLoading(false);
    }
  }, [businessId]);

  useEffect(() => {
    void reload();
    return () => {
      // Invalida la petición en vuelo si el componente se desmonta o cambia el negocio.
      requestRef.current += 1;
    };
  }, [reload]);

  return { accounts, loading, error, reload };
}