import { vimdyCore } from "../VimdyCore";
import { createSingleFlight } from "./singleFlight";

/**
 * liveCatalog
 * ---------------------------------------------------------------------------
 * Mantiene al día el catálogo de una pantalla abierta (ej. Meseros en la
 * tablet del salón). Antes el catálogo se leía una sola vez al abrir la
 * pantalla: si el dueño cambiaba un precio, desactivaba un producto o
 * cambiaba `requiresKitchen`, el mesero seguía con datos viejos hasta
 * recargar la página.
 *
 * Escucha el evento "inventory" del bus (lo emite tanto un cambio local como
 * el de otro dispositivo vía realtimeSync) y vuelve a leer el catálogo.
 * Usa createSingleFlight: nunca hay dos lecturas a la vez, y una ráfaga de
 * eventos se resuelve con UNA lectura nueva, así una respuesta lenta y vieja
 * no puede pisar a una más reciente.
 *
 * Si la lectura falla (sin internet), se conserva el catálogo que ya había.
 * Devuelve la función para dejar de escuchar (llamar al desmontar).
 */
export function startLiveCatalog<T>(options: {
  load: () => Promise<T>;
  apply: (catalog: T) => void;
  onError?: (error: unknown) => void;
}): () => void {
  let active = true;

  const refresh = createSingleFlight(async () => {
    try {
      const catalog = await options.load();
      if (active) options.apply(catalog);
    } catch (error) {
      options.onError?.(error);
    }
  });

  const unsubscribe = vimdyCore.on("inventory", () => {
    void refresh();
  });

  return () => {
    active = false;
    unsubscribe();
  };
}