import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus, Users, X, Loader2, CalendarClock } from "lucide-react";

import { Table } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { connectionStore } from "../../../core/store/connectionStore";
import { isNetworkFailure } from "../../../core/services/offlineSale";
import { queueOpenTableOffline } from "../../../core/services/offlineTable";
import { tableDisplayName } from "../../../core/services/tableOrdering";

interface Props {
  table: Table;
  /** id del mesero ligero (Waiter) elegido en la pantalla de tarjetas. */
  waiterId: string | null;
  /** Comensales ya conocidos (ej. dictados por voz); si no, arranca en 2. */
  initialPeopleCount?: number | null;
  /** Desde el menú ⋮ de la mesa se abre directo en "Reservar". */
  initialMode?: "open" | "reserve";
  onClose: () => void;
  onOpened: () => void;
}

const MAX_PEOPLE = 99;
const QUICK_CHOICES = [1, 2, 3, 4, 5, 6, 7, 8];

function clampPeople(n: number): number {
  if (!Number.isFinite(n)) return 1;
  return Math.min(MAX_PEOPLE, Math.max(1, Math.trunc(n)));
}

export function OpenTableDialog({ table, waiterId, initialPeopleCount, initialMode, onClose, onOpened }: Props) {
  const [peopleCount, setPeopleCount] = useState(
    initialPeopleCount && initialPeopleCount > 0 ? clampPeople(initialPeopleCount) : 2
  );
  const [mode, setMode] = useState<"open" | "reserve">(initialMode ?? "open");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openAttemptIdRef = useRef<string | null>(null);

  // Escape cierra el diálogo (salvo mientras se guarda).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose]);

  async function handleAction() {
    if (busy) return;
    setBusy(true);
    setErrorMsg(null);

    if (!openAttemptIdRef.current) {
      openAttemptIdRef.current = crypto.randomUUID();
    }

    const input = {
      tableId: table.id,
      peopleCount,
      waiterId: waiterId ?? undefined,
      operationId: openAttemptIdRef.current
    };

    try {
      if (mode === "open") {
        if (!connectionStore.isOnline()) {
          await queueOpenTableOffline({ table, input });
        } else {
          await container.tableEngine.get().openTable(input);
        }
      } else {
        await container.tableEngine.get().reserveTable(table.id);
      }

      openAttemptIdRef.current = null;
      onOpened();
    } catch (err) {
      if (isNetworkFailure(err)) {
        if (mode === "open") {
          await queueOpenTableOffline({ table, input });
        }
        openAttemptIdRef.current = null;
        onOpened();
      } else {
        setErrorMsg(translateBusinessError(err, "No se pudo abrir la mesa."));
      }
    } finally {
      setBusy(false);
    }
  }

  const exceedsCapacity = peopleCount > table.capacity;
  const name = tableDisplayName(table);
  const zone = table.zone?.trim();
  const isOpen = mode === "open";

  return (
    <div
      className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-end sm:items-center justify-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose();
      }}
    >
      <form
        role="dialog"
        aria-modal="true"
        aria-label={isOpen ? `Abrir ${name}` : `Reservar ${name}`}
        onSubmit={(e) => {
          e.preventDefault();
          void handleAction();
        }}
        className="w-full sm:max-w-md max-h-[92dvh] overflow-y-auto rounded-t-3xl sm:rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl"
      >
        {/* Cabecera: mesa + zona */}
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-4 border-b border-slate-700/70">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-cyan-400">
              {isOpen ? "Abrir mesa" : "Reservar mesa"}
            </p>
            <h2 className="text-3xl font-black text-white leading-tight truncate">{name}</h2>
            <p className="text-slate-400 text-sm mt-0.5">
              {zone ? `${zone} · ` : ""}Capacidad {table.capacity}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="w-12 h-12 -mr-2 -mt-1 shrink-0 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 flex items-center justify-center"
            aria-label="Cerrar"
          >
            <X size={24} />
          </button>
        </div>

        <div className="px-5 py-5 space-y-5">
          {errorMsg && (
            <div role="alert" className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          {isOpen ? (
            <div>
              <p className="flex items-center gap-2 text-slate-300 text-sm font-semibold mb-3">
                <Users size={16} /> ¿Cuántas personas?
              </p>

              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setPeopleCount(v => clampPeople(v - 1))}
                  disabled={peopleCount <= 1}
                  className="w-14 h-14 shrink-0 rounded-2xl bg-slate-800 hover:bg-slate-700 disabled:opacity-40 active:scale-95 text-white flex items-center justify-center transition"
                  aria-label="Menos personas"
                >
                  <Minus size={24} />
                </button>
                <input
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={MAX_PEOPLE}
                  value={peopleCount}
                  onChange={e => setPeopleCount(clampPeople(Number(e.target.value)))}
                  onFocus={e => e.currentTarget.select()}
                  aria-label="Número de personas"
                  className="flex-1 min-w-0 h-14 rounded-2xl bg-slate-900 border border-slate-700 focus:border-cyan-500 text-center text-white text-3xl font-black outline-none"
                />
                <button
                  type="button"
                  onClick={() => setPeopleCount(v => clampPeople(v + 1))}
                  className="w-14 h-14 shrink-0 rounded-2xl bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 flex items-center justify-center transition"
                  aria-label="Más personas"
                >
                  <Plus size={24} />
                </button>
              </div>

              <div className="grid grid-cols-8 gap-1.5 mt-3">
                {QUICK_CHOICES.map(n => (
                  <button
                    key={n}
                    type="button"
                    onClick={() => setPeopleCount(n)}
                    aria-pressed={peopleCount === n}
                    className={`h-12 rounded-xl font-bold text-base active:scale-95 transition ${
                      peopleCount === n
                        ? "bg-cyan-500 text-slate-950"
                        : "bg-slate-800 hover:bg-slate-700 text-slate-200"
                    }`}
                  >
                    {n}
                  </button>
                ))}
              </div>

              {exceedsCapacity ? (
                <p className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/40 text-amber-300 text-sm font-semibold px-3 py-2">
                  Son más que la capacidad de la mesa ({table.capacity}). Se puede abrir igual.
                </p>
              ) : (
                <p className="mt-3 text-slate-500 text-xs">Capacidad de la mesa: {table.capacity} personas.</p>
              )}
            </div>
          ) : (
            <div className="rounded-2xl border border-slate-700 bg-slate-800/60 p-4 text-sm text-slate-300 flex gap-3">
              <CalendarClock size={20} className="text-indigo-300 shrink-0 mt-0.5" />
              <p>
                Se reservará <strong className="text-white">{name}</strong>. Cuando llegue el cliente, la abres desde
                Mesas.
              </p>
            </div>
          )}
        </div>

        {/* Acciones: la principal arriba y a todo el ancho */}
        <div className="px-5 pb-5 space-y-3" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
          <button
            type="submit"
            disabled={busy}
            className="w-full h-14 rounded-2xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-60 active:scale-[0.99] text-slate-950 text-lg font-black flex items-center justify-center gap-2 whitespace-nowrap transition"
          >
            {busy && <Loader2 size={20} className="animate-spin" />}
            {busy
              ? isOpen ? "Abriendo…" : "Reservando…"
              : isOpen ? "Abrir mesa" : "Confirmar reserva"}
          </button>

          <div className="grid grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => setMode(isOpen ? "reserve" : "open")}
              disabled={busy}
              className="h-12 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-600 text-white font-semibold whitespace-nowrap"
            >
              {isOpen ? "Reservar" : "Volver a abrir"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="h-12 rounded-xl text-slate-300 hover:text-white hover:bg-slate-800 font-semibold whitespace-nowrap"
            >
              Cancelar
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}