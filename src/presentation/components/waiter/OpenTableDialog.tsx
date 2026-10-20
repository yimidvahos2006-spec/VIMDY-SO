import React, { useEffect, useRef, useState } from "react";
import { Minus, Plus, Users, X, Loader2, CalendarClock, Link2, Check } from "lucide-react";

import { Table } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { connectionStore } from "../../../core/store/connectionStore";
import { isNetworkFailure } from "../../../core/services/offlineSale";
import { queueOpenTableOffline } from "../../../core/services/offlineTable";
import { sortTables, tableDisplayName } from "../../../core/services/tableOrdering";
import { toast } from "../../../core/store/toastStore";

interface Props {
  table: Table;
  /** Todas las mesas: para ofrecer "Unir mesa" con una mesa libre cuando no caben. */
  tables?: readonly Table[];
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

export function OpenTableDialog({ table, tables = [], waiterId, initialPeopleCount, initialMode, onClose, onOpened }: Props) {
  const [peopleCount, setPeopleCount] = useState(
    initialPeopleCount && initialPeopleCount > 0 ? clampPeople(initialPeopleCount) : 2
  );
  const [mode, setMode] = useState<"open" | "reserve">(initialMode ?? "open");
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const openAttemptIdRef = useRef<string | null>(null);

  // Mesas libres que se pueden unir a esta cuando las personas no caben.
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [pickerOpen, setPickerOpen] = useState(false);

  const online = connectionStore.isOnline();
  const zoneOf = (t: Table) => t.zone?.trim() || "";

  const freeTables = sortTables(
    tables.filter(t => t.id !== table.id && t.status === "FREE" && !t.mergedInto)
  );
  // Las de la misma zona primero (cerca de la mesa elegida).
  const candidates = [
    ...freeTables.filter(t => zoneOf(t) === zoneOf(table)),
    ...freeTables.filter(t => zoneOf(t) !== zoneOf(table))
  ];
  const extras = extraIds
    .map(id => tables.find(t => t.id === id))
    .filter((t): t is Table => Boolean(t));

  // Escape cierra el selector de mesas si está abierto; si no, el diálogo (salvo mientras se guarda).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape" || busy) return;
      if (pickerOpen) setPickerOpen(false);
      else onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [busy, onClose, pickerOpen]);

  function toggleExtra(id: string) {
    setExtraIds(prev => (prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]));
  }

  /** Une las mesas elegidas a la recién abierta; nunca tumba la apertura. */
  async function linkExtras(): Promise<void> {
    if (extraIds.length === 0) return;
    try {
      const { linked, skipped } = await container.tableEngine.get().linkExtraTables(table.id, extraIds);
      if (linked.length > 0) {
        const names = linked.map(id => tableDisplayName(tables.find(t => t.id === id) ?? { name: "Mesa", zone: undefined }));
        toast.success(`${tableDisplayName(table)} + ${names.join(" + ")} unidas.`);
      }
      if (skipped.length > 0) {
        const names = skipped.map(id => tableDisplayName(tables.find(t => t.id === id) ?? { name: "Mesa", zone: undefined }));
        toast.warning(`No se pudo unir ${names.join(", ")} (otra persona la ocupó o falló la conexión). La mesa se abrió sin unirla.`);
      }
    } catch {
      toast.warning("La mesa se abrió, pero no se pudieron unir las otras mesas.");
    }
  }

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
          await linkExtras();
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
          if (extraIds.length > 0) {
            toast.warning("Sin conexión: la mesa se abrirá sin unir las otras mesas.");
          }
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

  const totalCapacity = table.capacity + extras.reduce((sum, t) => sum + (t.capacity ?? 0), 0);
  const exceedsCapacity = peopleCount > totalCapacity;
  const canOfferJoin = mode === "open" && online;
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
                <div className="mt-3 rounded-xl bg-amber-500/10 border border-amber-500/40 px-3 py-2.5 space-y-2.5">
                  <p className="text-amber-300 text-sm font-semibold">
                    {peopleCount} personas no caben ({totalCapacity} de capacidad
                    {extras.length > 0 ? ` con ${extras.length + 1} mesas` : ""}).
                  </p>
                  {canOfferJoin ? (
                    candidates.length > 0 ? (
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="w-full h-12 rounded-xl bg-amber-400 hover:bg-amber-300 active:scale-[0.99] text-slate-950 font-bold flex items-center justify-center gap-2 transition"
                      >
                        <Link2 size={18} /> {extras.length > 0 ? "Unir otra mesa" : "Unir mesa"}
                      </button>
                    ) : (
                      <p className="text-amber-200/80 text-xs">No hay otras mesas libres para unir. Se puede abrir igual.</p>
                    )
                  ) : (
                    <p className="text-amber-200/80 text-xs">Sin internet no se pueden unir mesas. Se puede abrir igual.</p>
                  )}
                </div>
              ) : (
                <p className="mt-3 text-slate-500 text-xs">
                  Capacidad{extras.length > 0 ? ` de ${extras.length + 1} mesas` : " de la mesa"}: {totalCapacity} personas.
                </p>
              )}

              {extras.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2">
                  <span className="text-slate-400 text-xs font-semibold">Unida con:</span>
                  {extras.map(t => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => toggleExtra(t.id)}
                      aria-label={`Quitar ${tableDisplayName(t)}`}
                      className="h-9 pl-3 pr-2 rounded-full bg-cyan-500/15 border border-cyan-400/50 text-cyan-200 text-sm font-bold flex items-center gap-1.5"
                    >
                      {tableDisplayName(t)} <X size={14} />
                    </button>
                  ))}
                </div>
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

      {/* Selector de mesas libres para unir */}
      {pickerOpen && (
        <div
          className="fixed inset-0 z-[1000] bg-black/70 flex items-end sm:items-center justify-center sm:p-4"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setPickerOpen(false);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Unir mesa"
            className="w-full sm:max-w-md max-h-[85dvh] flex flex-col rounded-t-3xl sm:rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl"
          >
            <div className="px-5 pt-5 pb-3">
              <h3 className="text-xl font-black text-white">Unir mesa</h3>
              <p className="text-slate-400 text-sm mt-0.5">
                Elige la mesa libre que se une a <strong className="text-white">{name}</strong>. Puedes elegir varias.
              </p>
            </div>

            <div className="px-5 pb-3 overflow-y-auto grid grid-cols-2 gap-2">
              {candidates.map(t => {
                const picked = extraIds.includes(t.id);
                const otherZone = zoneOf(t) !== zoneOf(table) && zoneOf(t);
                return (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => toggleExtra(t.id)}
                    aria-pressed={picked}
                    className={`min-h-[56px] px-3 py-2 rounded-xl border-2 text-left transition active:scale-95 ${
                      picked
                        ? "bg-cyan-500/15 border-cyan-400 text-white"
                        : "bg-slate-800 border-slate-700 hover:border-slate-500 text-slate-200"
                    }`}
                  >
                    <span className="flex items-center justify-between gap-2 font-bold">
                      <span className="truncate">{tableDisplayName(t)}</span>
                      {picked && <Check size={16} className="text-cyan-300 shrink-0" />}
                    </span>
                    <span className="block text-xs text-slate-400">
                      {t.capacity} personas{otherZone ? ` · ${otherZone}` : ""}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="px-5 pt-2 pb-5 border-t border-slate-700/70" style={{ paddingBottom: "max(1.25rem, env(safe-area-inset-bottom))" }}>
              <p className="text-slate-400 text-xs mb-2">
                {extras.length === 0
                  ? "Todavía no elegiste ninguna mesa."
                  : `Capacidad total: ${totalCapacity} personas con ${extras.length + 1} mesas.`}
              </p>
              <button
                type="button"
                onClick={() => setPickerOpen(false)}
                className="w-full h-14 rounded-2xl bg-cyan-500 hover:bg-cyan-400 active:scale-[0.99] text-slate-950 text-lg font-black transition"
              >
                Listo
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}