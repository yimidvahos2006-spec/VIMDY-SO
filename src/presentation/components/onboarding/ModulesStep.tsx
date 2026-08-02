import { useEffect, useState } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { setEnabledModules } from "../../../infrastructure/supabase/authBusinessContext";
import { enabledModulesStore } from "../../../core/store/enabledModulesStore";
import { MODULE_CATALOG, getDefaultModulesForBusinessType } from "../../../core/config/modules";
import type { BusinessTypeId } from "../../../core/config/businessTypes";

interface ModulesStepProps {
  businessId: string;
  /** Tipo de negocio elegido en el PASO 3, ya guardado en Supabase. */
  businessType: BusinessTypeId;
  onSaved: () => void;
}

/**
 * PASO 4 del asistente de onboarding (FASE 3).
 *
 * A partir del tipo de negocio del PASO 3, calcula qué módulos van
 * activos (ver src/core/config/modules.ts), los guarda de inmediato en
 * Supabase (enabled_modules) y actualiza enabledModulesStore para que el
 * Sidebar se adapte en vivo, sin esperar a un refresh. Muestra el
 * resultado real (✓ activos / ✗ ocultos) y deja continuar solo cuando el
 * guardado en la base de datos fue exitoso.
 */
export function ModulesStep({ businessId, businessType, onSaved }: ModulesStepProps) {
  const [saving, setSaving] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const defaultModules = getDefaultModulesForBusinessType(businessType);

  useEffect(() => {
    let cancelled = false;

    async function save() {
      setSaving(true);
      setError(null);
      try {
        await setEnabledModules(businessId, defaultModules);
        if (cancelled) return;
        enabledModulesStore.set(defaultModules);
        setSaved(true);
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "No se pudieron guardar los módulos.";
        setError(message);
      } finally {
        if (!cancelled) setSaving(false);
      }
    }

    save();

    return () => {
      cancelled = true;
    };
    // Solo se recalcula si cambia el negocio o su tipo — defaultModules es
    // determinístico a partir de businessType, no hace falta en las deps.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessId, businessType]);

  const enabledSet = new Set(defaultModules);

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Preparando tus módulos
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Según tu tipo de negocio, activamos automáticamente lo que necesitas.
        </p>
      </div>

      <div className="flex flex-col gap-2 mb-8">
        {MODULE_CATALOG.map((module) => {
          const isEnabled = enabledSet.has(module.id);

          return (
            <div
              key={module.id}
              className={`
                flex items-center gap-3 rounded-xl border px-4 py-3
                ${isEnabled ? "border-slate-700 bg-slate-900/60" : "border-slate-800 bg-slate-900/20 opacity-50"}
              `}
            >
              <span className="text-lg">{module.emoji}</span>
              <span className="flex-1 text-sm font-medium text-white">{module.label}</span>
              <span className={isEnabled ? "text-emerald-400" : "text-slate-600"}>
                {isEnabled ? "✓" : "✗"}
              </span>
            </div>
          );
        })}
      </div>

      {saving && (
        <p className="text-center text-sm text-slate-400">Guardando configuración...</p>
      )}

      {error && (
        <div className="flex flex-col items-center gap-3">
          <p className="text-center text-sm text-red-400">{error}</p>
          <VimdyButton
            variant="secondary"
            onClick={() => {
              setSaving(true);
              setError(null);
              setEnabledModules(businessId, defaultModules)
                .then(() => {
                  enabledModulesStore.set(defaultModules);
                  setSaved(true);
                })
                .catch((err: unknown) => {
                  const message = err instanceof Error ? err.message : "No se pudieron guardar los módulos.";
                  setError(message);
                })
                .finally(() => setSaving(false));
            }}
          >
            Reintentar
          </VimdyButton>
        </div>
      )}

      {saved && !error && (
        <div className="flex justify-center">
          <VimdyButton onClick={onSaved} className="min-w-[200px]">
            Continuar
          </VimdyButton>
        </div>
      )}
    </GlassCard>
  );
}