/**
 * operationConfigStore.ts
 * ---------------------------------------------------------------------------
 * Store reactivo para la configuración de operación del negocio.
 *
 * Fuente de verdad en memoria que se sincroniza con Supabase.
 * Se hidrata desde AuthContext al iniciar sesión.
 */

import { ObservableStore } from './ObservableStore';
import type { OperationConfig } from '../config/operation';
import { DEFAULT_OPERATION_CONFIG } from '../config/operation';

/**
 * `null` = todavía no se sabe (sesión cargando, o negocio sin configurar).
 * En ese estado los componentes deben mostrar "pendiente de configurar".
 */
class OperationConfigStore extends ObservableStore<OperationConfig | null> {
  constructor() {
    super(null);
  }

  get(): OperationConfig | null {
    return this.snapshot;
  }

  set(config: OperationConfig): void {
    this.publish(config);
  }

  clear(): void {
    this.publish(null);
  }

  /**
   * Actualiza parcialmente la configuración.
   * Útil para cambios individuales desde Configuración.
   */
  patch(partial: Partial<OperationConfig>): void {
    const current = this.snapshot;
    if (!current) return;
    this.publish({ ...current, ...partial });
  }
}

export const operationConfigStore = new OperationConfigStore();
