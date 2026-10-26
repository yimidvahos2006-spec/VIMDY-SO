/**
 * Escucha UNA frase con la API nativa del navegador
 * (window.SpeechRecognition / webkitSpeechRecognition).
 *
 * Diferencias con `speechRecognition.ts` (el de pedidos de productos):
 *  - devuelve el motivo exacto del fallo (permiso, sin voz, sin red…)
 *  - pide varias alternativas para elegir la que sí se entiende
 *  - se puede cancelar (al desmontar o al volver a presionar el botón)
 *  - tiene un tope de tiempo para que nunca se quede "escuchando" colgado
 */

export type SpeechFailure =
  | "unsupported"   // el navegador no tiene reconocimiento de voz
  | "not-allowed"   // el mesero negó el permiso del micrófono
  | "no-speech"     // no se escuchó nada (silencio / mucho ruido)
  | "audio-capture" // no hay micrófono disponible
  | "network"       // el motor de voz del navegador necesita internet
  | "insecure"      // la página no está en HTTPS: el navegador bloquea el micrófono
  | "aborted"       // se canceló a propósito (no mostrar error)
  | "unknown";

export interface SpeechAlternative {
  transcript: string;
  /** 0–1. Algunos navegadores devuelven 0 cuando no la informan. */
  confidence: number;
}

export type SpeechListenResult =
  | { ok: true; alternatives: SpeechAlternative[] }
  | { ok: false; reason: SpeechFailure };

export interface SpeechListenHandle {
  promise: Promise<SpeechListenResult>;
  /** Cancela la escucha; la promesa resuelve con reason "aborted". */
  abort: () => void;
}

interface RecognitionLike {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  continuous: boolean;
  /** `track` (Chrome reciente): reconoce sobre ESA pista en vez de abrir su propio micrófono. */
  start: (track?: MediaStreamTrack) => void;
  stop: () => void;
  abort: () => void;
  onstart: (() => void) | null;
  onresult: ((event: any) => void) | null;
  onerror: ((event: any) => void) | null;
  onend: (() => void) | null;
}

type RecognitionCtor = new () => RecognitionLike;

function getRecognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

export function isSpeechRecognitionSupported(): boolean {
  return getRecognitionCtor() !== null;
}

const LISTEN_TIMEOUT_MS = 7000;

/** Opciones de la escucha (todas opcionales; sin ellas se comporta como siempre). */
export interface ListenOptions {
  /**
   * Pista de audio ya capturada y procesada (cancelación de eco, ruido y
   * ganancia dinámica; ver voiceAudio.ts). Los navegadores que no soportan
   * `start(track)` la ignoran y usan su micrófono normal.
   */
  audioTrack?: MediaStreamTrack | null;
  /** Tope de escucha en ms. Un pedido largo necesita más que "Mesa 3, 4 personas". */
  timeoutMs?: number;
}

/** Callbacks opcionales del ciclo de vida (onstart / onresult parcial / onend). */
export interface ListenCallbacks {
  /** El micrófono ya está capturando audio. */
  onStart?: () => void;
  /** Texto parcial mientras el mesero todavía habla. */
  onInterim?: (text: string) => void;
  /** El motor terminó (con o sin resultado). */
  onEnd?: () => void;
}

/**
 * HTTPS (o localhost) es obligatorio para el micrófono. En producción sobre
 * un dominio con HTTPS esto siempre es true; sirve para avisar claro en
 * pruebas por IP/HTTP en vez de fallar en silencio.
 */
export function isMicSecureContext(): boolean {
  return typeof window === "undefined" || window.isSecureContext !== false;
}

/**
 * Consulta (si el navegador lo permite) si el permiso del micrófono ya fue
 * negado, para avisar al instante sin esperar al error del reconocedor.
 * Safari/Firefox no soportan esta consulta: ahí devuelve "unknown".
 */
export async function queryMicPermission(): Promise<"granted" | "denied" | "prompt" | "unknown"> {
  try {
    const permissions = (navigator as unknown as {
      permissions?: { query: (d: { name: string }) => Promise<{ state: string }> };
    }).permissions;
    if (!permissions) return "unknown";
    const status = await permissions.query({ name: "microphone" });
    return status.state === "granted" || status.state === "denied" || status.state === "prompt"
      ? status.state
      : "unknown";
  } catch {
    return "unknown";
  }
}

export function listenOnce(
  lang = "es-CO",
  callbacks: ListenCallbacks = {},
  options: ListenOptions = {}
): SpeechListenHandle {
  const Ctor = getRecognitionCtor();

  if (!isMicSecureContext()) {
    return {
      promise: Promise.resolve({ ok: false, reason: "insecure" } as const),
      abort: () => undefined
    };
  }

  if (!Ctor) {
    return {
      promise: Promise.resolve({ ok: false, reason: "unsupported" } as const),
      abort: () => undefined
    };
  }

  const recognition = new Ctor();
  let settled = false;
  let aborted = false;
  /** Último texto parcial: si el motor corta sin resultado final, se aprovecha. */
  let lastPartial = "";
  let timer: ReturnType<typeof setTimeout> | undefined;
  let finish: (result: SpeechListenResult) => void = () => undefined;

  const promise = new Promise<SpeechListenResult>(resolve => {
    finish = (result: SpeechListenResult) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      resolve(result);
    };
  });

  recognition.lang = lang;
  recognition.interimResults = Boolean(callbacks.onInterim);
  recognition.continuous = false;
  recognition.maxAlternatives = 3;

  recognition.onstart = () => callbacks.onStart?.();

  recognition.onresult = (event: any) => {
    const first = event.results?.[event.results.length - 1];

    // Resultado parcial: se muestra en pantalla y se sigue esperando el final.
    if (first && first.isFinal === false) {
      const partial = String(first[0]?.transcript ?? "").trim();
      if (partial) {
        lastPartial = partial;
        callbacks.onInterim?.(partial);
      }
      return;
    }

    const alternatives: SpeechAlternative[] = [];
    if (first) {
      for (let i = 0; i < first.length; i++) {
        const transcript = String(first[i].transcript ?? "").trim();
        if (transcript) {
          alternatives.push({ transcript, confidence: Number(first[i].confidence) || 0 });
        }
      }
    }
    finish(alternatives.length > 0
      ? { ok: true, alternatives }
      : { ok: false, reason: "no-speech" });
  };

  recognition.onerror = (event: any) => {
    const code = String(event?.error ?? "");
    if (code === "aborted") return finish({ ok: false, reason: "aborted" });
    if (code === "no-speech") return finish({ ok: false, reason: "no-speech" });
    if (code === "not-allowed" || code === "service-not-allowed") return finish({ ok: false, reason: "not-allowed" });
    if (code === "audio-capture") return finish({ ok: false, reason: "audio-capture" });
    if (code === "network") return finish({ ok: false, reason: "network" });
    finish({ ok: false, reason: "unknown" });
  };

  // Si el motor termina sin resultado ni error, no dejar la promesa colgada.
  recognition.onend = () => {
    callbacks.onEnd?.();
    if (!aborted && lastPartial) {
      finish({ ok: true, alternatives: [{ transcript: lastPartial, confidence: 0 }] });
      return;
    }
    finish({ ok: false, reason: aborted ? "aborted" : "no-speech" });
  };

  timer = setTimeout(() => {
    try { recognition.stop(); } catch { /* ya estaba detenido */ }
    finish(lastPartial
      ? { ok: true, alternatives: [{ transcript: lastPartial, confidence: 0 }] }
      : { ok: false, reason: "no-speech" });
  }, options.timeoutMs ?? LISTEN_TIMEOUT_MS);

  try {
    if (options.audioTrack) {
      try {
        recognition.start(options.audioTrack);
      } catch {
        // El navegador no aceptó la pista: se reconoce con su micrófono normal.
        recognition.start();
      }
    } else {
      recognition.start();
    }
  } catch {
    finish({ ok: false, reason: "unknown" });
  }

  return {
    promise,
    abort: () => {
      aborted = true;
      try { recognition.abort(); } catch { /* noop */ }
      finish({ ok: false, reason: "aborted" });
    }
  };
}