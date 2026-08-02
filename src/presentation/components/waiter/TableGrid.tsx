import React, { useMemo } from "react";
import { Users } from "lucide-react";

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
  WAITING_BILL: { dot: "bg-cyan-500", label: "Esperando cuenta" },
  PAYING: { dot: "bg-purple-500", label: "Cobrando" },
  CLOSED: { dot: "bg-slate-600", label: "Unida" }
};

export function TableGrid({ tables, onSelect }: Props) {
  const zones = useMemo(() => {
    const visible = tables.filter(t => t.status !== "CLOSED");
    const grouped = new Map<string, Table[]>();

    visible.forEach(table => {
      const zone = table.zone ?? "Sin zona";
      if (!grouped.has(zone)) grouped.set(zone, []);
      grouped.get(zone)!.push(table);
    });

    return Array.from(grouped.entries());
  }, [tables]);

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
    <div className="space-y-8">
      {zones.map(([zone, zoneTables]) => (
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
      ))}
    </div>
  );
}