import { AlertTriangle, Building2, Check, RotateCcw, Sliders } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { toast } from "../../../core/store/toastStore";
import { useBusinessOperatingProfile } from "../../../core/store/useBusinessOperatingProfile";
import { useOperationSettings } from "../../../core/store/useOperationSettings";
import { hydrateBusinessOperatingProfile } from "../../../core/bootstrap/businessOperatingProfileBootstrap";
import {
  SALES_CHANNEL_OPTIONS,
  INVENTORY_TYPE_OPTIONS,
  PRODUCTION_MODE_OPTIONS,
} from "../../../core/config/operation";
import { VimdyButton } from "../ui/VimdyButton";
import { BranchManager } from "./BranchManager";
import { SectionCard } from "./settingsPrimitives";

/**
 * Configuración > Operación ("Cómo trabaja tu negocio").
 *
 * Fuente explícita de cómo trabaja el negocio: no deduce capacidades por el
 * tipo de negocio y mantiene "Mesas" y "Meseros" separados (un negocio puede
 * tener meseros sin mesas). Todos los ajustes de esta pantalla viven en un solo
 * borrador tipado (ver core/config/operationDraft.ts) y se guardan juntos con
 * un único UPDATE en Supabase (ver core/services/operationSettingsService.ts).
 */
export function OperationSettings() {
  const { businessId, can } = useAuth();
  const profile = useBusinessOperatingProfile();
  const { draft, dispatch, ready, dirty, saving, issues, canSave, save, discard } =
    useOperationSettings(businessId ?? null);

  const canEdit = can("company.settings");

  async function handleSave() {
    const result = await save();
    if (!result.ok) {
      toast.error(result.message);
      return;
    }
    if (result.confirmed) {
      toast.success("Configuración guardada y aplicada.");
    } else {
      toast.warning("Se guardó, pero no pudimos confirmarlo con el servidor. Recarga la página para ver los cambios aplicados.");
    }
  }

  async function handleRetry() {
    if (businessId) await hydrateBusinessOperatingProfile(businessId);
  }

  if (!ready) {
    if (profile.status === "error") {
      return (
        <div className="mx-auto max-w-3xl space-y-4 rounded-2xl border border-red-500/30 bg-red-500/10 p-6">
          <p className="text-sm text-red-200">
            {profile.error ?? "No se pudo cargar la configuración operativa."}
          </p>
          <VimdyButton variant="secondary" size="sm" onClick={() => void handleRetry()}>
            Reintentar
          </VimdyButton>
        </div>
      );
    }
    return (
      <div className="mx-auto max-w-3xl space-y-4" aria-busy="true">
        <div className="h-24 animate-pulse rounded-2xl bg-slate-800/50" />
        <div className="h-48 animate-pulse rounded-2xl bg-slate-800/50" />
        <p className="text-sm text-slate-500">Cargando configuración...</p>
      </div>
    );
  }

  const warnings = issues.filter((issue) => issue.severity === "warning");
  const errors = issues.filter((issue) => issue.severity === "error");

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">Configuración</p>
        <h1 className="mt-2 text-3xl font-bold text-white">Cómo trabaja tu negocio</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          VIMDY adapta Caja, Meseros, Mesas, Cocina e Inventario a estas decisiones. Puedes cambiarlas cuando cambie tu operación.
        </p>
        {!canEdit && (
          <p className="mt-3 rounded-xl border border-slate-700 bg-slate-800/50 px-4 py-2 text-sm text-slate-400">
            Solo el administrador puede cambiar esta configuración.
          </p>
        )}
      </header>

      <fieldset disabled={!canEdit || saving} className="m-0 min-w-0 space-y-8 border-0 p-0">
        <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="text-xl font-semibold text-white">Canales de venta</h2>
          <p className="mt-1 text-sm text-slate-400">Activa únicamente los canales que realmente utilizas.</p>
          <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
            {SALES_CHANNEL_OPTIONS.map((option) => {
              const active = draft.salesChannels.includes(option.value);
              return (
                <button
                  key={option.value}
                  type="button"
                  aria-pressed={active}
                  onClick={() => dispatch({ type: "toggleChannel", channel: option.value })}
                  className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition disabled:opacity-60 ${
                    active ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-slate-700 text-slate-400 hover:border-slate-600"
                  }`}
                >
                  <span aria-hidden="true">{option.emoji}</span>
                  <span className="flex-1">{option.label}</span>
                  {active && <Check size={16} className="text-cyan-300" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="text-xl font-semibold text-white">Forma de atención</h2>
          <p className="mt-1 text-sm text-slate-400">Mesas y meseros son independientes.</p>
          <div className="mt-5 space-y-3">
            <ToggleRow
              icon="🪑"
              label="Usa mesas"
              description="El cliente puede ocupar una mesa y pedir desde allí."
              checked={draft.hasTables}
              onChange={(value) => dispatch({ type: "setFlag", key: "hasTables", value })}
            />
            <ToggleRow
              icon="👥"
              label="Usa meseros"
              description="Hay personas que toman pedidos o atienden clientes. Funciona con o sin mesas."
              checked={draft.hasWaiters}
              onChange={(value) => dispatch({ type: "setFlag", key: "hasWaiters", value })}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="text-xl font-semibold text-white">Preparación</h2>
          <div className="mt-5 space-y-3">
            <ToggleRow
              icon="👨‍🍳"
              label="Prepara productos"
              description="Tienes cocina, barra o una estación de producción."
              checked={draft.hasKitchen}
              onChange={(value) => dispatch({ type: "setFlag", key: "hasKitchen", value })}
            />
            {draft.hasKitchen && (
              <div className="grid gap-3 border-t border-slate-700 pt-4 sm:grid-cols-2">
                <ToggleRow
                  icon="📺"
                  label="Pantalla / KDS"
                  description="Los pedidos aparecen en una pantalla de producción."
                  checked={draft.kdsEnabled}
                  onChange={(value) => dispatch({ type: "setFlag", key: "kdsEnabled", value })}
                />
                <ToggleRow
                  icon="🖨️"
                  label="Impresora"
                  description="Los pedidos salen en una impresora de comandas."
                  checked={draft.printerEnabled}
                  onChange={(value) => dispatch({ type: "setFlag", key: "printerEnabled", value })}
                />
              </div>
            )}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
          <h2 className="text-xl font-semibold text-white">Inventario y clientes</h2>
          <div className="mt-5 space-y-3">
            <ToggleRow
              icon="📦"
              label="Maneja inventario"
              description="Controla ingredientes, productos terminados o ambos."
              checked={draft.hasInventory}
              onChange={(value) => dispatch({ type: "setFlag", key: "hasInventory", value })}
            />
            {draft.hasInventory && (
              <div className="space-y-5 border-t border-slate-700 pt-4">
                <ChoiceGroup
                  title="¿Qué manejas?"
                  value={draft.inventoryType}
                  options={INVENTORY_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  onChange={(value) => dispatch({ type: "setInventoryType", value })}
                />
                <ChoiceGroup
                  title="¿Cómo produces?"
                  value={draft.productionMode}
                  options={PRODUCTION_MODE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
                  onChange={(value) => dispatch({ type: "setProductionMode", value })}
                />
              </div>
            )}
            <ToggleRow
              icon="👤"
              label="Gestiona clientes"
              description="Guarda clientes, historial y relación de compras."
              checked={draft.useCustomers}
              onChange={(value) => dispatch({ type: "setFlag", key: "useCustomers", value })}
            />
          </div>
        </section>

        <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
          <div className="flex items-center gap-3">
            <Sliders size={20} className="text-purple-400" aria-hidden="true" />
            <div>
              <h2 className="text-xl font-semibold text-white">Reglas de venta</h2>
              <p className="text-sm text-slate-400">Cómo se comporta Caja al vender y al imprimir.</p>
            </div>
          </div>
          <div className="mt-5 space-y-3">
            <ToggleRow
              icon="🧾"
              label="Imprimir el recibo automáticamente"
              description="Al cobrar una venta se abre solo la ventana para imprimir el ticket."
              checked={draft.salesRules.autoPrintReceipt}
              onChange={(value) => dispatch({ type: "setSalesRule", key: "autoPrintReceipt", value })}
            />
            <ToggleRow
              icon="✨"
              label="Recomendaciones con IA"
              description="Muestra sugerencias en el Dashboard y en Inventario."
              checked={draft.salesRules.enableAI}
              onChange={(value) => dispatch({ type: "setSalesRule", key: "enableAI", value })}
            />
          </div>
        </section>
      </fieldset>

      {(errors.length > 0 || warnings.length > 0) && (
        <ul className="space-y-2" aria-live="polite">
          {[...errors, ...warnings].map((issue) => (
            <li
              key={issue.code}
              className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
                issue.severity === "error"
                  ? "border-red-500/30 bg-red-500/10 text-red-200"
                  : "border-amber-500/30 bg-amber-500/10 text-amber-200"
              }`}
            >
              <AlertTriangle size={16} className="mt-0.5 flex-shrink-0" aria-hidden="true" />
              <span>{issue.message}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-slate-500" aria-live="polite">
          {saving ? "Guardando…" : dirty ? "Tienes cambios sin guardar." : "Todo guardado."}
        </p>
        <div className="flex flex-wrap gap-2 sm:justify-end">
          {dirty && !saving && (
            <VimdyButton variant="ghost" icon={<RotateCcw size={16} />} onClick={discard}>
              Descartar cambios
            </VimdyButton>
          )}
          <VimdyButton
            variant="primary"
            icon={<Check size={18} />}
            loading={saving}
            disabled={!canSave || !canEdit}
            onClick={() => void handleSave()}
          >
            Guardar configuración
          </VimdyButton>
        </div>
      </div>

      <SectionCard
        icon={<Building2 size={18} className="text-cyan-400" />}
        title="Sucursales"
        description="Se guardan al instante, sin usar el botón de arriba."
      >
        <BranchManager />
      </SectionCard>
    </div>
  );
}

function ToggleRow(props: {
  icon: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={props.checked}
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-4 text-left transition hover:border-slate-600 disabled:opacity-60"
    >
      <span className="text-xl" aria-hidden="true">{props.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-white">{props.label}</span>
        {props.description && <span className="mt-1 block text-xs leading-5 text-slate-500">{props.description}</span>}
      </span>
      <span className={`h-6 w-10 rounded-full p-1 transition ${props.checked ? "bg-cyan-300" : "bg-slate-700"}`} aria-hidden="true">
        <span className={`block h-4 w-4 rounded-full bg-white transition-transform ${props.checked ? "translate-x-4" : "translate-x-0"}`} />
      </span>
    </button>
  );
}

function ChoiceGroup<T extends string>({
  title,
  value,
  options,
  onChange,
}: {
  title: string;
  value: T | null;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={title}>
      <p className="mb-2 text-sm font-medium text-slate-300">{title}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            aria-pressed={value === option.value}
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-3 text-left text-sm transition disabled:opacity-60 ${
              value === option.value ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-slate-700 text-slate-400 hover:border-slate-600"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}