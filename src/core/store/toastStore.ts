import { ObservableStore } from "./ObservableStore";

export type ToastType = "success" | "error" | "warning" | "info";

export interface ToastItem {
  readonly id: string;
  readonly type: ToastType;
  readonly message: string;
  /** Milisegundos antes de desaparecer solo. 0 = no se autodescarta. */
  readonly duration: number;
}

const DEFAULT_DURATION_MS = 4000;
const ERROR_DURATION_MS = 6000;

/**
 * toastStore
 * ---------------------------------------------------------------------------
 * Notificaciones EFÍMERAS de feedback inmediato — "Venta realizada",
 * "No hay conexión", "Stock insuficiente", "Producto actualizado" — que
 * aparecen y desaparecen solas, iguales en toda la app.
 *
 * Reemplaza los alert() nativos dispersos (PosCheckoutPanel,
 * InventoryDashboard, etc.) por un único sistema visual consistente.
 *
 * No reemplaza a notificationStore (la campana 🔔, PASO 5): ese es el
 * historial persistente de alertas de negocio que el usuario revisa cuando
 * quiere (stock bajo, pedido retrasado...). Este es solo el "toast"
 * momentáneo que confirma que una acción puntual funcionó o falló.
 */
class ToastStore extends ObservableStore<ToastItem[]> {
  constructor() {
    super([]);
  }

  private push(type: ToastType, message: string, duration: number): void {
    const toast: ToastItem = {
      id: `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      type,
      message,
      duration
    };

    this.publish([...this.snapshot, toast]);

    if (duration > 0) {
      setTimeout(() => this.dismiss(toast.id), duration);
    }
  }

  /** 🟢 Acción completada: "Venta realizada.", "Producto actualizado." */
  success(message: string, duration: number = DEFAULT_DURATION_MS): void {
    this.push("success", message, duration);
  }

  /** 🔴 Algo falló o es bloqueante: "No hay conexión.", "Caja cerrada." */
  error(message: string, duration: number = ERROR_DURATION_MS): void {
    this.push("error", message, duration);
  }

  /** 🟡 Requiere atención pero no bloquea: "Stock insuficiente." */
  warning(message: string, duration: number = DEFAULT_DURATION_MS): void {
    this.push("warning", message, duration);
  }

  /** 🔵 Aviso neutral: "Sincronizando cambios..." */
  info(message: string, duration: number = DEFAULT_DURATION_MS): void {
    this.push("info", message, duration);
  }

  dismiss(id: string): void {
    this.publish(this.snapshot.filter((t) => t.id !== id));
  }
}

export const toastStore = new ToastStore();

/**
 * Punto de entrada imperativo: se puede llamar desde cualquier archivo
 * (componente, engine, servicio) sin necesitar un hook de React, igual
 * de simple que el alert() nativo que reemplaza.
 *
 *   import { toast } from ".../core/store/toastStore";
 *   toast.success("Venta realizada.");
 *   toast.error("No hay conexión.");
 */
export const toast = {
  success: (message: string, duration?: number) => toastStore.success(message, duration),
  error: (message: string, duration?: number) => toastStore.error(message, duration),
  warning: (message: string, duration?: number) => toastStore.warning(message, duration),
  info: (message: string, duration?: number) => toastStore.info(message, duration)
};