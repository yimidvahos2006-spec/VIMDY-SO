import React, { useMemo, useState } from "react";
import { Users, Search, Filter } from "lucide-react";

import { Table, TableStatus } from "../../../core/entities/Entities";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  tables: Table[];
  onSelect: (table: Table) => void;
}

const STATUS_STYLES: Record<TableStatus, { dot: string; label: string }> = {
  FREE: { dot: "bg-green-500", label: "Libre" },
  RESERVED: { dot: "bg-yellow-500", label: "Reservada" },
  BUSY: { dot: "bg-red-500", label: "Ocupada" },
  WAITING_FOOD: { dot: "bg-orange-500", label: "Esperando comida" },
  EATING: { dot: "bg-blue-500", label: "Comiendo" },
  CUENTA_SOLICITADA: { dot: "bg-amber-500", label: "Cuenta solicitada" },
  WAITING_BILL: { dot: "bg-cyan-500", label: "Esperando cuenta" },
  PAYING: { dot: "bg-purple-500", label: "Cobrando" },
  CLOSED: { dot: "bg-slate-600", label: "Unida" }
};

const FILTERABLE_STATUSES: TableStatus[] = [
  "FREE",
  "BUSY",
  "EATING",
  "WAITING_FOOD",
  "CUENTA_SOLICITADA",
  "WAITING_BILL",
  "PAYING",
  "RESERVED"
];

export function TableGrid({ tables, onSelect }: Props) {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<TableStatus | "ALL">("ALL");
  const [zoneFilter, setZoneFilter] = useState<string | "ALL">("ALL");

  const zones = useMemo(() => {
    const set = new Set<string>();
    tables.forEach(table => set.add(table.zone ?? "Sin zona"));
    return Array.from(set);
  }, [tables]);

  const filtered = useMemo(() => {
    let result = tables.filter(t => t.status !== "CLOSED");

    if (statusFilter !== "ALL") {
      result = result.filter(t => t.status === statusFilter);
    }

    if (zoneFilter !== "ALL") {
      result = result.filter(t => (t.zone ?? "Sin zona") === zoneFilter);
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
  }, [tables, statusFilter, zoneFilter, search]);

  const grouped = useMemo(() => {
    const grouped = new Map<string, Table[]>();
    filtered.forEach(table => {
      const zone = table.zone ?? "Sin zona";
      if (!grouped.has(zone)) grouped.set(zone, []);
      grouped.get(zone)!.push(table);
    });
    return Array.from(grouped.entries());
  }, [filtered]);

  const activeFilterCount =
    (statusFilter !== "ALL" ? 1 : 0) +
    (zoneFilter !== "ALL" ? 1 : 0);

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

        <div className="flex items-center gap-2">
          <Filter size={16} className="text-slate-400 shrink-0" />
          <div className="flex gap-2 overflow-x-auto pb-1 flex-1">
            <button
              onClick={() => setStatusFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                statusFilter === "ALL"
                  ? "bg-cyan-500 text-slate-950"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Todas
            </button>
            {FILTERABLE_STATUSES.map(status => {
              const style = STATUS_STYLES[status];
              return (
                <button
                  key={status}
                  onClick={() => setStatusFilter(status)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition flex items-center gap-1.5 ${
                    statusFilter === status
                      ? "bg-cyan-500 text-slate-950"
                      : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                  }`}
                >
                  <span className={`w-2 h-2 rounded-full ${style.dot}`} />
                  {style.label}
                </button>
              );
            })}
          </div>
        </div>

        {zones.length > 1 && (
          <div className="flex gap-2 overflow-x-auto pb-1">
            <button
              onClick={() => setZoneFilter("ALL")}
              className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                zoneFilter === "ALL"
                  ? "bg-slate-700 text-white"
                  : "bg-slate-800 text-slate-300 hover:bg-slate-700"
              }`}
            >
              Todas las zonas
            </button>
            {zones.map(zone => (
              <button
                key={zone}
                onClick={() => setZoneFilter(zone)}
                className={`px-3 py-1.5 rounded-lg text-xs font-bold whitespace-nowrap transition ${
                  zoneFilter === zone
                    ? "bg-slate-700 text-white"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700"
                }`}
              >
                {zone}
              </button>
            ))}
          </div>
        )}
      </div>

      {grouped.length === 0 ? (
        <div className="text-center text-slate-500 py-10">
          No se encontraron mesas con esos filtros.
        </div>
      ) : (
        grouped.map(([zone, zoneTables]) => (
          <div key={zone}>
            <h3 className="text-slate-300 font-bold text-lg mb-4">{zone}</h3>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
              {zoneTables.map(table => {
                const style = STATUS_STYLES[table.status];
                return (
                  <button
                    key={table.id}
                    onClick={() => onSelect(table)}
                    className="bg-vimdy-surface rounded-3xl border border-slate-800 hover:border-cyan-500 transition-all p-6 text-left"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className={`w-4 h-4 rounded-full ${style.dot}`} />
                      <span className="text-xs text-slate-400">{style.label}</span>
                    </div>
                    <h2 className="text-white text-xl font-bold">{table.name}</h2>
                    <p className="text-slate-400 flex items-center gap-1.5 mt-2 text-sm">
                      <Users size={14} />
                      {table.peopleCount} / {table.capacity}
                    </p>
                    <p className="text-cyan-400 mt-2 font-bold">
                      ${table.total.toLocaleString("es-CO")}
                    </p>
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
