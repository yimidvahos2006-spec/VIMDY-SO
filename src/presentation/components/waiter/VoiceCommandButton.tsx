import React, { useEffect, useRef, useState } from "react";

import type { Table } from "../../../core/entities/Entities";
import { useTableVoiceCommand, TableVoiceTarget } from "../../../core/voice/useTableVoiceCommand";

interface Props {
  tables: readonly Table[];
  /** Mesa clara detectada: la pantalla abre el diálogo/panel correspondiente. */
  onTarget: (target: TableVoiceTarget) => void;
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
 * Botón flotante de micrófono para el módulo de Meseros.
 * Toque → habla ("Mesa 3, 4 personas") → se abre la mesa con los datos listos.
 * Si no se entiende, aparece un aviso con campo de texto para escribir o
 * repetir sin perder tiempo.
 */
export function VoiceCommandButton({ tables, onTarget }: Props) {
  const voice = useTableVoiceCommand({ tables, onTarget });
  const { fallback, phase } = voice;
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
    <div className="fixed bottom-6 right-6 z-[900] flex flex-col items-end gap-3">
      {fallback && (
        <div
          role="alert"
          className="w-[min(92vw,380px)] rounded-2xl border border-amber-500/40 bg-slate-900 shadow-2xl p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-amber-200 text-sm font-semibold leading-snug">{fallback.message}</p>
            <button
              type="button"
              onClick={voice.dismiss}
              aria-label="Cerrar aviso"
              className="text-slate-400 hover:text-white text-lg leading-none"
            >
              ✕
            </button>
          </div>

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
              placeholder="Ej: 3 4  (mesa 3, 4 personas)"
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

      {listening && (
        <div className="rounded-full bg-slate-900 border border-red-500/50 px-4 py-2 text-sm text-red-200 shadow-lg">
          Escuchando… di “Mesa 3, 4 personas”
        </div>
      )}

      <button
        type="button"
        onClick={voice.supported ? voice.startListening : voice.openTyping}
        aria-label={listening ? "Detener micrófono" : "Control por voz: decir mesa y personas"}
        aria-pressed={listening}
        className={[
          "relative w-16 h-16 rounded-full shadow-2xl flex items-center justify-center transition active:scale-95",
          listening
            ? "bg-red-500 text-white"
            : "bg-cyan-500 hover:bg-cyan-400 text-slate-950"
        ].join(" ")}
      >
        {listening && (
          <span className="absolute inset-0 rounded-full bg-red-500/60 animate-ping" aria-hidden="true" />
        )}
        <MicIcon className="relative w-7 h-7" />
      </button>
    </div>
  );
}