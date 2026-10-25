import { ObservableStore } from "./ObservableStore";

export type DashboardSyncState = "loading" | "ready" | "error";

export interface DashboardSyncStatus {
  readonly state: DashboardSyncState;
  readonly message: string | null;
  /**
   * Momento de la última sincronización EXITOSA con el servidor para el
   * negocio/sucursal actual (null = todavía ninguna). Junto con state ===
   * "error" permite saber que las cifras en pantalla siguen siendo las de
   * esa última carga buena, o sea, que están desactualizadas.
   */
  readonly lastSyncedAt: Date | null;
}

/**
 * Estado de la sincronización del dashboard con Supabase.
 * Antes, si la primera sincronización fallaba, el Dashboard se quedaba para
 * siempre en "esperando sincronización" sin decirle nada a la persona.
 * Ahora además recuerda cuándo fue la última sincronización buena, para poder
 * avisar "datos desactualizados" cuando la red falla después de cargar.
 */
class DashboardSyncStatusStore extends ObservableStore<DashboardSyncStatus> {
  private retryHandler: (() => void) | null = null;

  constructor() {
    super({ state: "loading", message: null, lastSyncedAt: null });
  }

  set(state: DashboardSyncState, message: string | null = null): void {
    // Una sincronización exitosa siempre actualiza la hora, aunque el estado
    // ya fuera "ready" (cada reconciliación buena renueva "actualizado a las…").
    if (state === "ready") {
      this.publish({ state, message, lastSyncedAt: new Date() });
      return;
    }
    if (this.snapshot.state === state && this.snapshot.message === message) return;
    this.publish({ state, message, lastSyncedAt: this.snapshot.lastSyncedAt });
  }

  /**
   * Olvida la última sincronización. Se usa al cerrar sesión o cambiar de
   * negocio/sucursal: la hora de otro negocio no debe aparecer como propia.
   */
  reset(): void {
    this.publish({ state: "loading", message: null, lastSyncedAt: null });
  }

  setRetryHandler(handler: (() => void) | null): void {
    this.retryHandler = handler;
  }

  retry(): void {
    this.retryHandler?.();
  }
}

export const dashboardSyncStatusStore = new DashboardSyncStatusStore();