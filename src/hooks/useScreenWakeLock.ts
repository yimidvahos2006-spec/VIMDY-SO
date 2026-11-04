import { useEffect, useState, useSyncExternalStore } from "react";

import {
  createScreenWakeLock,
  type ScreenWakeLockStatus
} from "../core/services/screenWakeLock";

/**
 * Mantiene la pantalla encendida mientras el componente está montado y
 * `enabled` sea true. Devuelve el estado para poder avisar en la UI.
 */
export function useScreenWakeLock(enabled = true): ScreenWakeLockStatus {
  const [controller] = useState(() => createScreenWakeLock());

  useEffect(() => {
    if (!enabled) return undefined;
    controller.start();
    return () => {
      void controller.stop();
    };
  }, [controller, enabled]);

  return useSyncExternalStore(controller.subscribe, controller.getStatus, controller.getStatus);
}