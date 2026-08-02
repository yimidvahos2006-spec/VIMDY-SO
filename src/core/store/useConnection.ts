import { useSyncExternalStore } from "react";

import { connectionStore, ConnectionSnapshot } from "./connectionStore";

export interface UseConnectionResult extends ConnectionSnapshot {
  /**
   * El valor que casi siempre se quiere usar en la UI: `true` solo si hay
   * evidencia real de internet (navegador + confirmado por el último ping
   * a Supabase). Ver la regla completa en connectionStore.isOnline().
   */
  isOnline: boolean;
  /** Fuerza un ping inmediato (ej. botón "Reintentar" en el banner). */
  checkNow: () => Promise<boolean>;
}

/**
 * useConnection
 * ---------------------------------------------------------------------------
 * Parte 1 — hook de React sobre connectionStore. Se suscribe con
 * useSyncExternalStore (mismo patrón que useSubscription/useDashboard/
 * useCart) así que cualquier componente que lo use se re-renderiza solo
 * cuando el estado de conexión realmente cambia — nunca por polling
 * propio del componente.
 *
 * El store ya arranca sus listeners y su ping periódico apenas se importa
 * el módulo (ver connectionStore.ts), así que este hook no necesita ningún
 * useEffect propio: solo lee el snapshot actual.
 */
export function useConnection(): UseConnectionResult {
  const snapshot = useSyncExternalStore(connectionStore.subscribe, connectionStore.getSnapshot);

  return {
    ...snapshot,
    isOnline: connectionStore.isOnline(),
    checkNow: () => connectionStore.checkNow()
  };
}