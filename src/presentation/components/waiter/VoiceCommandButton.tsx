import React, { useEffect, useRef, useState } from "react";
import { Mic } from "lucide-react";

import type { Table } from "../../../core/entities/Entities";
import {
  useTableVoiceCommand,
  TableVoiceMerge,
  TableVoiceTarget
} from "../../../core/voice/useTableVoiceCommand";

interface Props {
  tables: readonly Table[];
  /** Mesa clara detectada: la pantalla abre el diálogo/panel correspondiente. */
  onTarget: (target: TableVoiceTarget) => void;
  /** El mesero confirmó unir dos mesas por voz. */
  onMerge?: (merge: TableVoiceMerge) => void;
}

/**
 * Micrófono del módulo de Meseros, pensado para la barra superior (junto a
 * "Cambiar de mesero").
 *
 * Toque → habla ("Mesa 3, 4 personas" / "Unir mesa 5 y 4, 6 personas") →
 * se ve lo que va escuchando en tiempo real → se abre la mesa o se pide
 * confirmar la unión. Si no se entiende, o el micrófono está bloqueado,
 * aparece el panel de comando rápido para escribirlo sin perder tiempo.
 */
export function VoiceCommandButton({ tables, onTarget, onMerge }: Props) {
  const voice = useTableVoiceCommand({ tables, onTarget, onMerge });
  const { fallback, phase, transcript } = voice;
  const listening = phase === "listening";

  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Cada aviso nuevo trae lo escuchado para corregirlo, con el foco listo.
  useEffect(() => {
    if (fallback) {
      setTyped(fallback.heard);
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [fallback]);

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    voice.submitText(typed);
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={voice.supported ? voice.startListening : voice.openTyping}
        aria-label={listening ? "Detener micrófono" : "Control por voz: decir mesa y personas"}
        aria-pressed={listening}
        className={`
          flex items-center gap-2 h-11 px-4 rounded-vimdy-md border transition-all duration-vimdy-normal flex-shrink-0 select-none active:scale-95

          ${
            listening
              ? "bg-vimdy-accent/10 border-vimdy-accent"
              : "bg-vimdy-surface-active border-vimdy-border hover:border-vimdy-accent animate-voice-idle-glow"
          }
        `}
      >
        <Mic size={18} className="text-vimdy-accent flex-shrink-0" />

        <span className="text-vimdy-text text-vimdy-small font-semibold whitespace-nowrap">
          VIMDY Voice
        </span>

        {listening && (
          <span className="flex items-end gap-[3px] h-3 ml-1" aria-hidden="true">
            <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-1" />
            <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-2" />
            <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-3" />
            <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-4" />
          </span>
        )}
      </button>

      {listening && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full mt-2 z-[900] w-[min(92vw,360px)] rounded-2xl border border-vimdy-accent/50 bg-slate-900 shadow-2xl px-4 py-3"
        >
          <div className="flex items-center gap-2 text-vimdy-accent text-xs font-bold uppercase tracking-wide">
            <span className="flex items-end gap-[3px] h-3" aria-hidden="true">
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-1" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-2" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-3" />
              <span className="w-[2.5px] h-full bg-vimdy-accent/80 rounded-full animate-voice-bar-4" />
            </span>
            Escuchando
          </div>
          <p className={`mt-1 text-base leading-snug ${transcript ? "text-white" : "text-slate-400"}`}>
            {transcript || "Di “Mesa 3, 4 personas” o “Unir mesa 5 y 4”"}
          </p>
        </div>
      )}

      {!listening && fallback && (
        <div
          role="alert"
          className="absolute right-0 top-full mt-2 z-[900] w-[min(92vw,380px)] rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-amber-200 text-sm font-semibold leading-snug">{fallback.message}</p>
            <button
              type="button"
              onClick={voice.dismiss}
              aria-label="Cerrar aviso"
              className="text-slate-400 hover:text-white text-lg leading-none w-8 h-8 shrink-0"
            >
              ✕
            </button>
          </div>

          {fallback.mergeSuggestion && (
            <button
              type="button"
              onClick={() => voice.confirmMerge(fallback.mergeSuggestion!)}
              className="w-full h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
            >
              Sí, unir {fallback.mergeSuggestion.primary.name} + {fallback.mergeSuggestion.secondary.name}
            </button>
          )}

          {fallback.suggestion && (
            <button
              type="button"
              onClick={() => voice.pick(fallback.suggestion!)}
              className="w-full h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
            >
              Sí, abrir {fallback.suggestion.table.name}
            </button>
          )}

          {fallback.choices && (
            <div className="flex flex-wrap gap-2">
              {fallback.choices.map(table => (
                <button
                  key={table.id}
                  type="button"
                  onClick={() => voice.pick({ table, peopleCount: fallback.peopleCount ?? null })}
                  className="h-12 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-semibold"
                >
                  {table.name}
                </button>
              ))}
            </div>
          )}

          <form onSubmit={handleSubmit} className="flex gap-2">
            <input
              ref={inputRef}
              value={typed}
              onChange={e => setTyped(e.target.value)}
              placeholder="Ej: 3 4  ·  unir 5 y 4"
              inputMode="text"
              autoComplete="off"
              className="flex-1 min-w-0 h-12 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white outline-none focus:border-cyan-500"
            />
            <button
              type="submit"
              className="h-12 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
            >
              Ir
            </button>
            {voice.supported && (
              <button
                type="button"
                onClick={voice.startListening}
                aria-label="Repetir por voz"
                className="h-12 w-12 shrink-0 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white flex items-center justify-center"
              >
                <Mic size={18} />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}