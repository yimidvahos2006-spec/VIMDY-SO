// src/core/utils/staleWhileRevalidate.ts
/* ===========================================================================
   staleWhileRevalidate
   ---------------------------------------------------------------------------
   Patrón "muestra lo guardado al instante, refresca por detrás":

     1. Pide el dato fresco a la red YA (sin esperar nada más).
     2. En paralelo lee el caché local. Si el caché llega antes que la red,
        se entrega de inmediato (`source: "cache"`) para que la pantalla
        abra sin espera.
     3. Cuando llega el dato fresco se entrega (`source: "network"`) y
        reemplaza lo anterior. Un caché que llegue DESPUÉS de la red se
        descarta: nunca se pisa un dato fresco con uno viejo.
     4. Si la red falla pero ya se mostró el caché, NO se rompe la pantalla:
        se avisa por `onRevalidateError` y se conserva lo que se ve. Si la
        red falla y no había caché, el error se propaga (nada que mostrar).

   Es lógica pura (sin React, sin IndexedDB), así que se prueba con tests
   normales de vitest.
=========================================================================== */

export type SwrSource = "cache" | "network";

export interface StaleWhileRevalidateOptions<T> {
  /** Lee el caché local. Devuelve null si todavía no hay nada guardado. */
  readCache: () => Promise<T | null>;
  /** Pide el dato fresco a la red (y, si quiere, lo guarda en el caché). */
  fetchFresh: () => Promise<T>;
  /** Se llama con el caché (si hay) y luego con el dato fresco. */
  onData: (data: T, source: SwrSource) => void;
  /** La red falló. `hadCache` es true si ya se estaba mostrando el caché. */
  onRevalidateError?: (error: unknown, hadCache: boolean) => void;
  /** Si devuelve true (ej. el componente se desmontó) no se entrega nada más. */
  isCancelled?: () => boolean;
}

type NetworkOutcome<T> = { ok: true; value: T } | { ok: false; error: unknown };

/**
 * Devuelve el último dato entregado (fresco si la red respondió; caché si la
 * red falló pero había caché; null si se canceló). Lanza solo si la red falló
 * y no había nada que mostrar.
 */
export async function staleWhileRevalidate<T>(
  options: StaleWhileRevalidateOptions<T>
): Promise<T | null> {
  const { readCache, fetchFresh, onData, onRevalidateError, isCancelled } = options;
  const cancelled = (): boolean => (isCancelled ? isCancelled() : false);

  let networkSettled = false;
  let delivered: T | null = null;
  let hadCache = false;

  // La red arranca primero y sin esperar al caché.
  const networkPromise: Promise<NetworkOutcome<T>> = fetchFresh().then(
    (value): NetworkOutcome<T> => ({ ok: true, value }),
    (error: unknown): NetworkOutcome<T> => ({ ok: false, error })
  );
  void networkPromise.then(() => {
    networkSettled = true;
  });

  // Un caché que falla al leerse equivale a "no hay caché": nunca rompe la carga.
  const cachePromise = readCache().then(
    (value) => value,
    () => null
  );

  const cached = await cachePromise;
  if (cached !== null && !networkSettled && !cancelled()) {
    hadCache = true;
    delivered = cached;
    onData(cached, "cache");
  }

  const outcome = await networkPromise;
  if (cancelled()) return null;

  if (outcome.ok) {
    delivered = outcome.value;
    onData(outcome.value, "network");
    return delivered;
  }

  if (hadCache) {
    onRevalidateError?.(outcome.error, true);
    return delivered;
  }

  // El caché llegó cuando la red ya había terminado (y falló): se usa como
  // respaldo en vez de dejar la pantalla vacía.
  if (cached !== null) {
    onData(cached, "cache");
    onRevalidateError?.(outcome.error, true);
    return cached;
  }

  onRevalidateError?.(outcome.error, false);
  throw outcome.error;
}