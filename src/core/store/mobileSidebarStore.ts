import { ObservableStore } from "./ObservableStore";

/**
 * Controla si el sidebar está abierto como panel superpuesto (drawer) en
 * pantallas angostas (celular/tablet en vertical). Es independiente de
 * sidebarStore (que solo aplica en escritorio, donde el sidebar siempre
 * es visible y solo cambia entre "iconos" y "iconos + texto"): en móvil
 * el sidebar no existe hasta que el usuario lo abre con el botón de
 * hamburguesa, y se cierra solo al elegir una opción o tocar el fondo.
 */
class MobileSidebarStore extends ObservableStore<boolean> {
  constructor() {
    super(false); // cerrado por defecto: prioridad a ver el contenido
  }

  get() {
    return this.snapshot;
  }

  open() {
    this.publish(true);
  }

  close() {
    this.publish(false);
  }

  toggle() {
    this.publish(!this.snapshot);
  }
}

export const mobileSidebarStore = new MobileSidebarStore();