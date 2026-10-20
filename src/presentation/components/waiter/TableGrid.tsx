import React, { useEffect, useMemo, useState } from "react";
import { Users, Search, Clock, Plus, Minus, X, Loader2, MapPin } from "lucide-react";

import { Table, Waiter } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { getTableUrgency } from "../../../core/services/tableUrgency";

interface Props {
  tables: Table[];
  /** Para mostrar qué mesero abrió cada mesa. */
  waiters?: Waiter[];
  onSelect: (table: Table) => void;
  avgDurationMs?: number;
  /** Se llama después de crear una zona o una mesa para recargar la lista. */
  onTablesChanged?: () => void | Promise<void>;
}

const NO_ZONE = "Sin zona";

type Status = Table["status"];

interface StatusStyle {
  label: string;
  card: string;
  header: string;
  action: string;
}

/** Libre = verde. Ocupada = rojo. Esperando comida = naranja. Clases estáticas para Tailwind. */
const STATUS_STYLES: Record<Status, StatusStyle> = {
  FREE: { label: "Libre", card: "bg-emerald-950/60 border-emerald-500/60", header: "bg-emerald-500 text-emerald-950", action: "text-emerald-300" },
  RESERVED: { label: "Reservada", card: "bg-amber-950/50 border-amber-500/60", header: "bg-amber-400 text-amber-950", action: "text-amber-300" },
  BUSY: { label: "Ocupada", card: "bg-red-950/60 border-red-500/60", header: "bg-red-500 text-white", action: "text-red-200" },
  WAITING_FOOD: { label: "Esperando comida", card: "bg-orange-950/60 border-orange-500/60", header: "bg-orange-500 text-orange-950", action: "text-orange-200" },
  EATING: { label: "Comiendo", card: "bg-blue-950/60 border-blue-500/60", header: "bg-blue-500 text-white", action: "text-blue-200" },
  CUENTA_SOLICITADA: { label: "Cuenta solicitada", card: "bg-amber-950/50 border-amber-500/60", header: "bg-amber-500 text-amber-950", action: "text-amber-200" },
  WAITING_BILL: { label: "Esperando cuenta", card: "bg-cyan-950/50 border-cyan-500/60", header: "bg-cyan-500 text-cyan-950", action: "text-cyan-200" },
  PAYING: { label: "Cobrando", card: "bg-purple-950/50 border-purple-500/60", header: "bg-purple-500 text-white", action: "text-purple-200" },
  CLOSED: { label: "Unida", card: "bg-slate-900 border-slate-700", header: "bg-slate-600 text-white", action: "text-slate-400" }
};

const QUICK_FILTERS: { key: Status | "ALL"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "FREE", label: "Libres" },
  { key: "BUSY", label: "Ocupadas" },
  { key: "EATING", label: "Comiendo" },
  { key: "WAITING_FOOD", label: "Esperando" },
  { key: "RESERVED", label: "Reservadas" }
];

function formatMinutes(ms: number): string {
  return `${Math.max(0, Math.floor(ms / 60000))} min`;
}

function zoneOf(table: Table): string {
  return table.zone?.trim() || NO_ZONE;
}

/** Dentro de su zona la tarjeta no necesita repetir " · Terraza". */
function displayName(table: Table): string {
  const zone = table.zone?.trim();
  const suffix = zone ? ` · ${zone}` : "";
  return suffix && table.name.endsWith(suffix) ? table.name.slice(0, -suffix.length) : table.name;
}

/**
 * El nombre de la mesa es único en todo el negocio (índice de la base).
 * Si "Mesa 1" ya existe en OTRA zona, esta se guarda como "Mesa 1 · Terraza".
 */
function resolveTableName(baseName: string, zone: string, all: Table[]): string {
  const norm = (s: string) => s.trim().toLowerCase();
  const taken = new Map<string, Table>();
  all.forEach(t => taken.set(norm(t.name), t));

  const first = taken.get(norm(baseName));
  if (!first) return baseName;
  if (zoneOf(first) === zone) throw new Error("TABLE_NAME_DUPLICATE");

  const suffixed = `${baseName} · ${zone}`;
  if (taken.has(norm(suffixed))) throw new Error("TABLE_NAME_DUPLICATE");
  return suffixed;
}

function nextTableNumber(zoneTables: Table[]): number {
  let max = 0;
  zoneTables.forEach(t => {
    const match = displayName(t).match(/(\d+)\s*$/);
    if (match) max = Math.max(max, Number(match[1]));
  });
  return max + 1;
}

function errorText(err: unknown): string {
  const raw = err instanceof Error ? err.message : String(err);
  if (raw.includes("TABLE_NAME_DUPLICATE")) return "Ya existe una mesa con ese número en esta zona.";
  if (raw.includes("TABLE_NAME_REQUIRED")) return "Escribe el número de la mesa.";
  return "No se pudo guardar. Revisa tu conexión e inténtalo de nuevo.";
}

function Stepper({ value, min, max, onChange }: { value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3">
      <button
        type="button"
        onClick={() => onChange(Math.max(min, value - 1))}
        className="w-12 h-12 rounded-xl bg-slate-800 hover:bg-slate-700 active:scale-95 text-cyan-300 flex items-center justify-center transition"
        aria-label="Menos"
      >
        <Minus size={20} />
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        value={value}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, Math.trunc(n))));
        }}
        className="flex-1 min-w-0 h-12 rounded-xl bg-slate-900 border border-slate-700 text-center text-white text-xl font-bold outline-none focus:border-cyan-500"
      />
      <button
        type="button"
        onClick={() => onChange(Math.min(max, value + 1))}
        className="w-12 h-12 rounded-xl bg-cyan-500 hover:bg-cyan-400 active:scale-95 text-slate-950 flex items-center justify-center transition"
        aria-label="Más"
      >
        <Plus size={20} />
      </button>
    </div>
  );
}

function ModalShell({ title, onClose, children }: { title: string; onClose: () => void; children: React.ReactNode }) {
  return (
    <div className="fixed inset-0 z-[999] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-[420px] rounded-3xl bg-vimdy-surface border border-slate-700 shadow-2xl">
        <div className="flex items-center justify-between px-6 py-5 border-b border-slate-700">
          <h2 className="text-2xl font-bold text-white">{title}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1" aria-label="Cerrar">
            <X size={24} />
          </button>
        </div>
        <div className="p-6 space-y-5">{children}</div>
      </div>
    </div>
  );
}

function ErrorBox({ text }: { text: string }) {
  return <div className="rounded-xl bg-red-500/10 border border-red-500/40 text-red-300 px-4 py-3 text-sm">{text}</div>;
}

/* ---------------------------- + Nueva zona ---------------------------- */
function NewZoneDialog({
  allTables,
  existingZones,
  onClose,
  onCreated
}: {
  allTables: Table[];
  existingZones: string[];
  onClose: () => void;
  onCreated: (zone: string) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [count, setCount] = useState(4);
  const [capacity, setCapacity] = useState(4);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const suggestions = ["Salón Principal", "Terraza", "Sala del Fondo", "Bar"].filter(
    s => !existingZones.some(z => z.toLowerCase() === s.toLowerCase())
  );

  async function handleCreate() {
    const zone = name.trim().slice(0, 40);
    if (!zone) return setError("Escribe el nombre de la zona.");
    if (zone.toLowerCase() === NO_ZONE.toLowerCase() || existingZones.some(z => z.toLowerCase() === zone.toLowerCase())) {
      return setError("Ya tienes una zona con ese nombre.");
    }

    setBusy(true);
    setError(null);
    setProgress(0);

    // Una zona existe porque tiene mesas: se crea junto con sus primeras mesas.
    const working = [...allTables];
    let created = 0;
    try {
      for (let i = 1; i <= count; i++) {
        const tableName = resolveTableName(`Mesa ${i}`, zone, working);
        const table = await container.tableEngine.get().createTable({ name: tableName, capacity, zone });
        working.push(table);
        created = i;
        setProgress(i);
      }
      await onCreated(zone);
    } catch (err) {
      setError(
        created > 0
          ? `${errorText(err)} Se crearon ${created} de ${count} mesas; añade el resto con "Añadir mesa".`
          : errorText(err)
      );
      if (created > 0) await onCreated(zone);
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title="Nueva zona" onClose={onClose}>
      {error && <ErrorBox text={error} />}

      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-2">Nombre de la zona</label>
        <input
          autoFocus
          value={name}
          maxLength={40}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Terraza"
          className="w-full h-12 px-4 rounded-xl bg-slate-900 border border-slate-700 text-white outline-none focus:border-cyan-500"
        />
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-3">
            {suggestions.map(s => (
              <button
                key={s}
                type="button"
                onClick={() => setName(s)}
                className="px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-bold"
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-2">¿Cuántas mesas tiene?</label>
        <Stepper value={count} min={1} max={50} onChange={setCount} />
        <p className="text-slate-500 text-xs mt-2">Se crean como Mesa 1, Mesa 2… Luego puedes añadir más.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-2">Personas por mesa</label>
        <Stepper value={capacity} min={1} max={50} onChange={setCapacity} />
      </div>

      <div className="flex justify-end gap-3 pt-2">
        <button onClick={onClose} disabled={busy} className="h-12 px-6 rounded-xl bg-slate-700 text-white">
          Cancelar
        </button>
        <button
          onClick={handleCreate}
          disabled={busy}
          className="h-12 px-8 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold flex items-center gap-2"
        >
          {busy && <Loader2 size={16} className="animate-spin" />}
          {busy ? `Creando ${progress}/${count}…` : "Crear zona"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------ + Añadir mesa (en la zona) ------------------------ */
function AddTableDialog({
  zone,
  zoneTables,
  allTables,
  onClose,
  onCreated
}: {
  zone: string;
  zoneTables: Table[];
  allTables: Table[];
  onClose: () => void;
  onCreated: () => void | Promise<void>;
}) {
  const [number, setNumber] = useState(() => nextTableNumber(zoneTables));
  const [capacity, setCapacity] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [addedCount, setAddedCount] = useState(0);
  const [working, setWorking] = useState<Table[]>(allTables);

  async function save(keepOpen: boolean) {
    setBusy(true);
    setError(null);
    try {
      const tableName = resolveTableName(`Mesa ${number}`, zone, working);
      const created = await container.tableEngine.get().createTable({
        name: tableName,
        capacity,
        zone: zone === NO_ZONE ? undefined : zone
      });
      setWorking(prev => [...prev, created]);
      await onCreated();

      if (keepOpen) {
        setAddedCount(c => c + 1);
        setNumber(n => n + 1);
      } else {
        onClose();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={`Añadir mesa · ${zone}`} onClose={onClose}>
      {error && <ErrorBox text={error} />}
      {addedCount > 0 && !error && (
        <div className="rounded-xl bg-emerald-500/10 border border-emerald-500/40 text-emerald-300 px-4 py-3 text-sm">
          {addedCount === 1 ? "1 mesa añadida." : `${addedCount} mesas añadidas.`}
        </div>
      )}

      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-2">Número de mesa</label>
        <Stepper value={number} min={1} max={999} onChange={setNumber} />
        <p className="text-slate-500 text-xs mt-2">Se llamará “Mesa {number}”.</p>
      </div>

      <div>
        <label className="block text-sm font-semibold text-slate-300 mb-2 flex items-center gap-2">
          <Users size={14} /> Capacidad (personas)
        </label>
        <Stepper value={capacity} min={1} max={50} onChange={setCapacity} />
      </div>

      <div className="flex flex-wrap justify-end gap-3 pt-2">
        <button onClick={onClose} disabled={busy} className="h-12 px-5 rounded-xl bg-slate-700 text-white">
          {addedCount > 0 ? "Listo" : "Cancelar"}
        </button>
        <button
          onClick={() => save(true)}
          disabled={busy}
          className="h-12 px-5 rounded-xl bg-slate-800 border border-slate-600 text-white font-semibold disabled:opacity-50"
        >
          Guardar y añadir otra
        </button>
        <button
          onClick={() => save(false)}
          disabled={busy}
          className="h-12 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 disabled:opacity-50 text-slate-950 font-bold"
        >
          {busy ? "Guardando…" : "Añadir mesa"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ------------------------------ Pantalla ------------------------------ */
export function TableGrid({ tables, waiters = [], onSelect, avgDurationMs = 45 * 60 * 1000, onTablesChanged }: Props) {
  const { can } = useAuth();
  const canManage = can("tables.manage");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"zone" | "table" | null>(null);

  const waiterNames = useMemo(() => {
    const map = new Map<string, string>();
    waiters.forEach(w => map.set(w.id, w.name));
    return map;
  }, [waiters]);

  const mergedCountByTable = useMemo(() => {
    const map = new Map<string, number>();
    tables.forEach(t => {
      if (t.mergedInto) map.set(t.mergedInto, (map.get(t.mergedInto) ?? 0) + 1);
    });
    return map;
  }, [tables]);

  const visible = useMemo(() => tables.filter(t => t.status !== "CLOSED" && !t.mergedInto), [tables]);

  /** Zonas en orden de aparición; "Sin zona" siempre al final. */
  const zones = useMemo(() => {
    const list: string[] = [];
    visible.forEach(t => {
      const z = zoneOf(t);
      if (!list.includes(z)) list.push(z);
    });
    return list.sort((a, b) => (a === NO_ZONE ? 1 : b === NO_ZONE ? -1 : 0));
  }, [visible]);

  useEffect(() => {
    if (zones.length === 0) {
      if (activeZone !== null) setActiveZone(null);
    } else if (!activeZone || !zones.includes(activeZone)) {
      setActiveZone(zones[0]);
    }
  }, [zones, activeZone]);

  const zoneStats = useMemo(() => {
    const map = new Map<string, { free: number; total: number }>();
    visible.forEach(t => {
      const z = zoneOf(t);
      const s = map.get(z) ?? { free: 0, total: 0 };
      s.total += 1;
      if (t.status === "FREE") s.free += 1;
      map.set(z, s);
    });
    return map;
  }, [visible]);

  const zoneTables = useMemo(
    () => (activeZone ? visible.filter(t => zoneOf(t) === activeZone) : []),
    [visible, activeZone]
  );

  const filtered = useMemo(() => {
    let result = zoneTables;
    if (statusFilter !== "ALL") result = result.filter(t => t.status === statusFilter);
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(t => t.name.toLowerCase().includes(term));
    }
    return result;
  }, [zoneTables, statusFilter, search]);

  async function refresh() {
    await onTablesChanged?.();
  }

  const zoneDialog = dialog === "zone" && (
    <NewZoneDialog
      allTables={tables}
      existingZones={zones}
      onClose={() => setDialog(null)}
      onCreated={async (zone) => {
        await refresh();
        setActiveZone(zone);
        setDialog(null);
      }}
    />
  );

  if (visible.length === 0) {
    return (
      <>
        <div className="rounded-3xl border border-slate-800 bg-slate-900/60 p-12 text-center">
          <div className="mx-auto mb-4 w-14 h-14 rounded-2xl bg-slate-800 text-slate-400 flex items-center justify-center">
            <MapPin size={28} />
          </div>
          <p className="text-white text-xl font-bold">Todavía no tienes zonas ni mesas.</p>
          <p className="text-slate-400 text-sm mt-2 max-w-md mx-auto">
            {canManage
              ? "Crea tu primera zona (Salón, Terraza, Bar…) y dile cuántas mesas tiene."
              : "Pídele al administrador que cree las zonas y mesas."}
          </p>
          {canManage && (
            <button
              onClick={() => setDialog("zone")}
              className="mt-6 h-12 px-6 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold inline-flex items-center gap-2"
            >
              <Plus size={18} /> Nueva zona
            </button>
          )}
        </div>
        {zoneDialog}
      </>
    );
  }

  return (
    <div className="space-y-5">
      {/* Pestañas de zonas */}
      <div className="flex items-center gap-3 overflow-x-auto pb-1">
        {zones.map(zone => {
          const stats = zoneStats.get(zone);
          const active = zone === activeZone;
          return (
            <button
              key={zone}
              onClick={() => setActiveZone(zone)}
              className={`shrink-0 h-12 px-5 rounded-2xl border-2 font-bold text-sm uppercase tracking-wide flex items-center gap-2 active:scale-95 transition ${
                active
                  ? "border-cyan-400 bg-cyan-500/15 text-cyan-300"
                  : "border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-500"
              }`}
            >
              {zone}
              <span
                className={`text-[11px] px-2 py-0.5 rounded-full ${active ? "bg-cyan-400 text-slate-950" : "bg-slate-800 text-slate-400"}`}
                title="Mesas libres / total"
              >
                {stats?.free ?? 0}/{stats?.total ?? 0}
              </span>
            </button>
          );
        })}
        {canManage && (
          <button
            onClick={() => setDialog("zone")}
            className="shrink-0 h-12 px-5 rounded-2xl border-2 border-dashed border-cyan-500/60 text-cyan-300 hover:bg-cyan-500/10 active:scale-95 font-bold text-sm flex items-center gap-2 transition"
          >
            <Plus size={18} /> Nueva zona
          </button>
        )}
      </div>

      {/* Búsqueda + filtros por estado */}
      <div className="flex flex-col gap-3">
        <div className="relative">
          <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar mesa..."
            className="w-full h-10 pl-9 pr-4 rounded-xl bg-vimdy-surface border border-slate-700 text-white text-sm outline-none focus:border-cyan-500 transition"
          />
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {QUICK_FILTERS.map(item => (
            <button
              key={item.key}
              onClick={() => setStatusFilter(item.key)}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                statusFilter === item.key ? "bg-cyan-500 text-slate-950" : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {/* Mesas de la zona activa */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        {filtered.map(table => {
          const style = STATUS_STYLES[table.status];
          const isFree = table.status === "FREE" || table.status === "RESERVED";
          const elapsedMs = table.openedAt ? Date.now() - table.openedAt.getTime() : 0;
          const urgency = getTableUrgency(table, avgDurationMs);
          const waiterName = table.waiterId ? waiterNames.get(table.waiterId) : undefined;
          const mergedCount = mergedCountByTable.get(table.id);
          const mergedLabel = mergedCount
            ? ` / ${Array.from({ length: mergedCount + 1 })
                .map((_, i) => `Mesa ${String.fromCharCode(65 + i)}`)
                .join(" + ")}`
            : "";

          return (
            <button
              key={table.id}
              onClick={() => onSelect(table)}
              className={`${style.card} rounded-2xl border-2 text-left overflow-hidden min-h-[132px] active:scale-[0.97] hover:brightness-125 transition-all duration-200`}
            >
              <div className={`${style.header} px-4 py-1.5 text-xs font-black uppercase tracking-wider transition-colors duration-300`}>
                {style.label}
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="text-white text-xl font-black leading-tight uppercase">
                    {displayName(table)}
                    {mergedLabel && <span className="text-slate-300 text-sm font-normal ml-1 normal-case">{mergedLabel}</span>}
                  </h2>
                  <span className="text-slate-300 text-sm font-bold shrink-0" title="Capacidad">
                    P{table.capacity}
                  </span>
                </div>

                {isFree ? (
                  <p className={`${style.action} font-bold text-sm mt-4 uppercase`}>
                    {table.status === "RESERVED" ? "Abrir reserva →" : "Abrir mesa →"}
                  </p>
                ) : (
                  <>
                    <div className="flex items-center gap-3 mt-1 text-slate-200 text-xs">
                      <span className="flex items-center gap-1">
                        <Users size={12} /> Comensales: {table.peopleCount}
                      </span>
                      {table.openedAt && (
                        <span className="flex items-center gap-1">
                          <Clock size={12} /> {formatMinutes(elapsedMs)}
                        </span>
                      )}
                    </div>
                    <div className="flex items-end justify-between mt-3 gap-2">
                      <p className="text-white font-bold text-lg">${table.total.toLocaleString("es-CO")}</p>
                      {waiterName && (
                        <p className="text-slate-300 text-xs truncate max-w-[50%]" title={`Abrió ${waiterName}`}>
                          {waiterName}
                        </p>
                      )}
                    </div>
                    <div className="mt-3">
                      <div className="h-1.5 rounded-full bg-black/40 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${
                            urgency.level === "high" ? "bg-red-400" : urgency.level === "medium" ? "bg-amber-400" : "bg-emerald-400"
                          }`}
                          style={{ width: `${Math.round(urgency.progress)}%` }}
                        />
                      </div>
                      <p className="text-slate-300/80 text-[11px] mt-1">{urgency.action}</p>
                    </div>
                    <p className={`${style.action} font-bold text-sm mt-2 uppercase`}>Gestionar →</p>
                  </>
                )}
              </div>
            </button>
          );
        })}

        {canManage && activeZone && (
          <button
            onClick={() => setDialog("table")}
            className="rounded-2xl border-2 border-dashed border-slate-600 hover:border-cyan-500 hover:bg-cyan-500/5 text-slate-400 hover:text-cyan-300 min-h-[132px] flex flex-col items-center justify-center gap-2 active:scale-[0.97] transition"
          >
            <Plus size={28} />
            <span className="font-bold text-sm">Añadir mesa</span>
          </button>
        )}
      </div>

      {filtered.length === 0 && (
        <div className="text-center text-slate-500 py-6">
          {zoneTables.length === 0 ? "Esta zona todavía no tiene mesas." : "No se encontraron mesas con esos filtros."}
        </div>
      )}

      {zoneDialog}

      {dialog === "table" && activeZone && (
        <AddTableDialog
          zone={activeZone}
          zoneTables={zoneTables}
          allTables={tables}
          onClose={() => setDialog(null)}
          onCreated={refresh}
        />
      )}
    </div>
  );
}
