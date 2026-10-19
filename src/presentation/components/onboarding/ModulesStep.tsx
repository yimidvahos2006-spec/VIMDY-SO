import { useState } from "react";
import {
  ShoppingCart,
  Users,
  CalendarCheck,
  ChefHat,
  BarChart3,
  Settings,
  UtensilsCrossed,
  UserRound,
  Monitor,
  Printer,
  CheckCircle2,
  Loader2,
} from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { setBusinessOperatingProfile } from "../../../infrastructure/supabase/authBusinessContext";
import { enabledModulesStore } from "../../../core/store/enabledModulesStore";
import { businessOperatingProfileStore } from "../../../core/store/businessOperatingProfileStore";
import { hydrateBusinessOperatingProfile } from "../../../core/bootstrap/businessOperatingProfileBootstrap";
import { MODULE_CATALOG } from "../../../core/config/modules";
import type { ModuleId } from "../../../core/config/modules";
import type { BusinessTypeId } from "../../../core/config/businessTypes";
import {
  DEFAULT_OPERATION_CONFIG,
  type OperationConfig,
  type KitchenOutputModeConfig,
} from "../../../core/config/operation";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useStepDraft } from "./useStepDraft";

interface ModulesStepProps {
  businessId: string;
  /** Se mantiene por compatibilidad con OnboardingPage; ya no preselecciona nada. */
  businessType?: BusinessTypeId;
  onSaved: (selectedModules: ModuleId[]) => void;
}

const DEFAULT_TABLE_CAPACITY = 4;

/**
 * Módulos que el sistema necesita siempre para funcionar (la ruta de Caja y la
 * de Inventario no abren si están apagados; Pedidos es el flujo de tomar
 * pedidos; IA es el copiloto). No se eligen: van siempre incluidos.
 */
const REQUIRED_MODULES: ModuleId[] = ["caja", "pedidos", "inventario", "ia"];

type KitchenChoice = Exclude<KitchenOutputModeConfig, "none">;

interface Choice {
  mesas: boolean;
  meseros: boolean;
  cocina: boolean;
  clientes: boolean;
  tableCount: string;
  kitchenOutput: KitchenChoice | null;
}

const EMPTY_CHOICE: Choice = {
  mesas: false,
  meseros: false,
  cocina: false,
  clientes: false,
  tableCount: "",
  kitchenOutput: null,
};

function sanitizeChoice(raw: unknown): Choice | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const output = r.kitchenOutput;
  return {
    mesas: r.mesas === true,
    meseros: r.meseros === true,
    cocina: r.cocina === true,
    clientes: r.clientes === true,
    tableCount: typeof r.tableCount === "string" ? r.tableCount.replace(/\D/g, "").slice(0, 3) : "",
    kitchenOutput: output === "kds" || output === "printer" || output === "both" ? output : null,
  };
}

const MODULE_ICONS: Record<ModuleId, React.ElementType> = {
  mesas: CalendarCheck,
  cocina: ChefHat,
  pedidos: UtensilsCrossed,
  caja: ShoppingCart,
  inventario: BarChart3,
  clientes: Users,
  ia: Settings,
};

const KITCHEN_OPTIONS: ReadonlyArray<{
  id: KitchenChoice;
  label: string;
  detail: string;
  icon: React.ElementType;
}> = [
  { id: "kds", label: "En pantalla", detail: "Los pedidos aparecen en una pantalla", icon: Monitor },
  { id: "printer", label: "Ticket impreso", detail: "Sale un ticket por la impresora", icon: Printer },
  { id: "both", label: "Pantalla y ticket", detail: "Las dos cosas", icon: ChefHat },
];

export function ModulesStep({ businessId, onSaved }: ModulesStepProps) {
  // Empieza vacío: lo opcional lo marca el usuario. Lo elegido se guarda al
  // instante y se recupera si sale de la página, vuelve con "Atrás" o recarga.
  const [choice, setChoice] = useStepDraft<Choice>("modules", EMPTY_CHOICE, sanitizeChoice);
  const [saving, setSaving] = useState(false);
  const [creatingTables, setCreatingTables] = useState(false);
  const [createdTables, setCreatedTables] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const requiredModules = MODULE_CATALOG.filter((m) => REQUIRED_MODULES.includes(m.id));

  function toggle(key: "mesas" | "meseros" | "cocina" | "clientes") {
    setChoice((current) => {
      const next = { ...current, [key]: !current[key] };
      if (key === "mesas" && !next.mesas) next.tableCount = "";
      if (key === "cocina" && !next.cocina) next.kitchenOutput = null;
      return next;
    });
  }

  const kitchenMissing = choice.cocina && choice.kitchenOutput === null;
  const canContinue = !kitchenMissing;

  async function handleSave() {
    if (!canContinue) return;
    setSaving(true);
    setError(null);
    try {
      const modules: ModuleId[] = [...REQUIRED_MODULES];
      if (choice.mesas) modules.push("mesas");
      if (choice.cocina) modules.push("cocina");
      if (choice.clientes) modules.push("clientes");

      if (choice.mesas) {
        const count = parseInt(choice.tableCount.trim(), 10);
        if (isNaN(count) || count < 1) {
          throw new Error("Escribe cuántas mesas tiene tu negocio.");
        }

        setCreatingTables(true);
        setCreatedTables(0);
        for (let i = 1; i <= count; i++) {
          try {
            await container.tableEngine.get().createTable({
              name: `Mesa ${i}`,
              capacity: DEFAULT_TABLE_CAPACITY,
            });
          } catch (tableError) {
            // Si el usuario volvió con "Atrás" y esa mesa ya existe, no es un error.
            if (!(tableError instanceof Error && tableError.message.includes("TABLE_NAME_DUPLICATE"))) {
              throw tableError;
            }
          }
          setCreatedTables(i);
        }
        setCreatingTables(false);
      }

      // Conserva lo que ya tenga el negocio en el resto de la configuración
      // (canales de venta, tipo de inventario, etc.) y cambia solo lo de este paso.
      const current: OperationConfig =
        businessOperatingProfileStore.get().profile?.operationConfig ?? DEFAULT_OPERATION_CONFIG;
      const output: KitchenOutputModeConfig = choice.cocina ? (choice.kitchenOutput ?? "kds") : "none";

      const config: OperationConfig = {
        ...current,
        serviceMode: choice.mesas ? "both" : "counter",
        tablesEnabled: choice.mesas,
        waiterModeEnabled: choice.meseros,
        kitchenEnabled: choice.cocina,
        kitchenOutputMode: output,
        kdsEnabled: choice.cocina && (output === "kds" || output === "both"),
        printerEnabled: choice.cocina && (output === "printer" || output === "both"),
      };

      // UNA sola escritura: módulos + mesas + meseros + cocina juntos, para que
      // el menú y las pantallas nunca queden con una combinación a medias.
      await setBusinessOperatingProfile(businessId, modules, config);
      enabledModulesStore.set(modules);
      await hydrateBusinessOperatingProfile(businessId);

      const snapshot = businessOperatingProfileStore.get();
      if (snapshot.status !== "ready" || snapshot.businessId !== businessId) {
        throw new Error(snapshot.error ?? "No se pudo confirmar la configuración guardada. Inténtalo de nuevo.");
      }

      onSaved(modules);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar la configuración.";
      setError(message);
    } finally {
      setSaving(false);
      setCreatingTables(false);
    }
  }

  const options: ReadonlyArray<{
    key: "mesas" | "meseros" | "cocina" | "clientes";
    label: string;
    detail: string;
    hint?: string;
    icon: React.ElementType;
  }> = [
    { key: "mesas", label: "Mesas", detail: "Atiendes en mesas", icon: MODULE_ICONS.mesas },
    {
      key: "meseros",
      label: "Meseros",
      detail: "Tienes meseros que toman los pedidos",
      hint: "Si atiendes solo, déjalo sin marcar",
      icon: UserRound,
    },
    {
      key: "cocina",
      label: "Cocina",
      detail: "¿Los pedidos se preparan en una cocina aparte?",
      hint: "Sirve para pantalla o ticket impreso",
      icon: MODULE_ICONS.cocina,
    },
    { key: "clientes", label: "Clientes", detail: "Guardas tus clientes y sus compras", icon: MODULE_ICONS.clientes },
  ];

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 3 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Qué módulos necesitas?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Marca solo lo que vas a usar. Puedes cambiarlo después en Configuración.
        </p>
      </div>

      <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-text-tertiary font-semibold mb-3">
        Elige los que necesites
      </p>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {options.map((option) => {
          const isEnabled = choice[option.key];
          const Icon = option.icon;

          return (
            <button
              key={option.key}
              type="button"
              onClick={() => toggle(option.key)}
              disabled={saving}
              aria-pressed={isEnabled}
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
              <div className={`
                w-11 h-11 rounded-vimdy-md flex items-center justify-center shrink-0 transition-colors
                ${isEnabled ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Icon size={22} strokeWidth={1.8} />
              </div>

              <div className="flex-1 min-w-0">
                <span className={`block text-sm font-semibold ${isEnabled ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                  {option.label}
                </span>
                <span className="block text-vimdy-micro text-vimdy-text-tertiary mt-0.5">
                  {option.detail}
                </span>
                {option.hint && (
                  <span className="block text-vimdy-micro text-vimdy-text-tertiary mt-0.5">
                    {option.hint}
                  </span>
                )}
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

      {choice.mesas && (
        <VimdyCard padding="lg" className="mt-6">
          <label htmlFor="table-count" className="block text-sm font-semibold text-vimdy-text-secondary mb-2">
            ¿Cuántas mesas tiene tu negocio?
          </label>
          <input
            id="table-count"
            type="number"
            min="1"
            max="999"
            value={choice.tableCount}
            onChange={(e) => setChoice((current) => ({ ...current, tableCount: e.target.value }))}
            placeholder="Ej: 12"
            disabled={saving || creatingTables}
            className="w-full rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-background px-4 py-3 text-center text-vimdy-text placeholder-vimdy-text-muted outline-none transition-all duration-200 focus:border-vimdy-accent focus:ring-4 focus:ring-vimdy-accent/10 disabled:opacity-50"
          />
          {creatingTables && (
            <p className="mt-3 text-sm text-vimdy-text-secondary flex items-center justify-center gap-2">
              <Loader2 size={14} className="animate-spin" />
              Creando mesas... {createdTables}/{choice.tableCount}
            </p>
          )}
        </VimdyCard>
      )}

      {choice.meseros && (
        <p className="mt-4 text-vimdy-small text-vimdy-text-tertiary text-center">
          Tus meseros los agregas después en Configuración o en el paso de equipo.
        </p>
      )}

      {choice.cocina && (
        <VimdyCard padding="lg" className="mt-6">
          <p className="text-sm font-semibold text-vimdy-text-secondary mb-3">
            ¿Cómo le llegan los pedidos a la cocina?
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {KITCHEN_OPTIONS.map((option) => {
              const selected = choice.kitchenOutput === option.id;
              const Icon = option.icon;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setChoice((current) => ({ ...current, kitchenOutput: option.id }))}
                  disabled={saving}
                  aria-pressed={selected}
                  className={`
                    flex flex-col items-center gap-2 rounded-vimdy-md border-2 px-3 py-4 text-center transition-all duration-200
                    disabled:cursor-not-allowed
                    ${
                      selected
                        ? "border-vimdy-accent bg-vimdy-accent/10"
                        : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60"
                    }
                  `}
                >
                  <Icon size={20} strokeWidth={1.8} className={selected ? "text-vimdy-accent" : "text-vimdy-text-secondary"} />
                  <span className={`text-sm font-semibold ${selected ? "text-vimdy-text" : "text-vimdy-text-secondary"}`}>
                    {option.label}
                  </span>
                  <span className="text-vimdy-micro text-vimdy-text-tertiary">{option.detail}</span>
                </button>
              );
            })}
          </div>
          {kitchenMissing && (
            <p className="mt-3 text-vimdy-small text-vimdy-text-tertiary text-center">
              Elige una opción para continuar.
            </p>
          )}
        </VimdyCard>
      )}

      <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-text-tertiary font-semibold mt-8 mb-3">
        Siempre incluidos
      </p>
      <ul className="flex flex-wrap gap-2" aria-label="Módulos siempre incluidos">
        {requiredModules.map((module) => {
          const Icon = MODULE_ICONS[module.id];
          return (
            <li
              key={module.id}
              className="flex items-center gap-2 rounded-vimdy-md border border-vimdy-border-subtle bg-vimdy-surface px-3 py-2 text-vimdy-small text-vimdy-text-secondary"
            >
              <Icon size={16} strokeWidth={1.8} className="text-vimdy-accent" />
              {module.label}
              <CheckCircle2 size={14} className="text-vimdy-accent" aria-hidden="true" />
            </li>
          );
        })}
      </ul>

      {(saving || creatingTables) && !error && (
        <p className="text-center text-sm text-vimdy-text-secondary mt-6">
          {creatingTables ? "Creando mesas..." : "Guardando configuración..."}
        </p>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
          <span className="mt-0.5 shrink-0">⚠</span>
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