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
  waiterId: string;
  onClose: () => void;
  onOpened: () => void;
}

export function OpenTableDialog({ table, waiterId, onClose, onOpened }: Props) {
  const [peopleCount, setPeopleCount] = useState(2);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // IDEMPOTENCIA: la misma apertura de mesa puede reintentarse si la
  // red falla después de enviar el request, o si la operación queda en
  // la cola offline y se reintenta más tarde. El `operationId` debe
  // generarse una sola vez por intento y permanecer igual durante todo
  // el ciclo de ese intento.
  const openAttemptIdRef = React.useRef<string | null>(null);

  async function handleOpen() {
    setBusy(true);
    setErrorMsg(null);

    if (!openAttemptIdRef.current) {
      openAttemptIdRef.current = crypto.randomUUID();
    }

    const input = {
      tableId: table.id,
      peopleCount,
      waiterId,
      operationId: openAttemptIdRef.current
    };

    try {
      // PASO 1.8 (Cola offline): sin conexión real no tiene sentido
      // siquiera intentar hablar con Supabase (ver connectionStore) — se
      // va directo al camino offline, igual que sendOrderToKitchen en
      // processSale.ts.
      if (!connectionStore.isOnline()) {
        await queueOpenTableOffline({ table, input });
      } else {
        await container.tableEngine.get().openTable(input);
      }
      openAttemptIdRef.current = null;
      onOpened();
    } catch (err) {
      if (isNetworkFailure(err)) {
        // La red se cayó a mitad del intento: no se le muestra un error
        // al mesero, la apertura se guarda en la cola local y se
        // sincroniza sola cuando vuelva internet (ver
        // syncPendingTableOperations.ts).
        await queueOpenTableOffline({ table, input });
        openAttemptIdRef.current = null;
        onOpened();
      } else {
        setErrorMsg(translateBusinessError(err, "No se pudo abrir la mesa."));
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center">
      <div className="w-[420px] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">Abrir {table.name}</h2>
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

          <div>
            <p className="text-slate-400 mb-2">Número de personas</p>
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
                max={table.capacity}
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
              Capacidad de la mesa: {table.capacity} personas
            </p>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              onClick={onClose}
              className="h-12 px-6 rounded-xl bg-slate-700 text-white"
            >
              Cancelar
            </button>
            <button
              disabled={busy}
              onClick={handleOpen}
              className="h-12 px-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
            >
              {busy ? "Abriendo..." : "Abrir mesa"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}