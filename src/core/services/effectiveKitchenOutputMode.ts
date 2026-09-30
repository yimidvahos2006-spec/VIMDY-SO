import type { KitchenOutputModeConfig } from "../config/operation";
import type { KitchenOutputMode } from "./kitchenOutput";
import { operationConfigStore } from "../store/operationConfigStore";
import { kitchenOutputModeStore } from "../store/kitchenOutputModeStore";

/**
 * Convierte la configuración persistida (kds/printer/both/none) al tipo
 * legado que usan las implementaciones de salida (pantalla/impresora/ambos).
 */
export function toKitchenOutputMode(configMode: KitchenOutputModeConfig): KitchenOutputMode {
  switch (configMode) {
    case "kds":
      return "pantalla";
    case "printer":
      return "impresora";
    case "both":
      return "ambos";
    case "none":
      return "none";
  }
}

/**
 * Fuente única para decidir dónde debe salir una comanda.
 *
 * Cuando el perfil operativo ya fue hidratado, esa configuración explícita
 * tiene prioridad. Mientras carga, se mantiene compatibilidad con el store
 * legado para no romper sesiones existentes.
 */
export function getEffectiveKitchenOutputMode(): KitchenOutputMode {
  const config = operationConfigStore.get();

  if (config) {
    if (config.kitchenEnabled !== true) {
      return "none";
    }

    if (config.kitchenOutputMode) {
      return toKitchenOutputMode(config.kitchenOutputMode);
    }

    if (config.kdsEnabled && config.printerEnabled) return "ambos";
    if (config.printerEnabled) return "impresora";
    if (config.kdsEnabled) return "pantalla";
    return "none";
  }

  return kitchenOutputModeStore.get();
}
