import { useState, useEffect } from "react";
import {
  ShoppingCart,
  Users,
  CalendarCheck,
  ChefHat,
  BarChart3,
  Settings,
  UtensilsCrossed,
  CheckCircle2,
  Loader2
} from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
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

const MODULE_ICONS: Record<ModuleId, React.ElementType> = {
  mesas: CalendarCheck,
  cocina: ChefHat,
  pedidos: UtensilsCrossed,
  caja: ShoppingCart,
  inventario: BarChart3,
  clientes: Users,
  ia: Settings
};

export function ModulesStep({ businessId, businessType, onSaved }: ModulesStepProps) {
  const [selectedModules, setSelectedModules] = useState<Set<ModuleId>>(new Set());
  const [tableCount, setTableCount] = useState<string>("");
  const [saving, setSaving] = useState(false);
  const [creatingTables, setCreatingTables] = useState(false);
  const [createdTables, setCreatedTables] = useState(0);
  const [error, setError] = useState<string | null>(null);

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
          throw new Error("Debes especificar cuÃ¡ntas mesas tiene tu negocio.");
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
      const message = err instanceof Error ? err.message : "No se pudieron guardar los mÃ³dulos.";
      setError(message);
    } finally {
      setSaving(false);
      setCreatingTables(false);
    }
  }

  const hasTables = selectedModules.has("mesas");
  const canContinue = selectedModules.size > 0;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 2 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">Â¿QuÃ© mÃ³dulos necesitas?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Activa los mÃ³dulos que usarÃ¡ tu negocio. Puedes cambiarlos despuÃ©s en ConfiguraciÃ³n.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {MODULE_CATALOG.map((module) => {
          const isEnabled = selectedModules.has(module.id);
          const Icon = MODULE_ICONS[module.id];

          return (
            <button
              key={module.id}
              type="button"
              onClick={() => toggleModule(module.id)}
              disabled={saving}
              className={`
                group relative flex items-center gap-4 rounded-vimdy-lg border-2 px-5 py-4
                transition-all duration-200 text-left
                disabled:cursor-not-allowed
                ${
                  isEnabled
                    ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                    : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                }
              `}
            >
              {isEnabled && (
                <span className="absolute top-3 right-3 text-vimdy-accent">
                  <CheckCircle2 size={18} />
                </span>
              )}

              <div className={`
                w-11 h-11 rounded-vimdy-md flex items-center justify-center shrink-0 transition-colors
                ${isEnabled ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Icon size={22} strokeWidth={1.8} />
              </div>

              <div className="flex-1 min-w-0">
                <span className={`block text-sm font-semibold ${isEnabled ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                  {module.label}
                </span>
              </div>

              <div className={`
                w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all shrink-0
                ${isEnabled ? "bg-vimdy-accent border-vimdy-accent" : "border-vimdy-border bg-vimdy-surface"}
              `}>
                {isEnabled && <CheckCircle2 size={14} className="text-white" />}
              </div>
            </button>
          );
        })}
      </div>

      {hasTables && (
        <VimdyCard padding="lg" className="mt-8">
          <div>
            <label htmlFor="table-count" className="block text-sm font-semibold text-vimdy-text-secondary mb-2">
              Â¿CuÃ¡ntas mesas tiene tu negocio?
            </label>
            <input
              id="table-count"
              type="number"
              min="1"
              max="999"
              value={tableCount}
              onChange={(e) => setTableCount(e.target.value)}
              placeholder="Ej: 12"
              disabled={saving || creatingTables}
              className="w-full rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-background px-4 py-3 text-center text-vimdy-text placeholder-vimdy-text-muted outline-none transition-all duration-200 focus:border-vimdy-accent focus:ring-4 focus:ring-vimdy-accent/10 disabled:opacity-50"
            />
            {creatingTables && (
              <p className="mt-3 text-sm text-vimdy-text-secondary flex items-center justify-center gap-2">
                <Loader2 size={14} className="animate-spin" />
                Creando mesas... {createdTables}/{tableCount}
              </p>
            )}
          </div>
        </VimdyCard>
      )}

      {(saving || creatingTables) && !error && (
        <p className="text-center text-sm text-vimdy-text-secondary mt-6">
          {creatingTables ? "Creando mesas..." : "Guardando configuraciÃ³n..."}
        </p>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
          <span className="mt-0.5 shrink-0">âš </span>
          <span>{error}</span>
        </div>
      )}

      <div className="flex justify-center mt-8">
        <VimdyButton
          onClick={handleSave}
          disabled={saving || creatingTables || !canContinue}
          size="lg"
          className="min-w-[200px]"
        >
          {saving || creatingTables ? (
            <span className="flex items-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Guardando...
            </span>
          ) : (
            "Continuar"
          )}
        </VimdyButton>
      </div>
    </div>
  );
}

