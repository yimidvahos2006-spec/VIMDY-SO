import { ObservableStore } from "./ObservableStore";

export type DashboardSyncState = "loading" | "ready" | "error";

export interface DashboardSyncStatus {
  readonly state: DashboardSyncState;
  readonly message: string | null;
}

/**
 * Estado de la sincronización del dashboard con Supabase.
 * Antes, si la primera sincronización fallaba, el Dashboard se quedaba para
 * siempre en "esperando sincronización" sin decirle nada a la persona.
 */
class DashboardSyncStatusStore extends ObservableStore<DashboardSyncStatus> {
  private retryHandler: (() => void) | null = null;

  constructor() {
    super({ state: "loading", message: null });
  }

  set(state: DashboardSyncState, message: string | null = null): void {
    if (this.snapshot.state === state && this.snapshot.message === message) return;
    this.publish({ state, message });
  }

  setRetryHandler(handler: (() => void) | null): void {
    this.retryHandler = handler;
  }

  retry(): void {
    this.retryHandler?.();
  }
}

export const dashboardSyncStatusStore = new DashboardSyncStatusStore();