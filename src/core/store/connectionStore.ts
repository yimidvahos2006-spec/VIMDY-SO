import { ObservableStore } from "./ObservableStore";
import { checkSupabaseReachable } from "../../infrastructure/supabase/supabaseClient";

export interface ConnectionSnapshot {
  /**
   * `navigator.onLine` tal cual lo reporta el navegador. Cambia al
   * instante con los eventos `online`/`offline`, pero NO es información
   * confiable por sí sola: el navegador puede reportar `true` con un
   * wifi conectado pero sin salida real a internet (router caído,
   * portal cautivo, etc.). Cuando dice `false` sí es confiable — un
   * navegador no reporta "offline" por error.
   */
  browserOnline: boolean;
  /**
   * Resultado del último ping REAL contra Supabase
   * (ver checkSupabaseReachable en supabaseClient.ts). `null` = todavía
   * no se ha hecho ningún ping desde que arrancó la app.
   */
  serverReachable: boolean | null;
  /** Fecha del último ping real, haya salido bien o mal. */
  lastCheckedAt: Date | null;
  /** true mientras un ping está en curso, para no lanzar dos a la vez. */
  checking: boolean;
}

/** Cada cuánto se repite el ping real mientras la pestaña sigue abierta. */
const PING_INTERVAL_MS = 20_000;
/** Cuánto se espera una respuesta de Supabase antes de darla por caída. */
const PING_TIMEOUT_MS = 5_000;

function buildInitialSnapshot(): ConnectionSnapshot {
  return {
    browserOnline: typeof navigator !== "undefined" ? navigator.onLine : true,
    serverReachable: null,
    lastCheckedAt: null,
    checking: false
  };
}

/**
 * connectionStore
 * ---------------------------------------------------------------------------
 * Parte 1 del plan de ventas offline: la base de todo lo demás (cola local,
 * caída controlada de processSale, sincronización, banner del cajero) lee
 * de aquí para saber si hay internet real en este momento.
 *
 * Es un singleton que se auto-inicializa al importarse (igual que
 * `supabase` en supabaseClient.ts): apenas se carga el módulo, ya está
 * escuchando los eventos `online`/`offline` del navegador y arrancó su
 * propio ping periódico contra Supabase. No depende de que algún
 * componente lo monte primero — así cualquier parte de la app (incluida
 * lógica fuera de React, como SalesEngine) puede preguntarle en cualquier
 * momento con `connectionStore.isOnline()`.
 *
 * Regla para decidir "¿hay internet de verdad?" (ver isOnline()):
 *   - Si el navegador dice `offline` -> le creemos de inmediato. Es la
 *     única señal 100% confiable que tenemos sin pedirle nada a nadie.
 *   - Si el navegador dice `online` -> no basta, hay que haber confirmado
 *     con al menos un ping real que no fue negativo. Antes del primer
 *     ping (serverReachable === null) confiamos en el navegador para no
 *     bloquear el arranque de la app con un falso "sin conexión".
 */
class ConnectionStore extends ObservableStore<ConnectionSnapshot> {
  private intervalId: ReturnType<typeof setInterval> | null = null;
  private started = false;

  constructor() {
    super(buildInitialSnapshot());
    this.start();
  }

  /**
   * Separado del constructor para poder probarlo en aislamiento (tests
   * de Parte 7) sin depender de que el entorno tenga `window`/`navigator`
   * reales. En el navegador se llama solo, una vez, desde el constructor.
   */
  start(): void {
    if (this.started || typeof window === "undefined") return;
    this.started = true;

    window.addEventListener("online", this.handleBrowserOnline);
    window.addEventListener("offline", this.handleBrowserOffline);

    // No esperar los primeros PING_INTERVAL_MS para saber si en verdad
    // hay internet: se confirma una vez apenas arranca la app.
    void this.checkNow();

    this.intervalId = setInterval(() => {
      void this.checkNow();
    }, PING_INTERVAL_MS);
  }

  /** Para tests o para un eventual "cerrar sesión" que limpie listeners. */
  stop(): void {
    if (!this.started) return;
    this.started = false;

    window.removeEventListener("online", this.handleBrowserOnline);
    window.removeEventListener("offline", this.handleBrowserOffline);

    if (this.intervalId !== null) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  private handleBrowserOnline = (): void => {
    this.publish({ ...this.snapshot, browserOnline: true });
    // El navegador dice que volvió, pero eso puede mentir (ver arriba).
    // Confirmamos con un ping real de inmediato en vez de esperar al
    // próximo tick del intervalo — así el resto de la app (banner,
    // sincronización de la cola) reacciona lo antes posible.
    void this.checkNow();
  };

  private handleBrowserOffline = (): void => {
    // Cuando el navegador dice "offline" le creemos sin necesidad de
    // pingear: es una señal confiable cuando dice que no hay conexión
    // (el problema es solo cuando dice que sí sin base real).
    this.publish({
      ...this.snapshot,
      browserOnline: false,
      serverReachable: false,
      lastCheckedAt: new Date()
    });
  };

  /**
   * Dispara un ping real contra Supabase ya mismo, sin esperar al
   * intervalo. Devuelve si el servidor respondió o no. Cualquier
   * componente puede llamarlo directamente (ej. un botón "Reintentar"
   * en el banner de la Parte 5).
   */
  async checkNow(): Promise<boolean> {
    if (this.snapshot.checking) {
      return this.snapshot.serverReachable ?? false;
    }

    this.publish({ ...this.snapshot, checking: true });

    const reachable = await checkSupabaseReachable(PING_TIMEOUT_MS);

    this.publish({
      ...this.snapshot,
      checking: false,
      serverReachable: reachable,
      lastCheckedAt: new Date()
    });

    return reachable;
  }

  /**
   * Punto de entrada imperativo para código que no es un componente React
   * (engines, servicios) — igual que `toast.error(...)` en toastStore.
   * Ver la regla completa en el comentario de la clase.
   */
  isOnline(): boolean {
    const { browserOnline, serverReachable } = this.snapshot;
    if (!browserOnline) return false;
    return serverReachable !== false;
  }
}

export const connectionStore = new ConnectionStore();