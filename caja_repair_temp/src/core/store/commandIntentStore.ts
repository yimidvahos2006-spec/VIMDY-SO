import { ObservableStore } from "./ObservableStore";

/**
 * Tipos de intención de UI que el Copiloto puede disparar en una pantalla
 * (PASO 6 — Comandos Inteligentes). Cada pantalla que le interese un tipo
 * se suscribe con el hook `useCommandIntent`.
 */
export type CommandIntentType =
  | "OPEN_NEW_PRODUCT"
  | "SEARCH_INVENTORY"
  | "SEARCH_CUSTOMER"
  | "OPEN_NEW_CUSTOMER";

export interface CommandIntent {
  readonly type: CommandIntentType;
  readonly params?: Record<string, string>;
}

/**
 * commandIntentStore
 * ---------------------------------------------------------------------------
 * Puente entre el Copiloto (que sabe QUÉ quiere hacer el usuario, pero vive
 * fuera de cualquier página específica) y las pantallas reales (que saben
 * CÓMO hacerlo — abrir un modal, prellenar un buscador).
 *
 * Flujo:
 *   1. CopilotPanel reconoce un comando ("crea un producto") vía CommandEngine.
 *   2. Navega a la ruta correspondiente y deja el intent aquí con `dispatch`.
 *   3. La pantalla destino lo consume con `useCommandIntent(tipo, handler)`,
 *      ya sea porque acaba de montar (navegación) o porque ya estaba abierta.
 *   4. `consume` borra el intent para que no se repita en el próximo render.
 */
class CommandIntentStore extends ObservableStore<CommandIntent | null> {
  constructor() {
    super(null);
  }

  public dispatch(intent: CommandIntent): void {
    this.publish(intent);
  }

  /** Devuelve el intent pendiente SOLO si coincide con `type`, y lo limpia. */
  public consume(type: CommandIntentType): CommandIntent | null {
    const current = this.snapshot;
    if (current && current.type === type) {
      this.publish(null);
      return current;
    }
    return null;
  }
}

export const commandIntentStore = new CommandIntentStore();