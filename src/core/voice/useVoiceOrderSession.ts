import { useCallback, useEffect, useRef, useState } from "react";

import { translateBusinessError } from "../errors/translateBusinessError";
import { toast } from "../store/toastStore";
import {
  describeVoiceLine,
  orderNoteText,
  parseVoiceOrder,
  pickBestParse,
  type ParsedVoiceOrder,
  type VoiceCatalogProduct,
  type VoiceOrderLine
} from "./orderParser";
import {
  isMicSecureContext,
  isSpeechRecognitionSupported,
  listenOnce,
  queryMicPermission,
  type SpeechFailure,
  type SpeechListenHandle
} from "./tableSpeechListener";
import { startVoiceCapture, type CaptureFailure, type VoiceCapture } from "./voiceAudio";
import { playVoiceError, playVoiceStart, playVoiceSuccess, primeVoiceAudio } from "./voiceFeedback";

/**
 * Sesión de VIMDY Voice para tomar pedidos. La usan IGUAL la vista de mesas
 * (mesa activa) y la Caja: lo único que cambia es a dónde van las líneas
 * (`onAddLines`) y si se acepta que se nombre una mesa (`checkTable`).
 *
 *   micrófono (AEC + ruido + ganancia dinámica) → reconocedor (3 alternativas)
 *     → parser (mesa, cantidad, producto, "sin X") → onAddLines
 */

/** Línea ya resuelta, lista para agregarse al pedido. */
export interface VoiceAddLine<P extends VoiceCatalogProduct> {
  product: P;
  quantity: number;
  /** "sin arroz, para llevar" */
  note?: string;
}

/** Línea que necesita una decisión del mesero antes de agregarse. */
export interface PendingVoiceLine<P extends VoiceCatalogProduct> {
  id: number;
  line: VoiceOrderLine<P>;
}

export interface VoiceOutcome<P extends VoiceCatalogProduct> {
  /** Lo que se escuchó (o escribió). */
  heard: string;
  /** Líneas ya agregadas, en texto: "2 × Cerveza Águila Light". */
  added: string[];
  pending: PendingVoiceLine<P>[];
  /** Palabras que no se entendieron. */
  unparsed: string[];
  /** El micrófono no estuvo seguro: conviene revisar lo agregado. */
  lowConfidence: boolean;
  error?: string;
  info?: string;
}

export type VoiceSessionPhase = "idle" | "starting" | "listening";

export interface VoiceOrderSession<P extends VoiceCatalogProduct> {
  phase: VoiceSessionPhase;
  /** Mientras se están agregando las líneas al pedido. */
  working: boolean;
  supported: boolean;
  transcript: string;
  /** Nivel del micrófono 0–1 (animación del medidor). */
  level: number;
  outcome: VoiceOutcome<P> | null;
  startListening: () => void;
  stopListening: () => void;
  /** Texto escrito (corrección o contingencia sin micrófono). */
  submitText: (text: string) => void;
  /** Procesa un pedido ya interpretado (p. ej. "Mesa 3, …" dicho en la pantalla de mesas). */
  applyParsed: (parsed: ParsedVoiceOrder<P>, heard: string) => Promise<void>;
  /** El mesero eligió uno de los candidatos de una línea ambigua. */
  resolvePending: (id: number, product: P) => void;
  /** El mesero confirmó una cantidad alta. */
  confirmPending: (id: number) => void;
  discardPending: (id: number) => void;
  openTyping: () => void;
  dismiss: () => void;
}

interface Options<P extends VoiceCatalogProduct> {
  /** Catálogo contra el que se interpreta lo dicho. */
  products: readonly P[];
  /** Agrega las líneas al pedido actual (mesa o carrito). Si falla, debe lanzar. */
  onAddLines: (lines: VoiceAddLine<P>[]) => Promise<void> | void;
  /**
   * Si la frase nombra una mesa ("mesa 3"): devuelve un mensaje si NO se debe
   * agregar (mesa distinta a la activa, o la Caja que no maneja mesas) o null
   * si está bien.
   */
  checkTable?: (tableNumber: number) => string | null;
}

/** Por debajo de esta confianza (si el navegador la informa) se avisa para revisar. */
const LOW_CONFIDENCE = 0.5;
/** Un pedido largo necesita más tiempo que "Mesa 3, 4 personas". */
const ORDER_LISTEN_TIMEOUT_MS = 12000;
/** Nivel de voz (RMS) a partir del cual el micrófono SÍ oyó hablar. */
const HEARD_SPEECH_RMS = 0.02;
/** Fallos seguidos con pista procesada antes de volver al micrófono normal del navegador. */
const MAX_TRACK_FAILURES = 2;
const AUTO_HIDE_MS = 6000;

const FAILURE_MESSAGES: Record<SpeechFailure | CaptureFailure, string> = {
  unsupported: "Este navegador no tiene voz. Escribe el pedido aquí abajo.",
  insecure: "El micrófono solo funciona en una página segura (https). Escribe el pedido aquí abajo.",
  "not-allowed": "Falta el permiso del micrófono. Permítelo en el navegador o escribe el pedido.",
  "audio-capture": "No encuentro un micrófono. Escribe el pedido aquí abajo.",
  network: "La voz necesita internet en este momento. Escribe el pedido aquí abajo.",
  "no-speech": "No te escuché bien. Acércate un poco y repite, o escríbelo.",
  aborted: "",
  unknown: "No pude entender. Repite o escribe el pedido."
};

const BLOCKING_TOASTS: Partial<Record<SpeechFailure | CaptureFailure, string>> = {
  "not-allowed":
    "Micrófono bloqueado. Toca el candado junto a la dirección, activa “Micrófono” y recarga.",
  insecure: "El micrófono necesita una conexión segura (https). Abre Vimdy desde su dirección https.",
  "audio-capture": "No se detecta ningún micrófono en este equipo."
};

/**
 * Compartido entre sesiones: si el reconocedor falla dos veces seguidas aun
 * cuando nuestro medidor SÍ oyó voz, la pista procesada no le está sirviendo a
 * ese navegador y se vuelve a su micrófono normal (que sigue con eco, ruido y
 * ganancia del navegador).
 */
let processedTrackFailures = 0;

const isReady = <P extends VoiceCatalogProduct>(line: VoiceOrderLine<P>): line is VoiceOrderLine<P> & { product: P } =>
  line.status === "matched" && !line.needsConfirm && line.product !== null;

function toAddLine<P extends VoiceCatalogProduct>(line: VoiceOrderLine<P>, product: P): VoiceAddLine<P> {
  return { product, quantity: line.quantity, note: orderNoteText(line) };
}

export function useVoiceOrderSession<P extends VoiceCatalogProduct>(options: Options<P>): VoiceOrderSession<P> {
  const [phase, setPhase] = useState<VoiceSessionPhase>("idle");
  const [working, setWorking] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [level, setLevel] = useState(0);
  const [outcome, setOutcome] = useState<VoiceOutcome<P> | null>(null);

  // Siempre la última versión, sin recrear los callbacks en cada render.
  const optionsRef = useRef(options);
  optionsRef.current = options;

  const handleRef = useRef<SpeechListenHandle | null>(null);
  const captureRef = useRef<VoiceCapture | null>(null);
  const startingRef = useRef(false);
  const busyRef = useRef(false);
  const nextIdRef = useRef(1);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastLevelRef = useRef(0);

  const supported = isSpeechRecognitionSupported();

  const clearHideTimer = useCallback(() => {
    if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    hideTimerRef.current = undefined;
  }, []);

  const releaseCapture = useCallback(() => {
    captureRef.current?.stop();
    captureRef.current = null;
    lastLevelRef.current = 0;
    setLevel(0);
  }, []);

  /** Al desmontar: soltar el micrófono y cancelar lo que esté escuchando. */
  useEffect(
    () => () => {
      handleRef.current?.abort();
      captureRef.current?.stop();
      if (hideTimerRef.current) clearTimeout(hideTimerRef.current);
    },
    []
  );

  /** Agrega al pedido y devuelve null si salió bien, o el mensaje de error. */
  const addToOrder = useCallback(async (lines: VoiceAddLine<P>[]): Promise<string | null> => {
    try {
      await optionsRef.current.onAddLines(lines);
      return null;
    } catch (err) {
      return `${translateBusinessError(err, "No se pudo agregar al pedido.")} Revisa la cuenta antes de repetir.`;
    }
  }, []);

  const fail = useCallback(
    (heard: string, error: string, extra: Partial<VoiceOutcome<P>> = {}) => {
      clearHideTimer();
      playVoiceError();
      setOutcome({ heard, added: [], pending: [], unparsed: [], lowConfidence: false, error, ...extra });
    },
    [clearHideTimer]
  );

  const applyParsed = useCallback(
    async (parsed: ParsedVoiceOrder<P>, heard: string, confidence = 0): Promise<void> => {
      if (busyRef.current) return;
      clearHideTimer();

      if (parsed.lines.length === 0) {
        fail(heard, "No escuché productos del menú. Repite o escríbelo, ej. “2 poker y 1 bandeja”.", {
          unparsed: parsed.unparsed
        });
        return;
      }

      if (parsed.tableNumber !== null) {
        const tableError = optionsRef.current.checkTable?.(parsed.tableNumber) ?? null;
        if (tableError) {
          fail(heard, tableError);
          return;
        }
      }

      const ready = parsed.lines.filter(isReady);
      const pending: PendingVoiceLine<P>[] = parsed.lines
        .filter(line => !isReady(line))
        .map(line => ({ id: nextIdRef.current++, line }));
      const lowConfidence = confidence > 0 && confidence < LOW_CONFIDENCE;

      let added: string[] = [];
      if (ready.length > 0) {
        busyRef.current = true;
        setWorking(true);
        const error = await addToOrder(ready.map(line => toAddLine(line, line.product)));
        busyRef.current = false;
        setWorking(false);

        if (error) {
          fail(heard, error, { pending, unparsed: parsed.unparsed });
          return;
        }
        added = ready.map(describeVoiceLine);
      }

      const clean = pending.length === 0 && parsed.unparsed.length === 0 && !lowConfidence && added.length > 0;
      if (added.length > 0) playVoiceSuccess();
      else playVoiceError();

      setOutcome({ heard, added, pending, unparsed: parsed.unparsed, lowConfidence });

      // Si todo salió limpio el aviso se retira solo; si hay algo por revisar, se queda.
      if (clean) {
        hideTimerRef.current = setTimeout(() => setOutcome(null), AUTO_HIDE_MS);
      }
    },
    [addToOrder, clearHideTimer, fail]
  );

  const submitText = useCallback(
    (text: string) => {
      const heard = text.trim();
      if (!heard) return;
      void applyParsed(parseVoiceOrder(heard, optionsRef.current.products), heard);
    },
    [applyParsed]
  );

  const startListening = useCallback(() => {
    // Segundo toque mientras escucha = cancelar.
    if (handleRef.current) {
      handleRef.current.abort();
      return;
    }
    if (startingRef.current || busyRef.current) return;

    void (async () => {
      startingRef.current = true;
      // El toque es el único momento en que el navegador deja sonar y abrir el micrófono.
      primeVoiceAudio();
      clearHideTimer();
      setOutcome(null);
      setTranscript("");
      setPhase("starting");

      const blockWith = (reason: SpeechFailure | CaptureFailure) => {
        setPhase("idle");
        const text = BLOCKING_TOASTS[reason];
        if (text) toast.warning(text, 9000);
        fail("", FAILURE_MESSAGES[reason]);
      };

      try {
        if (!isMicSecureContext()) return blockWith("insecure");
        if ((await queryMicPermission()) === "denied") return blockWith("not-allowed");

        // Micrófono con eco/ruido/ganancia + cadena Web Audio (ganancia dinámica).
        const captured = await startVoiceCapture({
          onLevel: value => {
            if (Math.abs(value - lastLevelRef.current) > 0.05 || value === 0) {
              lastLevelRef.current = value;
              setLevel(value);
            }
          }
        });

        if (!captured.ok && captured.reason !== "unsupported" && captured.reason !== "unknown") {
          return blockWith(captured.reason);
        }

        const capture = captured.ok ? captured.capture : null;
        captureRef.current = capture;
        const useTrack = Boolean(capture?.processed) && processedTrackFailures < MAX_TRACK_FAILURES;

        setPhase("listening");
        const handle = listenOnce(
          "es-CO",
          { onStart: playVoiceStart, onInterim: setTranscript },
          { audioTrack: useTrack ? capture?.track : null, timeoutMs: ORDER_LISTEN_TIMEOUT_MS }
        );
        handleRef.current = handle;
        const result = await handle.promise;
        handleRef.current = null;
        const heardSpeech = (capture?.peakSpeechRms() ?? 0) > HEARD_SPEECH_RMS;
        releaseCapture();
        setPhase("idle");

        if (!result.ok) {
          setTranscript("");
          if (useTrack && result.reason === "no-speech" && heardSpeech) processedTrackFailures++;
          if (result.reason !== "aborted") {
            const text = BLOCKING_TOASTS[result.reason];
            if (text) toast.warning(text, 9000);
            fail("", FAILURE_MESSAGES[result.reason]);
          }
          return;
        }
        if (useTrack) processedTrackFailures = 0;

        // Con ruido la primera alternativa no siempre es la mejor: se toma la que
        // mejor se explica con el menú.
        const best = pickBestParse(result.alternatives, optionsRef.current.products);
        if (!best) {
          fail("", FAILURE_MESSAGES["no-speech"]);
          return;
        }
        setTranscript(best.transcript);
        await applyParsed(best.parsed, best.transcript, best.confidence);
      } finally {
        startingRef.current = false;
        handleRef.current = null;
        releaseCapture();
        setPhase("idle");
      }
    })();
  }, [applyParsed, clearHideTimer, fail, releaseCapture]);

  const stopListening = useCallback(() => handleRef.current?.abort(), []);

  const removePending = useCallback((id: number) => {
    setOutcome(prev => {
      if (!prev) return prev;
      const pending = prev.pending.filter(p => p.id !== id);
      return { ...prev, pending };
    });
  }, []);

  const addPending = useCallback(
    async (id: number, product: P) => {
      const entry = outcome?.pending.find(p => p.id === id);
      if (!entry || busyRef.current) return;

      busyRef.current = true;
      setWorking(true);
      const error = await addToOrder([toAddLine(entry.line, product)]);
      busyRef.current = false;
      setWorking(false);

      if (error) {
        setOutcome(prev => (prev ? { ...prev, error } : prev));
        playVoiceError();
        return;
      }
      playVoiceSuccess();
      setOutcome(prev =>
        prev
          ? {
              ...prev,
              error: undefined,
              added: [...prev.added, describeVoiceLine({ ...entry.line, product, status: "matched" })],
              pending: prev.pending.filter(p => p.id !== id)
            }
          : prev
      );
    },
    [addToOrder, outcome]
  );

  const resolvePending = useCallback((id: number, product: P) => void addPending(id, product), [addPending]);

  const confirmPending = useCallback(
    (id: number) => {
      const entry = outcome?.pending.find(p => p.id === id);
      if (entry?.line.product) void addPending(id, entry.line.product);
    },
    [addPending, outcome]
  );

  const openTyping = useCallback(() => {
    clearHideTimer();
    setOutcome({
      heard: "",
      added: [],
      pending: [],
      unparsed: [],
      lowConfidence: false,
      info: "Escribe el pedido, ej. “2 poker y 1 bandeja paisa sin arroz”."
    });
  }, [clearHideTimer]);

  const dismiss = useCallback(() => {
    clearHideTimer();
    setOutcome(null);
  }, [clearHideTimer]);

  return {
    phase,
    working,
    supported,
    transcript,
    level,
    outcome,
    startListening,
    stopListening,
    submitText,
    applyParsed: (parsed, heard) => applyParsed(parsed, heard),
    resolvePending,
    confirmPending,
    discardPending: removePending,
    openTyping,
    dismiss
  };
}