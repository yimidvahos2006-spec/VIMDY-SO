/**
 * singleFlight
 * ---------------------------------------------------------------------------
 * Envuelve una tarea asíncrona para que NUNCA corra más de una vez a la vez.
 *
 * - Si nadie la está ejecutando, arranca de inmediato.
 * - Si ya hay una corriendo, quien llame espera a UNA sola ejecución nueva que
 *   arranca cuando termine la actual (así nadie recibe datos más viejos que su
 *   llamada). Todas las llamadas que lleguen mientras tanto comparten esa misma
 *   ejecución.
 *
 * Se usa para el cálculo pesado del snapshot del negocio: antes lo disparaban
 * varios hooks a la vez y la misma tanda de consultas a Supabase se repetía
 * 5 o 6 veces en el arranque.
 */
export function createSingleFlight<T>(task: () => Promise<T>): () => Promise<T> {
  let running: Promise<T> | null = null;
  let queued: Promise<T> | null = null;

  const start = (): Promise<T> => {
    const current: Promise<T> = task().finally(() => {
      if (running === current) running = null;
    });
    running = current;
    return current;
  };

  return () => {
    if (!running) return start();

    if (!queued) {
      queued = running
        .then(
          () => undefined,
          () => undefined,
        )
        .then(() => {
          queued = null;
          return start();
        });
    }

    return queued;
  };
}