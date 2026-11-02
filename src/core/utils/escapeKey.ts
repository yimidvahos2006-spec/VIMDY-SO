/**
 * escapeKey.ts
 * ---------------------------------------------------------------------------
 * Cerrar un modal con la tecla Escape. Es lógica pura (recibe el "target" donde
 * escuchar) para poder probarla sin navegador; `useEscapeToClose` la conecta
 * a `document`.
 */

export interface EscapeKeyEvent {
  readonly key: string;
  readonly defaultPrevented?: boolean;
  /** true mientras se compone un carácter con IME (no debe cerrar el modal). */
  readonly isComposing?: boolean;
}

export interface EscapeKeyTarget {
  addEventListener(type: "keydown", listener: (event: EscapeKeyEvent) => void): void;
  removeEventListener(type: "keydown", listener: (event: EscapeKeyEvent) => void): void;
}

export function isEscapeKey(event: EscapeKeyEvent): boolean {
  return event.key === "Escape" && !event.defaultPrevented && !event.isComposing;
}

/** Empieza a escuchar Escape. Devuelve la función que deja de escuchar. */
export function listenForEscape(target: EscapeKeyTarget, onEscape: () => void): () => void {
  const listener = (event: EscapeKeyEvent): void => {
    if (isEscapeKey(event)) onEscape();
  };
  target.addEventListener("keydown", listener);
  return () => target.removeEventListener("keydown", listener);
}