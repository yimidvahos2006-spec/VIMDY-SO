import { useState, useEffect } from "react";

import { GlassCard } from "../ui/GlassCard";
import { VimdyButton } from "../ui/VimdyButton";
import { setEnabledModules } from "../../../infrastructure/supabase/authBusinessContext";
import { enabledModulesStore } from "../../../core/store/enabledModulesStore";
import { MODULE_CATALOG, getDefaultModulesForBusinessType } from "../../../core/config/modules";
import type { ModuleId } from "../../../core/config/modules";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import { container } from "../../../infrastructure/di/CompositionRoot";

interface ModulesStepProps {
  businessId: string;
  businessType?: BusinessTypeId;
  onSaved: (selectedModules: ModuleId[]) => void;
}

const DEFAULT_TABLE_CAPACITY = 4;

export function ModulesStep({ businessId, businessType, onSaved }: ModulesStepProps) {
  const [selectedModules, setSelectedModules] = useState<Set<ModuleId>>(new Set());
  const [tableCount, setTableCount] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [creatingTables, setCreatingTables] = useState(false);
  const [createdTables, setCreatedTables] = useState(0);
  const [error, setError] = useState<string | null>(null);

  // Pre-seleccionar módulos según el tipo de negocio al montar el componente
  useEffect(() => {
    if (businessType) {
      const defaultModules = getDefaultModulesForBusinessType(businessType);
      setSelectedModules(new Set(defaultModules));
    }
  }, [businessType]);

  function toggleModule(moduleId: ModuleId) {
    const newSet = new Set(selectedModules);
    if (newSet.has(moduleId)) {
      newSet.delete(moduleId);
      if (moduleId === "mesas") {
        setTableCount("");
      }
    } else {
      newSet.add(moduleId);
    }
    setSelectedModules(newSet);
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      const modulesArray = Array.from(selectedModules) as ModuleId[];

      if (modulesArray.includes("mesas")) {
        const count = parseInt(tableCount.trim(), 10);
        if (isNaN(count) || count < 1) {
          throw new Error("Debes especificar cuántas mesas tiene tu negocio.");
        }

        setCreatingTables(true);
        setCreatedTables(0);
        let created = 0;
        for (let i = 1; i <= count; i++) {
          await container.tableEngine.get().createTable({
            name: `Mesa ${i}`,
            capacity: DEFAULT_TABLE_CAPACITY
          });
          created = i;
          setCreatedTables(i);
        }
        setCreatingTables(false);
      }

      await setEnabledModules(businessId, modulesArray);
      enabledModulesStore.set(modulesArray);
      onSaved(modulesArray);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudieron guardar los módulos.";
      setError(message);
    } finally {
      setSaving(false);
      setCreatingTables(false);
    }
  }

  const hasTables = selectedModules.has("mesas");
  const canContinue = selectedModules.size > 0;

  return (
    <GlassCard className="w-full max-w-lg px-6 py-10 sm:px-10 hover:translate-y-0 hover:scale-100 hover:border-slate-800 hover:shadow-xl">
      <div className="flex flex-col items-center gap-2 text-center mb-8">
        <h2 className="text-2xl sm:text-3xl font-bold text-white tracking-wide">
          Elige los módulos que tu negocio necesita
        </h2>
        <p className="text-slate-400 text-sm max-w-sm">
          Activa los módulos que usarás. Puedes cambiarlos después en Configuración.
        </p>
      </div>

      <div className="flex flex-col gap-2 mb-6">
        {MODULE_CATALOG.map((module) => {
          const isEnabled = selectedModules.has(module.id);

          return (
            <div key={module.id}>
              <label
                htmlFor={`module-${module.id}`}
                className={`
                  flex items-center gap-3 rounded-xl border px-4 py-3 cursor-pointer
                  transition-all duration-200
                  ${isEnabled
                    ? "border-cyan-500/50 bg-slate-900/60"
                    : "border-slate-800 bg-slate-900/20 hover:border-slate-700 hover:bg-slate-800/60"}
                `}
              >
                <input
                  id={`module-${module.id}`}
                  type="checkbox"
                  checked={isEnabled}
                  onChange={() => toggleModule(module.id)}
                  disabled={saving}
                  className="h-5 w-5 rounded border border-slate-600 text-cyan-400 focus:ring-cyan-400/50 bg-slate-950 cursor-pointer disabled:cursor-not-allowed"
                />
                <span className="text-lg">{module.emoji}</span>
                <span className="flex-1 text-sm font-medium text-white">{module.label}</span>
              </label>

              <div
                className={`
                  overflow-hidden transition-all duration-300 ease-out
                  ${hasTables && module.id === "mesas"
                    ? "max-h-32 opacity-100 py-3"
                    : "max-h-0 opacity-0 pointer-events-none"}
                `}
              >
                {module.id === "mesas" && (
                  <div className="px-4 pt-2">
                    <label className="text-sm text-slate-300">Cantidad de mesas</label>
                    <input
                      type="number"
                      min="1"
                      max="999"
                      value={tableCount}
                      onChange={(e) => setTableCount(e.target.value)}
                      placeholder="Ej: 12"
                      disabled={saving}
                      className={`
                        mt-2 w-full rounded-xl border border-slate-700 bg-slate-950/60 px-4 py-2.5
                        text-center text-white placeholder-slate-500 outline-none
                        focus:border-cyan-400 focus:ring-1 focus:ring-cyan-400/30 transition-colors
                        disabled:cursor-not-allowed
                      `}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {(saving || creatingTables) && (
        <p className="text-center text-sm text-slate-400">
          {creatingTables
            ? `Creando mesas... ${createdTables}/${tableCount}`
            : "Guardando configuración..."}
        </p>
      )}

      {error && (
        <p className="text-center text-sm text-red-400">{error}</p>
      )}

      <div className="flex justify-center mt-4">
        <VimdyButton
          onClick={handleSave}
          disabled={saving || creatingTables || !canContinue}
          className="min-w-[200px]"
        >
          {saving || creatingTables ? "Guardando..." : "Continuar"}
        </VimdyButton>
      </div>
    </GlassCard>
  );
}
