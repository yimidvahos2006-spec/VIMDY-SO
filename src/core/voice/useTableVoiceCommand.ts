import { useCallback, useEffect, useRef, useState } from "react";

import type { Product, Table } from "../entities/Entities";
import { toast } from "../store/toastStore";
import { describeVoiceLine, parseVoiceOrder, pickBestParse, type ParsedVoiceOrder } from "./orderParser";
import {
  isMicSecureContext,
  isSpeechRecognitionSupported,
  listenOnce,
  queryMicPermission,
  SpeechFailure,
  SpeechListenHandle
} from "./tableSpeechListener";
import { parseVoiceCommand } from "./tableVoiceParser";
import { findTablesByNumber } from "./tableVoiceResolver";
import { playVoiceError, playVoiceStart, playVoiceSuccess, primeVoiceAudio } from "./voiceFeedback";

/** Por debajo de esto pedimos confirmación rápida en vez de actuar directo. */
const LOW_CONFIDENCE = 0.5;

export type VoicePhase = "idle" | "listening";

/** Lo que el hook le entrega a la pantalla cuando SÍ entendió una mesa. */
export interface TableVoiceTarget {
  table: Table;
  /** null = no se dijo; el diálogo usa su valor por defecto. */
  peopleCount: number | null;
  /** Pedido dictado junto a la mesa ("Mesa 3, dos cervezas…"): se agrega al abrirla. */
  order?: ParsedVoiceOrder<Product> | null;
}

/** Orden de unir dos mesas: la cuenta de `secondary` pasa a `primary`. */
export interface TableVoiceMerge {
  primary: Table;
  secondary: Table;
  /** null = no se dijo; se conserva la suma de comensales de ambas. */
  peopleCount: number | null;
}

/** Aviso del fallback (la voz no se entendió o hay que decidir algo). */
export interface VoiceFallback {
  message: string;
  /** Lo que se escuchó — queda en el campo para corregirlo escribiendo. */
  heard: string;
  /** Mesas entre las que elegir con un toque (zonas repetidas). */
  choices?: Table[];
  peopleCount?: number | null;
  /** Pedido que acompaña a la mesa, para no perderlo al elegir entre mesas repetidas. */
  order?: ParsedVoiceOrder<Product> | null;
  /** Interpretación dudosa que se puede confirmar con un toque. */
  suggestion?: TableVoiceTarget;
  /** Unir mesas siempre se confirma con un toque: mueve cuentas. */
  mergeSuggestion?: TableVoiceMerge;
}

const FAILURE_MESSAGES: Record<SpeechFailure, string> = {
  unsupported: "Este navegador no tiene voz. Escríbelo: ej. “3 4” (mesa 3, 4 personas).",
  "not-allowed": "Falta el permiso del micrófono. Escríbelo o permite el micrófono en el navegador.",
  "no-speech": "No te escuché bien. Repite o escríbelo rápido: ej. “3 4”.",
  "audio-capture": "No encuentro un micrófono. Escríbelo: ej. “3 4”.",
  network: "La voz necesita internet. Escríbelo: ej. “3 4”.",
  insecure: "El micrófono solo funciona en una página segura (https). Escribe el comando aquí abajo.",
  aborted: "",
  unknown: "No pude entender. Repite o escríbelo: ej. “3 4”."
};

/** Aviso tipo toast, más claro que el panel, para los fallos que el mesero puede arreglar. */
const FAILURE_TOASTS: Partial<Record<SpeechFailure, string>> = {
  "not-allowed":
    "Micrófono bloqueado. Toca el candado junto a la dirección, activa “Micrófono” y recarga. Mientras tanto usa el panel de comando rápido.",
  insecure:
    "El micrófono necesita una conexión segura (https). Abre Vimdy desde su dirección https o usa el panel de comando rápido.",
  "audio-capture": "No se detecta ningún micrófono en este equipo. Usa el panel de comando rápido.",
  network: "La voz necesita internet en este momento. Usa el panel de comando rápido."
};

interface Options {
  /** Mesas actuales (se leen al momento de resolver, siempre frescas). */
  tables: readonly Table[];
  /** Se llama cuando hay una mesa clara para abrir. */
  onTarget: (target: TableVoiceTarget) => void;
  /** Se llama cuando el mesero CONFIRMÓ unir dos mesas. */
  onMerge?: (merge: TableVoiceMerge) => void;
  /**
   * Catálogo: si se pasa, una frase como "Mesa 3, dos cervezas águila light y
   * una bandeja paisa sin arroz" abre la mesa 3 y entrega el pedido ya
   * interpretado en `target.order`.
   */
  products?: readonly Product[];
}

/** "Mesa N" + al menos un producto entendido (o dudoso) = es un pedido, no solo abrir mesa. */
function isOrderCommand(parsed: ParsedVoiceOrder<Product>): boolean {
  return parsed.tableNumber !== null && parsed.lines.length > 0;
}

export function useTableVoiceCommand({ tables, onTarget, onMerge, products }: Options) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [fallback, setFallback] = useState<VoiceFallback | null>(null);
  /** Texto que se va escuchando en tiempo real (parcial o final). */
  const [transcript, setTranscript] = useState("");

  const handleRef = useRef<SpeechListenHandle | null>(null);
  const tablesRef = useRef(tables);
  const onTargetRef = useRef(onTarget);
  const onMergeRef = useRef(onMerge);
  const productsRef = useRef(products);
  productsRef.current = products;
  tablesRef.current = tables;
  onTargetRef.current = onTarget;
  onMergeRef.current = onMerge;

  const supported = isSpeechRecognitionSupported();

  /** Cancela cualquier escucha activa al desmontar la pantalla. */
  useEffect(() => () => handleRef.current?.abort(), []);

  const fail = useCallback((next: VoiceFallback) => {
    playVoiceError();
    setFallback(next);
  }, []);

  /**
   * Núcleo único: lo usan tanto la voz como el texto escrito del fallback,
   * así los dos caminos se comportan exactamente igual.
   */
  const resolveText = useCallback((text: string, lowConfidence = false, strict = false) => {
    /* ------------------------ Mesa + pedido en una frase ------------------------ */
    const catalog = productsRef.current;
    if (catalog) {
      const order = parseVoiceOrder(text, catalog);
      if (isOrderCommand(order)) {
        const orderTableNumber = order.tableNumber as number;
        const tableMatches = findTablesByNumber(tablesRef.current, orderTableNumber);

        if (tableMatches.length === 0) {
          fail({ message: `No encuentro la mesa ${orderTableNumber}. Corrígela o repite.`, heard: text });
          return;
        }

        if (tableMatches.length > 1) {
          setFallback({
            message: `Hay ${tableMatches.length} mesas con el número ${orderTableNumber}. Toca la correcta:`,
            heard: text,
            choices: tableMatches,
            peopleCount: null,
            order
          });
          return;
        }

        const orderTarget: TableVoiceTarget = { table: tableMatches[0], peopleCount: null, order };

        if (lowConfidence) {
          setFallback({
            message: `¿Entendí bien? ${tableMatches[0].name}: ${order.lines.map(describeVoiceLine).join(", ")}`,
            heard: text,
            suggestion: orderTarget
          });
          return;
        }

        setFallback(null);
        playVoiceSuccess();
        onTargetRef.current(orderTarget);
        return;
      }
    }

    const command = parseVoiceCommand(text, { strict });

    if (command.kind === "none") {
      fail({
        message: strict
          ? "No escuché una orden de mesa. Di “Mesa 3, 4 personas” o “Unir mesa 5 y 4”."
          : "No entendí el número de mesa. Repite o escríbelo: ej. “3 4”.",
        heard: text
      });
      return;
    }

    /* ----------------------------- Unir mesas ----------------------------- */
    if (command.kind === "merge") {
      const [firstNumber, secondNumber] = command.tableNumbers;
      const firstMatches = findTablesByNumber(tablesRef.current, firstNumber);
      const secondMatches = findTablesByNumber(tablesRef.current, secondNumber);

      const missing = firstMatches.length === 0 ? firstNumber : secondMatches.length === 0 ? secondNumber : null;
      if (missing !== null) {
        fail({ message: `No encuentro la mesa ${missing}. Corrígela o repite.`, heard: text });
        return;
      }

      if (firstMatches.length > 1 || secondMatches.length > 1) {
        fail({
          message: "Hay mesas con el mismo número en varias zonas. Une desde la mesa → “Unir mesa”.",
          heard: text
        });
        return;
      }

      const people = command.peopleCount ? `, ${command.peopleCount} personas` : "";
      setFallback({
        message: `¿Unir ${firstMatches[0].name} con ${secondMatches[0].name}${people}?`,
        heard: text,
        mergeSuggestion: {
          primary: firstMatches[0],
          secondary: secondMatches[0],
          peopleCount: command.peopleCount
        }
      });
      return;
    }

    /* ----------------------------- Abrir mesa ----------------------------- */
    const matches = findTablesByNumber(tablesRef.current, command.tableNumber);

    if (matches.length === 0) {
      fail({
        message: `No encuentro la mesa ${command.tableNumber}. Corrígela o repite.`,
        heard: text
      });
      return;
    }

    if (matches.length > 1) {
      setFallback({
        message: `Hay ${matches.length} mesas con el número ${command.tableNumber}. Toca la correcta:`,
        heard: text,
        choices: matches,
        peopleCount: command.peopleCount
      });
      return;
    }

    const target: TableVoiceTarget = { table: matches[0], peopleCount: command.peopleCount };

    if (lowConfidence) {
      const people = command.peopleCount ? `, ${command.peopleCount} personas` : "";
      setFallback({
        message: `¿Entendí bien? ${matches[0].name}${people}`,
        heard: text,
        suggestion: target
      });
      return;
    }

    setFallback(null);
    playVoiceSuccess();
    onTargetRef.current(target);
  }, [fail]);

  const startListening = useCallback(async () => {
    // Segundo toque mientras escucha = cancelar.
    if (handleRef.current) {
      handleRef.current.abort();
      return;
    }

    // El toque del mesero es el único momento en que el navegador deja sonar.
    primeVoiceAudio();
    setFallback(null);
    setTranscript("");

    if (!isMicSecureContext()) {
      playVoiceError();
      toast.warning(FAILURE_TOASTS.insecure!, 9000);
      setFallback({ message: FAILURE_MESSAGES.insecure, heard: "" });
      return;
    }

    // Si el permiso ya está negado, avisar de una vez en vez de dar vueltas.
    if ((await queryMicPermission()) === "denied") {
      playVoiceError();
      toast.warning(FAILURE_TOASTS["not-allowed"]!, 9000);
      setFallback({ message: FAILURE_MESSAGES["not-allowed"], heard: "" });
      return;
    }

    setPhase("listening");

    const handle = listenOnce("es-CO", {
      onStart: playVoiceStart,
      onInterim: setTranscript,
      onEnd: () => setPhase("idle")
    });
    handleRef.current = handle;
    const result = await handle.promise;
    handleRef.current = null;
    setPhase("idle");

    if (!result.ok) {
      setTranscript("");
      if (result.reason !== "aborted") {
        playVoiceError();
        const toastText = FAILURE_TOASTS[result.reason];
        if (toastText) toast.warning(toastText, 9000);
        setFallback({ message: FAILURE_MESSAGES[result.reason], heard: "" });
      }
      return;
    }

    // Con ruido, la mejor alternativa no siempre es la primera: tomamos la
    // primera que cumple el filtro estricto (orden de mesa, frase corta).
    // Si ninguna lo cumple, se trata como ruido y no se abre nada.
    const orderBest = productsRef.current
      ? pickBestParse(result.alternatives, productsRef.current)
      : null;
    const best =
      orderBest && isOrderCommand(orderBest.parsed)
        ? { transcript: orderBest.transcript, confidence: orderBest.confidence }
        : result.alternatives.find(
            alt => parseVoiceCommand(alt.transcript, { strict: true }).kind !== "none"
          ) ?? result.alternatives[0];

    setTranscript(best.transcript);
    const lowConfidence = best.confidence > 0 && best.confidence < LOW_CONFIDENCE;
    resolveText(best.transcript, lowConfidence, true);
  }, [resolveText]);

  /** Texto escrito en el fallback. */
  const submitText = useCallback((text: string) => {
    if (!text.trim()) return;
    resolveText(text, false);
  }, [resolveText]);

  /** Toque en una opción (mesa repetida en zonas) o en “Sí, abrir”. */
  const pick = useCallback((target: TableVoiceTarget) => {
    setFallback(null);
    playVoiceSuccess();
    onTargetRef.current(target);
  }, []);

  /** Toque en “Sí, unir”. */
  const confirmMerge = useCallback((merge: TableVoiceMerge) => {
    setFallback(null);
    onMergeRef.current?.(merge);
  }, []);

  const dismiss = useCallback(() => setFallback(null), []);

  /** Abre el panel de comando rápido (contingencia sin micrófono). */
  const openTyping = useCallback(() => {
    setFallback({ message: "Escribe: mesa y personas, ej. “3 4”, o “unir 5 y 4”.", heard: "" });
  }, []);

  return {
    phase,
    supported,
    fallback,
    transcript,
    startListening,
    submitText,
    pick,
    confirmMerge,
    dismiss,
    openTyping
  };
}