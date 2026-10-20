import React, { useEffect, useMemo, useState } from "react";
import { Users, Search, Clock, Plus, Minus, X, Loader2, MapPin, Trash2, Pencil, Utensils, EllipsisVertical, CalendarClock } from "lucide-react";

import { Table, Waiter } from "../../../core/entities/Entities";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { getTableUrgency } from "../../../core/services/tableUrgency";
import { translateBusinessError } from "../../../core/errors/translateBusinessError";
import { toast } from "../../../core/store/toastStore";
import { sortTables, tableDisplayName, tableNumber } from "../../../core/services/tableOrdering";

interface Props {
  tables: Table[];
  /** Para mostrar qué mesero abrió cada mesa. */
  waiters?: Waiter[];
  onSelect: (table: Table) => void;
  /** Si se pasa, el menú ⋮ de una mesa libre ofrece "Reservar mesa". */
  onReserve?: (table: Table) => void;
  avgDurationMs?: number;
  /** Se llama después de crear una zona o una mesa para recargar la lista. */
  onTablesChanged?: () => void | Promise<void>;
}

const NO_ZONE = "Sin zona";

type Status = Table["status"];

interface StatusStyle {
  label: string;
  /** Borde de la tarjeta (tinte del estado sobre la superficie VIMDY). */
  border: string;
  /** Píldora de estado. */
  pill: string;
}

/** Superficie y texto de VIMDY; el estado solo tiñe el borde y la píldora. Clases estáticas para Tailwind. */
const STATUS_STYLES: Record<Status, StatusStyle> = {
  FREE: { label: "Libre", border: "border-vimdy-success/40", pill: "bg-vimdy-success-bg text-vimdy-success border-vimdy-success/40" },
  RESERVED: { label: "Reservada", border: "border-indigo-400/50", pill: "bg-indigo-500/15 text-indigo-300 border-indigo-400/40" },
  BUSY: { label: "Ocupada", border: "border-vimdy-danger/50", pill: "bg-vimdy-danger-bg text-vimdy-danger-hover border-vimdy-danger/40" },
  WAITING_FOOD: { label: "Esperando comida", border: "border-orange-400/50", pill: "bg-orange-500/15 text-orange-300 border-orange-400/40" },
  EATING: { label: "Comiendo", border: "border-vimdy-accent/50", pill: "bg-vimdy-accent/15 text-vimdy-accent-hover border-vimdy-accent/40" },
  CUENTA_SOLICITADA: { label: "Por cobrar", border: "border-vimdy-warning/60", pill: "bg-vimdy-warning-bg text-vimdy-warning-hover border-vimdy-warning/40" },
  WAITING_BILL: { label: "Esperando cuenta", border: "border-cyan-400/50", pill: "bg-cyan-500/15 text-cyan-300 border-cyan-400/40" },
  PAYING: { label: "Cobrando", border: "border-purple-400/50", pill: "bg-purple-500/15 text-purple-300 border-purple-400/40" },
  CLOSED: { label: "Unida", border: "border-vimdy-border", pill: "bg-vimdy-surface-active text-vimdy-text-secondary border-vimdy-border" }
};

const QUICK_FILTERS: { key: Status | "ALL"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "FREE", label: "Libres" },
  { key: "BUSY", label: "Ocupadas" },
  { key: "EATING", label: "Comiendo" },
  { key: "WAITING_FOOD", label: "Esperando" },
  { key: "CUENTA_SOLICITADA", label: "Por cobrar" },
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
  return tableDisplayName(table);
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

/** Reloj que se refresca solo: los minutos de cada mesa avanzan sin tocar nada. */
function useNow(intervalMs = 30000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);
  return now;
}

/* ---------------------------- Eliminar zona ---------------------------- */
function DeleteZoneDialog({
  zone,
  zoneTables,
  onClose,
  onDeleted
}: {
  zone: string;
  zoneTables: Table[];
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // No se borra una zona con mesas que tengan cuenta abierta (ni reservadas).
  const blocking = zoneTables.filter(t => t.status !== "FREE" || t.items.length > 0 || Boolean(t.orderId));

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await container.tableEngine.get().deleteZone(zone);
      toast.success(`Zona "${zone}" eliminada.`);
      await onDeleted();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo eliminar la zona. Revisa tu conexión e inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  if (blocking.length > 0) {
    return (
      <ModalShell title="No se puede eliminar" onClose={onClose}>
        <p className="text-slate-300 text-sm leading-relaxed">
          La zona <span className="font-bold text-white">{zone}</span> tiene mesas con cuenta abierta o reservadas.
          Cóbralas o libéralas primero:
        </p>
        <div className="flex flex-wrap gap-2">
          {blocking.map(t => (
            <span key={t.id} className="px-3 py-1.5 rounded-lg bg-red-500/15 border border-red-500/40 text-red-200 text-sm font-semibold">
              {displayName(t)}
            </span>
          ))}
        </div>
        <button onClick={onClose} className="w-full h-12 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold">
          Entendido
        </button>
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Eliminar zona" onClose={onClose}>
      {error && <ErrorBox text={error} />}
      <p className="text-slate-300 text-sm leading-relaxed">
        ¿Eliminar la zona <span className="font-bold text-white">{zone}</span>
        {zoneTables.length > 0 ? ` y sus ${zoneTables.length} mesa${zoneTables.length === 1 ? "" : "s"}` : ""}?
        Esta acción no se puede deshacer.
      </p>
      <div className="flex justify-end gap-3">
        <button onClick={onClose} className="h-12 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold">
          Cancelar
        </button>
        <button
          onClick={handleDelete}
          disabled={busy}
          className="h-12 px-6 rounded-xl bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-bold flex items-center gap-2"
        >
          {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
          {busy ? "Eliminando…" : "Sí, eliminar zona"}
        </button>
      </div>
    </ModalShell>
  );
}

/* ---------------------------- Eliminar mesa ---------------------------- */
function DeleteTableDialog({
  table,
  onClose,
  onDeleted
}: {
  table: Table;
  onClose: () => void;
  onDeleted: () => void | Promise<void>;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const blocked = table.status !== "FREE" || table.items.length > 0 || Boolean(table.orderId);

  async function handleDelete() {
    setBusy(true);
    setError(null);
    try {
      await container.tableEngine.get().deleteTable(table.id);
      toast.success(`${displayName(table)} eliminada.`);
      await onDeleted();
    } catch (err) {
      setError(translateBusinessError(err, "No se pudo eliminar la mesa. Revisa tu conexión e inténtalo de nuevo."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <ModalShell title={blocked ? "No se puede eliminar" : "Eliminar mesa"} onClose={onClose}>
      {error && <ErrorBox text={error} />}
      {blocked ? (
        <>
          <p className="text-slate-300 text-sm leading-relaxed">
            <span className="font-bold text-white">{displayName(table)}</span> no está libre. Cóbrala o libérala primero.
          </p>
          <button onClick={onClose} className="w-full h-12 rounded-xl bg-slate-700 hover:bg-slate-600 text-white font-bold">
            Entendido
          </button>
        </>
      ) : (
        <>
          <p className="text-slate-300 text-sm leading-relaxed">
            ¿Eliminar <span className="font-bold text-white">{displayName(table)}</span>? Esta acción no se puede deshacer.
          </p>
          <div className="flex justify-end gap-3">
            <button onClick={onClose} className="h-12 px-5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 font-semibold">
              Cancelar
            </button>
            <button
              onClick={handleDelete}
              disabled={busy}
              className="h-12 px-6 rounded-xl bg-red-500 hover:bg-red-400 disabled:opacity-50 text-white font-bold flex items-center gap-2"
            >
              {busy ? <Loader2 size={16} className="animate-spin" /> : <Trash2 size={16} />}
              {busy ? "Eliminando…" : "Sí, eliminar"}
            </button>
          </div>
        </>
      )}
    </ModalShell>
  );
}

/* ------------------------------ Pantalla ------------------------------ */
export function TableGrid({ tables, waiters = [], onSelect, onReserve, avgDurationMs = 45 * 60 * 1000, onTablesChanged }: Props) {
  const { can } = useAuth();
  const canManage = can("tables.manage");

  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Status | "ALL">("ALL");
  const [activeZone, setActiveZone] = useState<string | null>(null);
  const [dialog, setDialog] = useState<"zone" | "table" | "deleteZone" | null>(null);
  const [editMode, setEditMode] = useState(false);
  const [tableToDelete, setTableToDelete] = useState<Table | null>(null);
  const [menuTableId, setMenuTableId] = useState<string | null>(null);
  const now = useNow();

  // El menú ⋮ se cierra al tocar fuera o con Escape.
  useEffect(() => {
    if (!menuTableId) return;
    function onPointerDown(event: PointerEvent) {
      if (!(event.target as HTMLElement | null)?.closest("[data-table-menu]")) setMenuTableId(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuTableId(null);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuTableId]);

  const waiterNames = useMemo(() => {
    const map = new Map<string, string>();
    waiters.forEach(w => map.set(w.id, w.name));
    return map;
  }, [waiters]);

  /** Nombres de las mesas unidas a cada mesa principal ("Mesa 4", "Mesa 6"…). */
  const mergedNamesByTable = useMemo(() => {
    const map = new Map<string, string[]>();
    tables.forEach(t => {
      if (t.mergedInto) map.set(t.mergedInto, [...(map.get(t.mergedInto) ?? []), displayName(t)]);
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
    // Orden natural (1, 2, 3 … 10) dentro de la zona; filtered y la búsqueda heredan este orden.
    () => (activeZone ? sortTables(visible.filter(t => zoneOf(t) === activeZone)) : []),
    [visible, activeZone]
  );

  const filtered = useMemo(() => {
    let result = zoneTables;
    if (statusFilter !== "ALL") result = result.filter(t => t.status === statusFilter);
    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(t => t.name.toLowerCase().includes(term) || displayName(t).toLowerCase().includes(term));
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
        {canManage && activeZone && activeZone !== NO_ZONE && (
          <button
            onClick={() => setDialog("deleteZone")}
            className="shrink-0 h-12 px-4 rounded-2xl border-2 border-red-500/40 text-red-300 hover:bg-red-500/10 active:scale-95 font-bold text-sm flex items-center gap-2 transition"
            aria-label={`Eliminar zona ${activeZone}`}
          >
            <Trash2 size={16} /> Eliminar zona
          </button>
        )}
        {canManage && (
          <button
            onClick={() => setEditMode(v => !v)}
            aria-pressed={editMode}
            className={`shrink-0 h-12 px-4 rounded-2xl border-2 font-bold text-sm flex items-center gap-2 active:scale-95 transition ${
              editMode ? "border-red-400 bg-red-500/15 text-red-200" : "border-slate-700 text-slate-300 hover:border-slate-500"
            }`}
          >
            <Pencil size={16} /> {editMode ? "Listo" : "Editar mesas"}
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
          const isFree = table.status === "FREE";
          const isReserved = table.status === "RESERVED";
          const isIdle = isFree || isReserved;
          const elapsedMs = table.openedAt ? now - table.openedAt.getTime() : 0;
          const urgency = getTableUrgency(table, avgDurationMs);
          const waiterName = table.waiterId ? waiterNames.get(table.waiterId) : undefined;
          const mergedNames = mergedNamesByTable.get(table.id);
          const mergedLabel = mergedNames?.length ? ` + ${mergedNames.join(" + ")}` : "";
          // En modo edición una mesa libre se toca para eliminarla, no para abrirla.
          const deletable = editMode && canManage && isIdle;
          const itemCount = table.items.reduce((sum, item) => sum + (item.quantity || 1), 0);
          const number = tableNumber(table);

          // Menú ⋮: solo acciones que no son la principal de la tarjeta.
          const menuItems: { key: string; label: string; danger?: boolean; icon: React.ReactNode; run: () => void }[] = [];
          if (isFree && onReserve) {
            menuItems.push({ key: "reserve", label: "Reservar mesa", icon: <CalendarClock size={18} />, run: () => onReserve(table) });
          }
          if (isFree && canManage) {
            menuItems.push({ key: "delete", label: "Eliminar mesa", danger: true, icon: <Trash2 size={18} />, run: () => setTableToDelete(table) });
          }
          const menuOpen = menuTableId === table.id;

          const primaryLabel = deletable ? "Eliminar mesa" : isFree ? "Abrir mesa" : isReserved ? "Abrir reserva" : "Gestionar";
          const runPrimary = () => (deletable ? setTableToDelete(table) : onSelect(table));

          return (
            <div
              key={table.id}
              onClick={runPrimary}
              className={`relative ${menuOpen ? "z-20" : ""} flex flex-col gap-3 min-h-[196px] p-3.5 rounded-vimdy-lg border-2 bg-vimdy-surface ${style.border} hover:bg-vimdy-surface-hover active:scale-[0.98] cursor-pointer transition-all duration-vimdy-normal ${
                deletable ? "ring-2 ring-vimdy-danger/70" : ""
              }`}
            >
              {/* Estado + menú */}
              <div className="flex items-center justify-between gap-2">
                <span className={`px-3 py-1 rounded-full border text-xs font-bold whitespace-nowrap ${style.pill}`}>
                  {style.label}
                </span>
                {menuItems.length > 0 && !deletable ? (
                  <div className="relative" data-table-menu onClick={(e) => e.stopPropagation()}>
                    <button
                      type="button"
                      onClick={() => setMenuTableId(menuOpen ? null : table.id)}
                      aria-haspopup="menu"
                      aria-expanded={menuOpen}
                      aria-label={`Más opciones de ${displayName(table)}`}
                      className="w-11 h-11 -mr-2 -my-2 rounded-vimdy-md text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface-active flex items-center justify-center"
                    >
                      <EllipsisVertical size={20} />
                    </button>
                    {menuOpen && (
                      <div
                        role="menu"
                        className="absolute right-0 top-full mt-1 w-52 rounded-vimdy-md border border-vimdy-border bg-vimdy-surface-active shadow-vimdy-md overflow-hidden"
                      >
                        {menuItems.map(item => (
                          <button
                            key={item.key}
                            type="button"
                            role="menuitem"
                            onClick={() => {
                              setMenuTableId(null);
                              item.run();
                            }}
                            className={`w-full h-12 px-3 flex items-center gap-3 text-sm font-semibold text-left hover:bg-vimdy-surface-hover ${
                              item.danger ? "text-vimdy-danger-hover" : "text-vimdy-text"
                            }`}
                          >
                            {item.icon}
                            {item.label}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <span className="h-6" aria-hidden="true" />
                )}
              </div>

              {/* Mesa + comensales */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1" aria-hidden="true">
                  <span className="w-1.5 h-6 rounded-full bg-vimdy-border" />
                  <span className="w-11 h-11 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border text-vimdy-text text-xl font-black flex items-center justify-center">
                    {number ?? displayName(table).charAt(0).toUpperCase()}
                  </span>
                  <span className="w-1.5 h-6 rounded-full bg-vimdy-border" />
                </div>
                <span
                  className="flex items-center gap-1 text-vimdy-text-secondary text-sm font-semibold"
                  title={isIdle ? "Capacidad" : "Comensales / capacidad"}
                >
                  <Users size={15} />
                  {isIdle ? table.capacity : `${table.peopleCount}/${table.capacity}`}
                </span>
              </div>

              {/* Nombre, total y estado del pedido */}
              <div className="min-w-0">
                <h2 className="text-vimdy-text text-lg font-bold leading-tight truncate">
                  {displayName(table)}
                  {mergedLabel && <span className="text-vimdy-text-secondary text-sm font-normal ml-1">{mergedLabel}</span>}
                </h2>
                <p className="text-vimdy-text-secondary text-base">${table.total.toLocaleString("es-CO")}</p>
                <div className="flex items-center justify-between gap-2 mt-1 text-vimdy-text-secondary text-xs">
                  <span className="flex items-center gap-1 min-w-0">
                    <Clock size={13} className="shrink-0" />
                    {isIdle ? (isReserved ? "Reservada" : "Sin pedido") : table.openedAt ? formatMinutes(elapsedMs) : "En curso"}
                  </span>
                  {!isIdle && waiterName && (
                    <span className="truncate max-w-[50%]" title={`Abrió ${waiterName}`}>
                      {waiterName}
                    </span>
                  )}
                </div>
                {!isIdle && (
                  <div className="h-1 mt-2 rounded-full bg-black/40 overflow-hidden" title={urgency.action}>
                    <div
                      className={`h-full rounded-full ${
                        urgency.level === "high" ? "bg-vimdy-danger" : urgency.level === "medium" ? "bg-vimdy-warning" : "bg-vimdy-success"
                      }`}
                      style={{ width: `${Math.round(urgency.progress)}%` }}
                    />
                  </div>
                )}
              </div>

              {/* Pedido (indicador) + acción principal */}
              <div className="mt-auto flex items-center gap-2">
                <span
                  className={`relative w-11 h-11 shrink-0 rounded-vimdy-md border flex items-center justify-center ${
                    itemCount > 0
                      ? "bg-vimdy-accent/10 border-vimdy-accent/40 text-vimdy-accent-hover"
                      : "bg-vimdy-surface-active border-vimdy-border text-vimdy-text-tertiary"
                  }`}
                  title={itemCount > 0 ? `${itemCount} producto${itemCount === 1 ? "" : "s"} en el pedido` : "Sin pedido"}
                  aria-label={itemCount > 0 ? `${itemCount} productos en el pedido` : "Sin pedido"}
                >
                  <Utensils size={18} />
                  {itemCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-vimdy-accent text-white text-[10px] font-bold flex items-center justify-center">
                      {itemCount}
                    </span>
                  )}
                </span>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    runPrimary();
                  }}
                  className={`flex-1 min-w-0 h-11 px-3 rounded-vimdy-md border text-sm font-bold whitespace-nowrap transition ${
                    deletable
                      ? "bg-vimdy-danger-bg border-vimdy-danger/50 text-vimdy-danger-hover"
                      : isFree
                        ? "bg-vimdy-accent hover:bg-vimdy-accent-hover border-transparent text-white"
                        : "bg-vimdy-surface-active border-vimdy-border hover:border-vimdy-accent text-vimdy-text"
                  }`}
                >
                  {primaryLabel}
                </button>
              </div>
            </div>
          );
        })}

        {canManage && activeZone && (
          <button
            onClick={() => setDialog("table")}
            className="rounded-vimdy-lg border-2 border-dashed border-vimdy-border hover:border-vimdy-accent hover:bg-vimdy-accent/5 text-vimdy-text-secondary hover:text-vimdy-accent-hover min-h-[196px] flex flex-col items-center justify-center gap-2 active:scale-[0.97] transition"
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

      {dialog === "deleteZone" && activeZone && (
        <DeleteZoneDialog
          zone={activeZone}
          zoneTables={visible.filter(t => zoneOf(t) === activeZone)}
          onClose={() => setDialog(null)}
          onDeleted={async () => {
            setDialog(null);
            setActiveZone(null);
            await refresh();
          }}
        />
      )}

      {tableToDelete && (
        <DeleteTableDialog
          table={tableToDelete}
          onClose={() => setTableToDelete(null)}
          onDeleted={async () => {
            setTableToDelete(null);
            await refresh();
          }}
        />
      )}

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