import { useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { setKitchenOutputMode } from "../../../infrastructure/supabase/authBusinessContext";
import type { KitchenOutputMode } from "../../../core/services/kitchenOutput";

interface CocinaConfigStepProps {
  businessId: string;
  onSaved: (mode: KitchenOutputMode) => void;
}

/**
 * PASO 5.2 condicional del asistente de onboarding.
 *
 * Solo se muestra si el negocio tiene el módulo "cocina" activo.
 * Pregunta cómo quiere ver las comandas en cocina.
 *
 * - Pantalla/TV → muestra comandas en pantalla (KDS)
 * - Impresora → imprime comandas (ticket térmico)
 */
export function CocinaConfigStep({ businessId, onSaved }: CocinaConfigStepProps) {
  const [selected, setSelected] = useState<KitchenOutputMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(mode: KitchenOutputMode) {
    if (saving) return;
    setSelected(mode);
    setSaving(true);
    setError(null);

    try {
      await setKitchenOutputMode(businessId, mode);
      onSaved(mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar la configuración.";
      setError(message);
      setSelected(null);
      setSaving(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          ¿Cómo ves las comandas?
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Elige cómo quieres que cocina reciba los pedidos
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <button
          type="button"
          onClick={() => handleSelect("pantalla")}
          disabled={saving}
          className={`
            flex flex-col items-center gap-3 rounded-2xl border px-4 py-6
            transition-all duration-300
            disabled:cursor-not-allowed
            ${
              selected === "pantalla"
                ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
            }
            ${saving && selected !== "pantalla" ? "opacity-40" : ""}
          `}
        >
          <span className="text-3xl">📺</span>
          <span className="text-sm font-semibold text-white">Pantalla / TV</span>
          <span className="text-xs text-slate-400">Kitchen Display System</span>
        </button>

        <button
          type="button"
          onClick={() => handleSelect("impresora")}
          disabled={saving}
          className={`
            flex flex-col items-center gap-3 rounded-2xl border px-4 py-6
            transition-all duration-300
            disabled:cursor-not-allowed
            ${
              selected === "impresora"
                ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
            }
            ${saving && selected !== "impresora" ? "opacity-40" : ""}
          `}
        >
          <span className="text-3xl">🖨️</span>
          <span className="text-sm font-semibold text-white">Impresora</span>
          <span className="text-xs text-slate-400">Ticket térmico</span>
        </button>
      </div>

      {saving && !error && (
        <p className="text-center text-sm text-slate-400">Guardando configuración...</p>
      )}

      {error && (
        <p className="text-center text-sm text-red-400">{error}</p>
      )}
    </GlassCard>
  );
}
