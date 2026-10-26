import React, { useEffect, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, HelpCircle, X } from "lucide-react";

import type { VoiceCatalogProduct } from "../../../core/voice/orderParser";
import type { VoiceOrderSession } from "../../../core/voice/useVoiceOrderSession";
import { LevelBars } from "./VoiceOrderButton";

interface Props<P extends VoiceCatalogProduct> {
  session: VoiceOrderSession<P>;
  /** Ejemplo que se muestra mientras escucha. */
  hint: string;
  /**
   * Posición/tamaño. En la Caja flota bajo la barra (`absolute …`); en la mesa
   * va en el flujo normal de la página para que nada lo recorte.
   */
  className?: string;
}

/**
 * Lo que VIMDY Voice muestra mientras escucha y después de entender:
 * lo agregado, lo que hay que elegir (varios productos encajan), lo que no
 * existe en el menú y un campo para corregir escribiendo.
 */
export function VoiceOrderPanel<P extends VoiceCatalogProduct>({ session, hint, className = "" }: Props<P>) {
  const { phase, outcome, transcript, level } = session;
  const [typed, setTyped] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Si no se agregó nada, lo escuchado queda en el campo para corregirlo; si ya
  // se agregó algo, el campo arranca vacío para no repetir lo que ya entró.
  useEffect(() => {
    if (!outcome) return;
    setTyped(outcome.added.length === 0 ? outcome.heard : "");
  }, [outcome?.heard]); // eslint-disable-line react-hooks/exhaustive-deps

  const listening = phase === "listening" || phase === "starting";

  if (listening) {
    return (
      <div
        role="status"
        aria-live="polite"
        className={`rounded-2xl border border-vimdy-accent/50 bg-slate-900 shadow-2xl px-4 py-3 ${className}`}
      >
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-vimdy-accent text-xs font-bold uppercase tracking-wide">
            <LevelBars level={level} />
            {phase === "starting" ? "Abriendo micrófono…" : "Escuchando"}
          </div>
          <button
            type="button"
            onClick={session.stopListening}
            className="text-slate-400 hover:text-white text-xs font-semibold h-8 px-2"
          >
            Cancelar
          </button>
        </div>
        <p className={`mt-1 text-base leading-snug ${transcript ? "text-white" : "text-slate-400"}`}>
          {transcript || hint}
        </p>
      </div>
    );
  }

  if (!outcome) return null;

  const attention = outcome.pending.length > 0 || outcome.unparsed.length > 0 || outcome.lowConfidence;

  function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    session.submitText(typed);
    setTyped("");
  }

  return (
    <div
      role={outcome.error ? "alert" : "status"}
      aria-live="polite"
      className={`rounded-2xl border bg-slate-900 shadow-2xl p-4 space-y-3 ${
        outcome.error ? "border-amber-500/40" : attention ? "border-vimdy-accent/50" : "border-emerald-500/40"
      } ${className}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-2">
          {outcome.info && <p className="text-slate-300 text-sm leading-snug">{outcome.info}</p>}

          {outcome.error && (
            <p className="flex items-start gap-2 text-amber-200 text-sm font-semibold leading-snug">
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
              {outcome.error}
            </p>
          )}

          {outcome.added.length > 0 && (
            <div className="text-emerald-300 text-sm">
              <p className="flex items-center gap-2 font-semibold">
                <CheckCircle2 size={16} className="flex-shrink-0" />
                Agregado
              </p>
              <ul className="mt-1 ml-6 list-disc space-y-0.5 text-emerald-200">
                {outcome.added.map((text, i) => (
                  <li key={`${i}-${text}`}>{text}</li>
                ))}
              </ul>
            </div>
          )}

          {outcome.lowConfidence && (
            <p className="text-amber-200 text-sm leading-snug">
              No estuve muy seguro de lo que escuché. Revisa lo agregado.
            </p>
          )}
        </div>

        <button
          type="button"
          onClick={session.dismiss}
          aria-label="Cerrar aviso de voz"
          className="text-slate-400 hover:text-white w-8 h-8 shrink-0 flex items-center justify-center"
        >
          <X size={16} />
        </button>
      </div>

      {outcome.pending.map(({ id, line }) => (
        <div key={id} className="rounded-xl bg-slate-800/70 border border-slate-700 p-3 space-y-2">
          {line.status === "ambiguous" && (
            <>
              <p className="flex items-start gap-2 text-white text-sm font-semibold leading-snug">
                <HelpCircle size={16} className="mt-0.5 flex-shrink-0 text-vimdy-accent" />
                {line.candidates.length === 1
                  ? `¿Quisiste decir esto? (${line.quantity} × “${line.spoken}”)`
                  : `¿Cuál? ${line.quantity} × “${line.spoken}”`}
              </p>
              <div className="flex flex-wrap gap-2">
                {line.candidates.map(product => (
                  <button
                    key={product.id}
                    type="button"
                    disabled={session.working}
                    onClick={() => session.resolvePending(id, product)}
                    className="min-h-11 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-sm"
                  >
                    {product.name}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => session.discardPending(id)}
                  className="min-h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm font-semibold"
                >
                  Ninguno
                </button>
              </div>
            </>
          )}

          {line.status === "matched" && line.product && (
            <>
              <p className="flex items-start gap-2 text-white text-sm font-semibold leading-snug">
                <HelpCircle size={16} className="mt-0.5 flex-shrink-0 text-amber-300" />
                ¿Seguro que son {line.quantity} × {line.product.name}?
              </p>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={session.working}
                  onClick={() => session.confirmPending(id)}
                  className="min-h-11 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 text-slate-950 font-bold text-sm"
                >
                  Sí, agregar
                </button>
                <button
                  type="button"
                  onClick={() => session.discardPending(id)}
                  className="min-h-11 px-4 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-slate-200 text-sm font-semibold"
                >
                  No
                </button>
              </div>
            </>
          )}

          {line.status === "not_found" && (
            <div className="flex items-start justify-between gap-3">
              <p className="flex items-start gap-2 text-amber-200 text-sm font-semibold leading-snug">
                <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" />
                No encontré en el menú: {line.quantity} × “{line.spoken || "?"}”
              </p>
              <button
                type="button"
                onClick={() => session.discardPending(id)}
                aria-label="Descartar"
                className="text-slate-400 hover:text-white w-8 h-8 shrink-0 flex items-center justify-center"
              >
                <X size={14} />
              </button>
            </div>
          )}
        </div>
      ))}

      {outcome.unparsed.length > 0 && (
        <p className="text-slate-400 text-xs leading-snug">
          No entendí: “{outcome.unparsed.join(" ")}”. Si era parte del pedido, corrígelo abajo.
        </p>
      )}

      <form onSubmit={handleSubmit} className="flex gap-2">
        <input
          ref={inputRef}
          value={typed}
          onChange={e => setTyped(e.target.value)}
          placeholder={outcome.added.length > 0 ? "¿Falta algo? Ej: 2 poker, sin hielo" : "Ej: 2 poker y 1 bandeja paisa sin arroz"}
          autoComplete="off"
          className="flex-1 min-w-0 h-12 rounded-xl bg-slate-800 border border-slate-700 px-3 text-white text-sm outline-none focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={session.working || !typed.trim()}
          className="h-12 px-4 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
        >
          Agregar
        </button>
        {session.supported && (
          <button
            type="button"
            onClick={session.startListening}
            aria-label="Repetir por voz"
            className="h-12 px-3 shrink-0 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white text-sm font-semibold"
          >
            Repetir
          </button>
        )}
      </form>
    </div>
  );
}