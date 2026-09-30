import { useEffect, useState } from "react";

import { container } from "../infrastructure/di/CompositionRoot";
import { useVimdyEvent } from "./useVimdyCore";

/**
 * true si hay un turno de caja abierto en el negocio ahora mismo, false si
 * no, null mientras se está consultando por primera vez. Se apoya en el
 * mismo ShiftEngine real que usa ShiftPanel (Caja > Turno), y se
 * actualiza solo cuando alguien abre o cierra caja (evento "shift"),
 * sin necesidad de refrescar la página.
 */
export function useCashierShiftStatus(): boolean | null {
  const [isOpen, setIsOpen] = useState<boolean | null>(null);

  async function reload() {
    try {
      const shift = await container.shiftEngine.get().getCurrentShift();
      setIsOpen(shift !== null);
    } catch {
      // Si falla la consulta (ej. sin sesión todavía), se trata como
      // "fuera de línea" en vez de dejar el indicador colgado.
      setIsOpen(false);
    }
  }

  useEffect(() => {
    reload();
  }, []);

  useVimdyEvent("shift", () => {
    reload();
  });

  return isOpen;
}