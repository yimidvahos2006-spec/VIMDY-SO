import React, { useState } from "react";

import { Table } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { connectionStore } from "../../../core/store/connectionStore";
import { isNetworkFailure } from "../../../core/services/offlineSale";
import { queueOpenTableOffline } from "../../../core/services/offlineTable";

interface Props {
  table: Table;
  /** id del mesero ligero (Waiter) elegido en la pantalla de tarjetas. */
  waiterId: string | null;
  onClose: () => void;
  onOpened: () => void;
}

export function OpenTableDialog({ table, waiterId, onClose, onOpened }: Props) {
  const [peopleCount, setPeopleCount] = useState(2);
  const [mode, setMode] = useState<"open" | "reserve">("open");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openAttemptIdRef = React.useRef<string | null>(null);

  async function handleAction() {
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

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[420px] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">
            {mode === "open" ? `Abrir ${table.name}` : `Reservar ${table.name}`}
          </h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white text-2xl"
          >
            ✕
          </button>
        </div>

        <div className="p-6 space-y-5">
          {errorMsg && (
            <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">
              {errorMsg}
            </div>
          )}

          {mode === "open" && (
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-slate-400">Personas</p>
                {exceedsCapacity && (
                  <span className="text-xs text-amber-400 font-semibold">
                    Supera capacidad ({table.capacity})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setPeopleCount(v => Math.max(1, v - 1))}
                  className="w-12 h-12 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold"
                >
                  −
                </button>
                <input
                  type="number"
                  min={1}
                  value={peopleCount}
                  onChange={e => setPeopleCount(Math.max(1, Number(e.target.value)))}
                  className="flex-1 h-12 rounded-xl bg-slate-800 border border-slate-700 text-center text-white font-bold outline-none"
                />
                <button
                  onClick={() => setPeopleCount(v => v + 1)}
                  className="w-12 h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold"
                >
                  +
                </button>
              </div>
              <p className="text-slate-500 text-xs mt-2">
                Capacidad de la mesa: {table.capacity} personas (se puede exceder).
              </p>
            </div>
          )}

          {mode === "reserve" && (
            <div className="rounded-xl border border-slate-700 bg-slate-800 p-4 text-sm text-slate-300">
              Se reservará <strong className="text-white">{table.name}</strong> para el turno actual. Podés abrirla desde la pantalla Mesas cuando llegue el cliente.
            </div>
          )}

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="h-12 px-6 rounded-xl bg-slate-700 text-white"
            >
              Cancelar
            </button>
            {mode === "open" ? (
              <button
                onClick={() => setMode("reserve")}
                className="h-12 px-6 rounded-xl bg-slate-800 border border-slate-600 text-white font-semibold"
              >
                Reservar
              </button>
            ) : (
              <button
                onClick={() => setMode("open")}
                className="h-12 px-6 rounded-xl bg-slate-800 border border-slate-600 text-white font-semibold"
              >
                Abrir
              </button>
            )}
            <button
              disabled={busy}
              onClick={handleAction}
              className="h-12 px-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
            >
              {busy ? (mode === "open" ? "Abriendo..." : "Reservando...") : (mode === "open" ? "Abrir mesa" : "Reservar")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}