import React, { useEffect, useRef, useState } from "react";

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

function MicIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0" />
      <path d="M12 18v4" />
    </svg>
  );
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
        className={[
          "relative h-12 pl-4 pr-5 rounded-xl font-bold text-sm flex items-center gap-2 transition active:scale-95 select-none",
          listening
            ? "bg-red-500 text-white"
            : "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
        ].join(" ")}
      >
        {listening && (
          <span className="absolute inset-0 rounded-xl bg-red-500/50 animate-ping" aria-hidden="true" />
        )}
        <MicIcon className="relative w-5 h-5" />
        <span className="relative">{listening ? "Escuchando…" : "Voz"}</span>
      </button>

      {listening && (
        <div
          role="status"
          aria-live="polite"
          className="absolute right-0 top-full mt-2 z-[900] w-[min(92vw,360px)] rounded-2xl border border-red-500/50 bg-slate-900 shadow-2xl px-4 py-3"
        >
          <div className="flex items-center gap-2 text-red-200 text-xs font-bold uppercase tracking-wide">
            <span className="flex items-end gap-[3px] h-4" aria-hidden="true">
              {[0, 1, 2, 3].map(i => (
                <span
                  key={i}
                  className="w-[3px] rounded-full bg-red-400 animate-pulse"
                  style={{ height: `${6 + ((i * 5) % 10)}px`, animationDelay: `${i * 120}ms` }}
                />
              ))}
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
                <MicIcon className="w-5 h-5" />
              </button>
            )}
          </form>
        </div>
      )}
    </div>
  );
}