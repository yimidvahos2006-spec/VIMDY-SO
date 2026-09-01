import { useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";

interface MeserosConfigStepProps {
  onSaved: (hasWaiters: boolean) => void;
}

/**
 * PASO 5.1 condicional del asistente de onboarding.
 *
 * Solo se muestra si el negocio tiene el módulo "mesas" activo.
 * Pregunta si el negocio tiene meseros que atienden las mesas.
 *
 * - Si SÍ tiene meseros → activa módulo "meseros"
 * - Si NO tiene meseros (autoservicio) → desactiva módulo "meseros"
 */
export function MeserosConfigStep({ onSaved }: MeserosConfigStepProps) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSelect(hasWaiters: boolean) {
    if (saving) return;
    setSelected(hasWaiters);
    setSaving(true);

    try {
      onSaved(hasWaiters);
    } catch {
      setSelected(null);
      setSaving(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          ¿Tienes meseros?
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          ¿Hay personal que toma pedidos y atiende las mesas, o los clientes se sientan solos?
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          type="button"
          onClick={() => handleSelect(true)}
          disabled={saving}
          className={`
            flex flex-col items-center gap-3 rounded-2xl border px-4 py-6
            transition-all duration-300
            disabled:cursor-not-allowed
            ${
              selected === true
                ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
            }
            ${saving && selected !== true ? "opacity-40" : ""}
          `}
        >
          <span className="text-3xl">🧑‍🍳</span>
          <span className="text-sm font-semibold text-white">Sí, tengo meseros</span>
          <span className="text-xs text-slate-400">Servicio tradicional</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect(false)}
          disabled={saving}
          className={`
            flex flex-col items-center gap-3 rounded-2xl border px-4 py-6
            transition-all duration-300
            disabled:cursor-not-allowed
            ${
              selected === false
                ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
            }
            ${saving && selected !== false ? "opacity-40" : ""}
          `}
        >
          <span className="text-3xl">🪑</span>
          <span className="text-sm font-semibold text-white">No, autoservicio</span>
          <span className="text-xs text-slate-400">Clientes se sientan solos</span>
        </button>
      </div>

      {saving && (
        <p className="text-center text-sm text-slate-400">Guardando configuración...</p>
      )}
    </GlassCard>
  );
}
