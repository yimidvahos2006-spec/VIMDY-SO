import { useEffect, useMemo, useState, useSyncExternalStore } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { logWarning } from "../infrastructure/logging/opsLogger";
import { Customer } from "../core/entities/Entities";
import { connectionStore } from "../core/store/connectionStore";
import { vimdyCore } from "../core/VimdyCore";
import { searchCustomers } from "../core/domain/customers/search";

/**
 * useCustomerSearch
 * ---------------------------------------------------------------------------
 * PASO 5 del plan offline: búsqueda de clientes de Caja (por nombre o por
 * teléfono) que responde al instante, tenga o no internet el local.
 *
 * CÓMO FUNCIONA
 *  1. Al abrir, lee los clientes SOLO de IndexedDB (milisegundos, sin tocar
 *     la red) y ya se puede buscar. Incluye los clientes creados sin
 *     internet que aún esperan sincronizarse.
 *  2. Si hay conexión, en segundo plano pide la lista fresca a Supabase y,
 *     cuando llega, vuelve a leer el caché. Si la señal es mala y no llega,
 *     no pasa nada: la búsqueda nunca depende de esa respuesta.
 *  3. Si la conexión vuelve con el modal abierto, refresca una vez.
 *  4. Cuando se crea un cliente (evento "customer"), vuelve a leer el caché.
 *
 * La búsqueda por teléfono es la de `searchCustomers`: los últimos dígitos
 * ("4567") o cualquier tramo del número, ignorando espacios, guiones y "+57".
 *
 * `enabled` = el buscador está visible (p. ej. el modal abierto). Cerrado no
 * lee ni refresca nada.
 */

export interface UseCustomerSearchOptions {
  readonly enabled: boolean;
  readonly query: string;
  readonly limit?: number;
}

export interface UseCustomerSearchResult {
  /** Todos los clientes disponibles en este dispositivo (para detectar teléfonos repetidos). */
  readonly customers: readonly Customer[];
  /** Coincidencias ordenadas para `query`; sin texto, los más recientes. */
  readonly results: Customer[];
  /** true solo mientras se hace la PRIMERA lectura del caché local. */
  readonly loading: boolean;
  /** true mientras se refresca contra Supabase en segundo plano. */
  readonly refreshing: boolean;
}

const DEFAULT_LIMIT = 8;

export function useCustomerSearch({
  enabled,
  query,
  limit = DEFAULT_LIMIT
}: UseCustomerSearchOptions): UseCustomerSearchResult {
  const online = useSyncExternalStore(
    connectionStore.subscribe,
    () => connectionStore.isOnline(),
    () => true
  );

  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    if (!enabled) {
      setCustomers([]);
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let cancelled = false;
    const engine = container.customerEngine.get();

    async function readLocal(): Promise<void> {
      try {
        const list = await engine.getCustomersFromLocal();
        if (!cancelled) setCustomers(list);
      } catch (error) {
        logWarning("[useCustomerSearch] No se pudo leer el caché local de clientes", {
          category: "offline",
          context: { error: String(error) }
        });
      }
    }

    setLoading(true);
    void readLocal().finally(() => {
      if (!cancelled) setLoading(false);
    });

    const unsubscribe = vimdyCore.on("customer", () => {
      void readLocal();
    });

    if (online) {
      setRefreshing(true);
      engine
        .refreshCustomers()
        .then(() => readLocal())
        .catch(() => {
          // Sin red o señal mala: se sigue con lo que hay en el caché local.
        })
        .finally(() => {
          if (!cancelled) setRefreshing(false);
        });
    } else {
      setRefreshing(false);
    }

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [enabled, online]);

  const results = useMemo(
    () => searchCustomers(customers, query, limit),
    [customers, query, limit]
  );

  return { customers, results, loading, refreshing };
}