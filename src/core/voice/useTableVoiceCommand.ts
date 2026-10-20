import { useCallback, useEffect, useRef, useState } from "react";

import type { Table } from "../entities/Entities";
import { isSpeechRecognitionSupported, listenOnce, SpeechFailure, SpeechListenHandle } from "./tableSpeechListener";
import { parseTableCommand } from "./tableVoiceParser";
import { findTablesByNumber } from "./tableVoiceResolver";

/** Por debajo de esto pedimos confirmación rápida en vez de actuar directo. */
const LOW_CONFIDENCE = 0.5;

export type VoicePhase = "idle" | "listening";

/** Lo que el hook le entrega a la pantalla cuando SÍ entendió una mesa. */
export interface TableVoiceTarget {
  table: Table;
  /** null = no se dijo; el diálogo usa su valor por defecto. */
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
  /** Interpretación dudosa que se puede confirmar con un toque. */
  suggestion?: TableVoiceTarget;
}

const FAILURE_MESSAGES: Record<SpeechFailure, string> = {
  unsupported: "Este navegador no tiene voz. Escríbelo: ej. “3 4” (mesa 3, 4 personas).",
  "not-allowed": "Falta el permiso del micrófono. Escríbelo o permite el micrófono en el navegador.",
  "no-speech": "No te escuché bien. Repite o escríbelo rápido: ej. “3 4”.",
  "audio-capture": "No encuentro un micrófono. Escríbelo: ej. “3 4”.",
  network: "La voz necesita internet. Escríbelo: ej. “3 4”.",
  aborted: "",
  unknown: "No pude entender. Repite o escríbelo: ej. “3 4”."
};

interface Options {
  /** Mesas actuales (se leen al momento de resolver, siempre frescas). */
  tables: readonly Table[];
  /** Se llama cuando hay una mesa clara para abrir. */
  onTarget: (target: TableVoiceTarget) => void;
}

export function useTableVoiceCommand({ tables, onTarget }: Options) {
  const [phase, setPhase] = useState<VoicePhase>("idle");
  const [fallback, setFallback] = useState<VoiceFallback | null>(null);

  const handleRef = useRef<SpeechListenHandle | null>(null);
  const tablesRef = useRef(tables);
  const onTargetRef = useRef(onTarget);
  tablesRef.current = tables;
  onTargetRef.current = onTarget;

  const supported = isSpeechRecognitionSupported();

  /** Cancela cualquier escucha activa al desmontar la pantalla. */
  useEffect(() => () => handleRef.current?.abort(), []);

  /**
   * Núcleo único: lo usan tanto la voz como el texto escrito del fallback,
   * así los dos caminos se comportan exactamente igual.
   */
  const resolveText = useCallback((text: string, lowConfidence = false, strict = false) => {
    const command = parseTableCommand(text, { strict });

    if (command.tableNumber === null) {
      setFallback({
        message: strict
          ? "No escuché una orden de mesa. Di “Mesa 3, 4 personas” o escríbelo."
          : "No entendí el número de mesa. Repite o escríbelo: ej. “3 4”.",
        heard: text
      });
      return;
    }

    const matches = findTablesByNumber(tablesRef.current, command.tableNumber);

    if (matches.length === 0) {
      setFallback({
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
    onTargetRef.current(target);
  }, []);

  const startListening = useCallback(async () => {
    // Segundo toque mientras escucha = cancelar.
    if (handleRef.current) {
      handleRef.current.abort();
      return;
    }

    setFallback(null);
    setPhase("listening");

    const handle = listenOnce("es-CO");
    handleRef.current = handle;
    const result = await handle.promise;
    handleRef.current = null;
    setPhase("idle");

    if (!result.ok) {
      if (result.reason !== "aborted") {
        setFallback({ message: FAILURE_MESSAGES[result.reason], heard: "" });
      }
      return;
    }

    // Con ruido, la mejor alternativa no siempre es la primera: tomamos la
    // primera que cumple el filtro estricto ("mesa" + número, frase corta).
    // Si ninguna lo cumple, se trata como ruido y no se abre nada.
    const best =
      result.alternatives.find(
        alt => parseTableCommand(alt.transcript, { strict: true }).tableNumber !== null
      ) ?? result.alternatives[0];

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
    onTargetRef.current(target);
  }, []);

  const dismiss = useCallback(() => setFallback(null), []);

  /** Para el hueco de mesas repetidas: abre un “fallback vacío” de escritura. */
  const openTyping = useCallback(() => {
    setFallback({ message: "Escribe: mesa y personas, ej. “3 4”.", heard: "" });
  }, []);

  return {
    phase,
    supported,
    fallback,
    startListening,
    submitText,
    pick,
    dismiss,
    openTyping
  };
}