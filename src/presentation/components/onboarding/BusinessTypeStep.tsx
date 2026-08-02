import { useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { setBusinessType } from "../../../infrastructure/supabase/authBusinessContext";
import { BUSINESS_TYPES, type BusinessTypeId } from "../../../core/config/businessTypes";

interface BusinessTypeStepProps {
  businessId: string;
  onSaved: (businessType: BusinessTypeId) => void;
}

/**
 * PASO 3 del asistente de onboarding (FASE 3).
 *
 * Muestra las 10 opciones reales de negocio (ver src/core/config/businessTypes.ts).
 * Al elegir una, guarda business_type en Supabase de inmediato (setBusinessType) —
 * si falla, se muestra el error real y el usuario puede reintentar. Solo avanza
 * al PASO 4 (onSaved) cuando el guardado en la base de datos fue exitoso.
 */
export function BusinessTypeStep({ businessId, onSaved }: BusinessTypeStepProps) {
  const [selected, setSelected] = useState<BusinessTypeId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(businessType: BusinessTypeId) {
    if (saving) return;

    setSelected(businessType);
    setSaving(true);
    setError(null);

    try {
      await setBusinessType(businessId, businessType);
      onSaved(businessType);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar el tipo de negocio.";
      setError(message);
      setSelected(null);
    } finally {
      setSaving(false);
    }
  }

  return (
    <GlassCard className="w-full max-w-2xl px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          ¿Qué tipo de negocio tienes?
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Con esto activamos los módulos correctos para ti.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {BUSINESS_TYPES.map((type) => {
          const isSelected = selected === type.id;
          const isLocked = saving && !isSelected;

          return (
            <button
              key={type.id}
              type="button"
              onClick={() => handleSelect(type.id)}
              disabled={saving}
              className={`
                flex flex-col items-center gap-2 rounded-2xl border px-4 py-5
                transition-all duration-300
                disabled:cursor-not-allowed
                ${
                  isSelected
                    ? "border-cyan-400 bg-cyan-400/10 shadow-[0_0_30px_rgba(143,215,255,.25)] scale-[1.03]"
                    : "border-slate-700 bg-slate-900/60 hover:border-cyan-500/60 hover:bg-slate-800/60"
                }
                ${isLocked ? "opacity-40" : ""}
              `}
            >
              <span className="text-3xl">{type.emoji}</span>
              <span className="text-sm font-semibold text-white">{type.label}</span>
              {isSelected && saving && (
                <span className="text-xs text-cyan-300">Guardando...</span>
              )}
            </button>
          );
        })}
      </div>

      {error && (
        <p className="mt-6 text-center text-sm text-red-400">{error}</p>
      )}
    </GlassCard>
  );
}