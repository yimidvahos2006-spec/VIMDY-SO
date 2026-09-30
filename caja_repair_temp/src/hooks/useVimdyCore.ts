import { useEffect } from "react";
import { vimdyCore, EventType } from "../core/VimdyCore";

/**
 * Suscribe un componente a un evento del bus global de VIMDY mientras
 * está montado, y se desuscribe automáticamente al desmontar.
 *
 * Ejemplo:
 *   useVimdyEvent("sale", (payload) => {
 *     console.log("Nueva venta:", payload);
 *   });
 */
export function useVimdyEvent(event: EventType, handler: (payload: any) => void) {
  useEffect(() => {
    const unsubscribe = vimdyCore.on(event, handler);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [event]);
}