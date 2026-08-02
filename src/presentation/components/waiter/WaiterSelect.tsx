import React from "react";
import { UserCircle2, Users } from "lucide-react";

import { Waiter } from "../../../core/entities/Entities";
import { EmptyState } from "../ui/EmptyState";

interface Props {
  waiters: Waiter[];
  onSelect: (waiter: Waiter) => void;
}

/**
 * Primer paso de la pantalla Meseros: en vez de pedir login, el mesero
 * simplemente toca su nombre. Los nombres se administran desde
 * Configuración > Meseros (WaitersSettingsSection). Si no hay ninguno
 * activo, se lo dice claro al dueño en vez de dejar la pantalla vacía.
 */
export function WaiterSelect({ waiters, onSelect }: Props) {
  if (waiters.length === 0) {
    return (
      <EmptyState
        icon={<Users size={28} />}
        title="Todavía no has agregado meseros."
        description='Ve a Configuración → Meseros y agrega los nombres de tu equipo. Aparecerán aquí como tarjetas para que cada uno toque la suya.'
      />
    );
  }

  return (
    <div>
      <p className="text-slate-400 mb-6 text-lg">Toca tu nombre para empezar.</p>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-5">
        {waiters.map(waiter => (
          <button
            key={waiter.id}
            onClick={() => onSelect(waiter)}
            className="flex flex-col items-center justify-center gap-3 bg-vimdy-surface rounded-3xl border border-slate-800 hover:border-cyan-500 hover:bg-slate-800/60 transition-all p-8"
          >
            <UserCircle2 size={48} className="text-cyan-400" />
            <span className="text-white text-xl font-bold text-center">
              {waiter.name}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}