import { ObservableStore } from "./ObservableStore";

export interface ConfirmRequest {
  readonly id: number;
  readonly title: string;
  readonly message: string;
  readonly confirmLabel: string;
  readonly cancelLabel: string;
  /** Acción destructiva (eliminar, desactivar): botón rojo y foco en Cancelar. */
  readonly danger: boolean;
}

export interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface QueueItem {
  request: ConfirmRequest;
  resolve: (accepted: boolean) => void;
}

/**
 * confirmStore
 * ---------------------------------------------------------------------------
 * Reemplazo imperativo del `window.confirm()` nativo (el cuadro gris del
 * navegador con "app.vimdy.co dice…"), que no se puede estilizar, no existe
 * como parte de una app instalada/Play Store y rompe la experiencia.
 *
 * Igual que `toast`, se puede llamar desde cualquier archivo sin hooks:
 *
 *   const ok = await confirmDialog({ title: "Eliminar cliente", message: "…", danger: true });
 *   if (!ok) return;
 *
 * Devuelve una promesa: `true` si la persona confirma, `false` si cancela,
 * toca fuera del cuadro o presiona Escape. Si se piden varias confirmaciones
 * a la vez, se muestran de una en una, en orden.
 */
class ConfirmStore extends ObservableStore<ConfirmRequest | null> {
  private queue: QueueItem[] = [];
  private nextId = 1;

  constructor() {
    super(null);
  }

  ask(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>((resolve) => {
      const request: ConfirmRequest = {
        id: this.nextId++,
        title: options.title,
        message: options.message,
        confirmLabel: options.confirmLabel ?? "Aceptar",
        cancelLabel: options.cancelLabel ?? "Cancelar",
        danger: options.danger ?? false
      };
      this.queue.push({ request, resolve });
      if (this.snapshot === null) this.showNext();
    });
  }

  /** Cierra el cuadro visible con la respuesta de la persona y muestra el siguiente. */
  answer(accepted: boolean): void {
    const current = this.queue.shift();
    current?.resolve(accepted);
    this.showNext();
  }

  private showNext(): void {
    this.publish(this.queue.length > 0 ? this.queue[0].request : null);
  }
}

export const confirmStore = new ConfirmStore();

export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
  return confirmStore.ask(options);
}