/* ===========================================================================
   screenWakeLock
   ---------------------------------------------------------------------------
   Mantiene la pantalla encendida (Screen Wake Lock API) mientras la cocina
   está trabajando, para que la tablet / TV del KDS no se apague sola.

   Detalles que importan en la vida real:
     - El navegador SUELTA el bloqueo solo cuando la pestaña queda oculta
       (cambio de app, bloqueo manual, etc.). Por eso al volver a verse la
       pestaña lo pedimos de nuevo.
     - `request()` puede fallar (batería baja, ahorro de energía, permisos).
       Eso nunca debe romper la pantalla: queda en estado "failed" y se
       reintenta la próxima vez que la pestaña vuelva a estar visible.
     - Solo funciona en HTTPS (o localhost). En navegadores sin soporte el
       estado es "unsupported" y la UI puede avisar.

   Sin dependencias de React: se puede probar en Node con dobles (ver
   tests/unit/screenWakeLock.test.ts).
=========================================================================== */

export type ScreenWakeLockStatus = "unsupported" | "inactive" | "active" | "failed";

export interface WakeLockSentinelLike {
  release(): Promise<void>;
  addEventListener(type: "release", listener: () => void): void;
}

export interface WakeLockProviderLike {
  request(type: "screen"): Promise<WakeLockSentinelLike>;
}

export interface VisibilitySourceLike {
  readonly visibilityState: string;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface ScreenWakeLockEnv {
  /** `null` cuando el navegador no soporta la API. */
  wakeLock: WakeLockProviderLike | null;
  document: VisibilitySourceLike;
}

export interface ScreenWakeLock {
  start(): void;
  stop(): Promise<void>;
  getStatus(): ScreenWakeLockStatus;
  subscribe(listener: () => void): () => void;
}

function browserEnv(): ScreenWakeLockEnv {
  const supported = typeof navigator !== "undefined" && "wakeLock" in navigator;
  return {
    wakeLock: supported ? (navigator.wakeLock as unknown as WakeLockProviderLike) : null,
    document
  };
}

export function createScreenWakeLock(env: ScreenWakeLockEnv = browserEnv()): ScreenWakeLock {
  const idleStatus: ScreenWakeLockStatus = env.wakeLock ? "inactive" : "unsupported";
  const listeners = new Set<() => void>();

  let status: ScreenWakeLockStatus = idleStatus;
  let sentinel: WakeLockSentinelLike | null = null;
  let running = false;
  let requesting = false;

  function setStatus(next: ScreenWakeLockStatus) {
    if (next === status) return;
    status = next;
    listeners.forEach(listener => listener());
  }

  async function acquire() {
    if (!env.wakeLock || !running || sentinel || requesting) return;
    // Pedirlo con la pestaña oculta falla; se reintenta al volver a verse.
    if (env.document.visibilityState !== "visible") return;

    requesting = true;
    try {
      const acquired = await env.wakeLock.request("screen");

      if (!running) {
        // Se detuvo mientras esperábamos la respuesta: soltamos de inmediato.
        await acquired.release().catch(() => undefined);
        return;
      }

      sentinel = acquired;
      acquired.addEventListener("release", () => {
        // El navegador lo soltó (pestaña oculta, ahorro de energía...).
        if (sentinel !== acquired) return;
        sentinel = null;
        if (running) setStatus("inactive");
      });
      setStatus("active");
    } catch {
      if (running) setStatus("failed");
    } finally {
      requesting = false;
    }
  }

  function handleVisibilityChange() {
    if (env.document.visibilityState === "visible") void acquire();
  }

  return {
    start() {
      if (running || !env.wakeLock) return;
      running = true;
      env.document.addEventListener("visibilitychange", handleVisibilityChange);
      void acquire();
    },

    async stop() {
      if (!running) return;
      running = false;
      env.document.removeEventListener("visibilitychange", handleVisibilityChange);

      const toRelease = sentinel;
      sentinel = null;
      setStatus(idleStatus);
      await toRelease?.release().catch(() => undefined);
    },

    getStatus: () => status,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}