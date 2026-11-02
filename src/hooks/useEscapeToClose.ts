import { useEffect, useRef } from "react";
import { listenForEscape } from "../core/utils/escapeKey";

/**
 * Cierra un modal al presionar Escape. Con `enabled = false` (por ejemplo
 * mientras se está guardando) la tecla no hace nada, para no cerrar a la mitad
 * de una operación.
 */
export function useEscapeToClose(onClose: () => void, enabled = true): void {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!enabled) return undefined;
    return listenForEscape(document, () => onCloseRef.current());
  }, [enabled]);
}