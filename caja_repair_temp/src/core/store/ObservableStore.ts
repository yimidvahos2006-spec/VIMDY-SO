type Listener = () => void;

/**
 * Base para stores "en memoria" que necesitan avisarle a React cuando
 * cambian, sin recurrir a polling (setInterval) desde los componentes.
 *
 * Cómo usarla en un store hijo:
 *   1. extends ObservableStore<TSnapshot>
 *   2. Llamar a this.publish(nuevoSnapshot) al final de cada método que
 *      mute el estado (add, remove, update, etc.)
 *   3. El hook de React usa useSyncExternalStore(store.subscribe, store.getSnapshot)
 *      en vez de useState + setInterval.
 *
 * Como el snapshot solo cambia de referencia cuando `publish` se llama,
 * React re-renderiza únicamente cuando el dato realmente cambió — nunca
 * "porque sí" cada X milisegundos.
 */
export abstract class ObservableStore<T> {
  private listeners = new Set<Listener>();
  protected snapshot: T;

  constructor(initialSnapshot: T) {
    this.snapshot = initialSnapshot;
  }

  /** Usado por React (vía useSyncExternalStore) para registrarse a cambios. */
  subscribe = (listener: Listener): (() => void) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };

  /** Usado por React para leer el valor actual sin suscribirse. */
  getSnapshot = (): T => this.snapshot;

  /** Llamar después de mutar el estado interno del store. */
  protected publish(nextSnapshot: T) {
    this.snapshot = nextSnapshot;
    this.listeners.forEach((listener) => listener());
  }
}