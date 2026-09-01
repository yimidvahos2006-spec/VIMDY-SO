/**
 * useOperationConfig.ts
 * ---------------------------------------------------------------------------
 * Hook para acceder a la configuración de operación del negocio actual.
 */

import { useSyncExternalStore } from 'react';
import { operationConfigStore } from './operationConfigStore';

export function useOperationConfig(): ReturnType<typeof operationConfigStore.get> {
  return useSyncExternalStore(
    operationConfigStore.subscribe,
    operationConfigStore.getSnapshot
  );
}
