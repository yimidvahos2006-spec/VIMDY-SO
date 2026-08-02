import { ObservableStore } from "./ObservableStore";

/**
 * Controla si el sidebar principal está expandido (con texto) o
 * colapsado (solo iconos). Vive en un store compartido porque tanto
 * VimdySidebar (quien lo pinta) como VimdyAppLayout (quien reserva el
 * espacio con margin-left) necesitan reaccionar al mismo valor.
 */
class SidebarStore extends ObservableStore<boolean> {
  constructor() {
    super(false); // colapsado por defecto: prioridad a Caja
  }

  get() {
    return this.snapshot;
  }

  toggle() {
    this.publish(!this.snapshot);
  }

  set(expanded: boolean) {
    this.publish(expanded);
  }
}

export const sidebarStore = new SidebarStore();