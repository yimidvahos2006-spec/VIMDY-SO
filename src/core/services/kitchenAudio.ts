/* ===========================================================================
   kitchenAudio
   ---------------------------------------------------------------------------
   Estado del audio de Cocina (Web Audio API) y desbloqueo por gesto.

   Por qué existe: al recargar la página (F5, reinicio de la tablet, deploy)
   el navegador bloquea el audio hasta que la persona toca algo. Sin esto, el
   "Tin" de una comanda nueva fallaba EN SILENCIO y nadie en cocina se enteraba.

   Reglas:
     - UN solo AudioContext compartido (crear uno por aviso termina bloqueado).
     - Estado "enabled" solo si el contexto está realmente en "running".
       Cualquier otro estado ("suspended", "interrupted" de iOS) = "blocked".
     - Cualquier toque / tecla en la página intenta desbloquear solo
       (útil en una TV con control remoto o teclado).
     - `enable()` se llama desde un clic del botón: es el gesto que el
       navegador exige para `resume()`.

   Sin dependencias de React: se prueba en Node con dobles
   (ver tests/unit/kitchenAudio.test.ts).
=========================================================================== */

export type KitchenAudioStatus = "unsupported" | "blocked" | "enabled";

export interface KitchenAudioEnv {
  /** `null` cuando el navegador no soporta Web Audio. */
  createContext: (() => AudioContext) | null;
  document: {
    readonly visibilityState: string;
    addEventListener(type: "visibilitychange", listener: () => void): void;
    removeEventListener(type: "visibilitychange", listener: () => void): void;
  };
  /** Donde se escuchan los gestos del usuario (window en el navegador). */
  gestureTarget: {
    addEventListener(type: string, listener: () => void, options?: AddEventListenerOptions): void;
    removeEventListener(type: string, listener: () => void, options?: EventListenerOptions): void;
  };
}

export interface KitchenAudio {
  /** Crea el contexto (si no existe) y empieza a vigilar su estado. */
  start(): void;
  /** Deja de escuchar gestos. El contexto se conserva: recrearlo lo vuelve a bloquear. */
  stop(): void;
  /** Debe llamarse dentro de un clic/toque. Devuelve el estado resultante. */
  enable(): Promise<KitchenAudioStatus>;
  getStatus(): KitchenAudioStatus;
  /** Contexto compartido, o `null` si no hay soporte. */
  getContext(): AudioContext | null;
  subscribe(listener: () => void): () => void;
}

const GESTURE_EVENTS = ["pointerdown", "touchend", "keydown"] as const;

type WebkitWindow = Window & { webkitAudioContext?: typeof AudioContext };

function browserEnv(): KitchenAudioEnv {
  const Ctor =
    typeof window === "undefined"
      ? undefined
      : (window.AudioContext ?? (window as WebkitWindow).webkitAudioContext);

  return {
    createContext: Ctor ? () => new Ctor() : null,
    document,
    gestureTarget: window
  };
}

export function createKitchenAudio(env: KitchenAudioEnv = browserEnv()): KitchenAudio {
  const listeners = new Set<() => void>();

  let ctx: AudioContext | null = null;
  let status: KitchenAudioStatus = env.createContext ? "blocked" : "unsupported";
  let running = false;

  function setStatus(next: KitchenAudioStatus) {
    if (next === status) return;
    status = next;
    listeners.forEach(listener => listener());
  }

  function syncFromContext() {
    if (!ctx) return;
    setStatus(ctx.state === "running" ? "enabled" : "blocked");
  }

  function ensureContext(): AudioContext | null {
    if (ctx || !env.createContext) return ctx;
    try {
      ctx = env.createContext();
      ctx.addEventListener("statechange", syncFromContext);
    } catch {
      ctx = null;
      setStatus("unsupported");
    }
    return ctx;
  }

  /** Intento silencioso de reanudar: falla sin gesto previo, y está bien. */
  async function tryResume() {
    const context = ensureContext();
    if (!context || context.state === "running") return;
    try {
      await context.resume();
    } catch {
      /* sigue bloqueado: el botón lo resuelve */
    }
    syncFromContext();
  }

  function handleGesture() {
    void tryResume().then(() => {
      if (status === "enabled") detachGestures();
    });
  }

  function handleVisibility() {
    if (env.document.visibilityState === "visible") void tryResume();
  }

  function attachGestures() {
    GESTURE_EVENTS.forEach(type => env.gestureTarget.addEventListener(type, handleGesture, { passive: true }));
  }

  function detachGestures() {
    GESTURE_EVENTS.forEach(type => env.gestureTarget.removeEventListener(type, handleGesture));
  }

  return {
    start() {
      if (running) return;
      running = true;
      if (!ensureContext()) return;

      syncFromContext();
      env.document.addEventListener("visibilitychange", handleVisibility);
      if (status !== "enabled") attachGestures();
      // Si el navegador ya lo permite (actividad previa en el sitio), arranca solo.
      void tryResume();
    },

    stop() {
      if (!running) return;
      running = false;
      detachGestures();
      env.document.removeEventListener("visibilitychange", handleVisibility);
    },

    async enable() {
      // `resume()` se invoca de forma síncrona dentro del clic (sin await antes).
      await tryResume();
      return status;
    },

    getStatus: () => status,
    getContext: () => ctx,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    }
  };
}

let shared: KitchenAudio | null = null;

/** Instancia única de la app (un AudioContext por pestaña). */
export function getKitchenAudio(): KitchenAudio {
  shared ??= createKitchenAudio();
  return shared;
}