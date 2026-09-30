import React, { useMemo, useState } from "react";
import { Users, Search, Filter, Clock } from "lucide-react";

import { Table } from "../../../core/entities/Entities";
import { EmptyState } from "../ui/EmptyState";
import { getTableUrgency, getUrgencyBorder, getUrgencyBg } from "../../../core/services/tableUrgency";

interface Props {
  tables: Table[];
  onSelect: (table: Table) => void;
  avgDurationMs?: number;
}

const STATUS_STYLES: Record<Table["status"], { dot: string; label: string; bg: string; border: string }> = {
  FREE: { dot: "bg-emerald-500", label: "Libre", bg: "bg-emerald-500/5", border: "border-emerald-500/40" },
  RESERVED: { dot: "bg-amber-500", label: "Reservada", bg: "bg-amber-500/5", border: "border-amber-500/40" },
  BUSY: { dot: "bg-red-500", label: "Ocupada", bg: "bg-red-500/5", border: "border-red-500/40" },
  WAITING_FOOD: { dot: "bg-orange-500", label: "Esperando comida", bg: "bg-orange-500/5", border: "border-orange-500/40" },
  EATING: { dot: "bg-blue-500", label: "Comiendo", bg: "bg-blue-500/5", border: "border-blue-500/40" },
  CUENTA_SOLICITADA: { dot: "bg-amber-500", label: "Cuenta solicitada", bg: "bg-amber-500/5", border: "border-amber-500/40" },
  WAITING_BILL: { dot: "bg-cyan-500", label: "Esperando cuenta", bg: "bg-cyan-500/5", border: "border-cyan-500/40" },
  PAYING: { dot: "bg-purple-500", label: "Cobrando", bg: "bg-purple-500/5", border: "border-purple-500/40" },
  CLOSED: { dot: "bg-slate-600", label: "Unida", bg: "bg-slate-800/40", border: "border-slate-700" }
};

const QUICK_FILTERS: { key: Table["status"] | "ALL"; label: string }[] = [
  { key: "ALL", label: "Todas" },
  { key: "FREE", label: "Libres" },
  { key: "BUSY", label: "Ocupadas" },
  { key: "EATING", label: "Comiendo" },
  { key: "WAITING_FOOD", label: "Esperando" },
  { key: "RESERVED", label: "Reservadas" }
];

function formatMinutes(ms: number): string {
  const minutes = Math.max(0, Math.floor(ms / 60000));
  return `${minutes} min`;
}

export function TableGrid({ tables, onSelect, avgDurationMs = 45 * 60 * 1000 }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<Table["status"] | "ALL">("ALL");

  const mergedCountByTable = useMemo(() => {
    const map = new Map<string, number>();
    tables.forEach(t => {
      if (t.mergedInto) {
        map.set(t.mergedInto, (map.get(t.mergedInto) ?? 0) + 1);
      }
    });
    return map;
  }, [tables]);

  const filtered = useMemo(() => {
    let result = tables.filter(t => {
      if (t.status === "CLOSED") return false;
      if (t.mergedInto) return false;
      return true;
    });

    if (statusFilter !== "ALL") {
      result = result.filter(t => t.status === statusFilter);
    }

    if (search.trim()) {
      const term = search.trim().toLowerCase();
      result = result.filter(t => {
        const name = t.name.toLowerCase();
        const zone = (t.zone ?? "Sin zona").toLowerCase();
        return name.includes(term) || zone.includes(term);
      });
    }

    return result;
  }, [tables, statusFilter, search]);

  const grouped = useMemo(() => {
    const grouped = new Map<string, Table[]>();
    filtered.forEach(table => {
      const zone = table.zone ?? "Sin zona";
      if (!grouped.has(zone)) grouped.set(zone, []);
      grouped.get(zone)!.push(table);
    });
    return Array.from(grouped.entries());
  }, [filtered]);

  if (tables.length === 0) {
    return (
      <EmptyState
        icon={<Users size={28} />}
        title="Todavía no tienes mesas configuradas."
        description="Las mesas se configuran una vez en el asistente inicial de VIMDY (Onboarding)."
      />
    );
  }

  return (
    <div className="space-y-6">
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
                statusFilter === item.key
                  ? "bg-cyan-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      {grouped.length === 0 ? (
        <div className="text-center text-slate-500 py-10">
          No se encontraron mesas con esos filtros.
        </div>
      ) : (
        grouped.map(([zone, zoneTables]) => (
          <div key={zone}>
            <h3 className="text-slate-300 font-bold text-lg mb-4">{zone}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
              {zoneTables.map(table => {
                const style = STATUS_STYLES[table.status];
                const isFree = table.status === "FREE" || table.status === "RESERVED";
                const elapsedMs = table.openedAt ? Date.now() - table.openedAt.getTime() : 0;
                const mergedLabel = mergedCountByTable.get(table.id)
                  ? ` / ${Array.from({ length: mergedCountByTable.get(table.id)! + 1 }).map((_, i) => `Mesa ${String.fromCharCode(64 + (i + 1))}`).join(" + ")}`
                  : "";

                return (
                  <button
                    key={table.id}
                    onClick={() => onSelect(table)}
                    className={`${style.bg} rounded-2xl border ${style.border} hover:border-cyan-500 transition-all p-5 text-left relative overflow-hidden`}
                  >
                    <div className={`absolute top-0 left-0 w-1 h-full ${style.dot}`} />
                    <div className="pl-2">
                      <div className="flex items-center justify-between mb-1">
                        <span className={`text-xs font-bold uppercase tracking-wide ${style.dot.replace('bg-', 'text-')}`}>
                          {style.label}
                        </span>
                      </div>
                      <h2 className="text-white text-xl font-bold leading-tight">
                        {table.name}
                        {mergedLabel && <span className="text-slate-400 text-sm font-normal ml-1">{mergedLabel}</span>}
                      </h2>
                      <div className="flex items-center justify-between mt-4">
                        {isFree ? (
                          <span className="text-cyan-400 font-bold text-sm">Abrir mesa →</span>
                        ) : (
                          <>
                            <p className="text-slate-400 flex items-center gap-1.5 text-sm">
                              <Users size={14} />
                              {table.peopleCount} / {table.capacity}
                            </p>
                            {table.openedAt && (
                              <p className="text-slate-400 flex items-center gap-1 text-xs">
                                <Clock size={12} />
                                {formatMinutes(elapsedMs)}
                              </p>
                            )}
                          </>
                        )}
                      </div>
                      {!isFree && (
                        <p className="text-white font-bold text-lg mt-3">
                          ${table.total.toLocaleString("es-CO")}
                        </p>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))
      )}
    </div>
  );
}
