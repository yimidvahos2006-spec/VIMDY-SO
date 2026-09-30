import { useEffect, useMemo, useState } from "react";
import { Check, Loader2 } from "lucide-react";

import { useAuth } from "../../context/AuthContext";
import { useOperationConfig } from "../../../core/store/useOperationConfig";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { enabledModulesStore } from "../../../core/store/enabledModulesStore";
import { operationConfigStore } from "../../../core/store/operationConfigStore";
import { kitchenOutputModeStore } from "../../../core/store/kitchenOutputModeStore";
import { setBusinessOperatingProfile } from "../../../infrastructure/supabase/authBusinessContext";
import {
  SALES_CHANNEL_OPTIONS,
  INVENTORY_TYPE_OPTIONS,
  PRODUCTION_MODE_OPTIONS,
  type SalesChannel,
  type InventoryType,
  type ProductionMode,
  type OperationConfig,
  type KitchenOutputModeConfig,
} from "../../../core/config/operation";
import type { ModuleId } from "../../../core/config/modules";

/**
 * Configuración > Operación.
 *
 * Esta pantalla es la fuente explícita de cómo trabaja el negocio. No deduce
 * capacidades por el tipo de negocio y, a propósito, mantiene "Mesas" y
 * "Meseros" separados: un negocio puede tener meseros sin mesas (mostrador,
 * pedidos para llevar, food hall, kiosco asistido, etc.).
 */
export function OperationSettings() {
  const { businessId } = useAuth();
  const operationConfig = useOperationConfig();
  const enabledModules = useEnabledModules();

  const [salesChannels, setSalesChannels] = useState<SalesChannel[]>([]);
  const [inventoryType, setInventoryType] = useState<InventoryType | null>(null);
  const [productionMode, setProductionMode] = useState<ProductionMode | null>(null);
  const [hasTables, setHasTables] = useState(false);
  const [hasWaiters, setHasWaiters] = useState(false);
  const [hasKitchen, setHasKitchen] = useState(false);
  const [kdsEnabled, setKdsEnabled] = useState(false);
  const [printerEnabled, setPrinterEnabled] = useState(false);
  const [hasInventory, setHasInventory] = useState(false);
  const [useCustomers, setUseCustomers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (operationConfig) {
      setSalesChannels(operationConfig.salesChannels);
      setInventoryType(operationConfig.inventoryType);
      setProductionMode(operationConfig.productionMode);
      setHasTables(operationConfig.tablesEnabled ?? enabledModules?.includes("mesas") ?? false);
      setHasWaiters(operationConfig.waiterModeEnabled ?? enabledModules?.includes("meseros") ?? false);
      setHasKitchen(operationConfig.kitchenEnabled ?? enabledModules?.includes("cocina") ?? false);
      setKdsEnabled(operationConfig.kdsEnabled);
      setPrinterEnabled(operationConfig.printerEnabled);
      setHasInventory(enabledModules?.includes("inventario") ?? false);
      setUseCustomers(enabledModules?.includes("clientes") ?? false);
    } else if (enabledModules) {
      setHasTables(enabledModules.includes("mesas"));
      setHasWaiters(enabledModules.includes("meseros"));
      setHasKitchen(enabledModules.includes("cocina"));
      setHasInventory(enabledModules.includes("inventario"));
      setUseCustomers(enabledModules.includes("clientes"));
    }
  }, [operationConfig, enabledModules]);

  const kitchenOutputMode = useMemo<KitchenOutputModeConfig>(() => {
    if (!hasKitchen) return "none";
    if (kdsEnabled && printerEnabled) return "both";
    if (printerEnabled) return "printer";
    if (kdsEnabled) return "kds";
    return "none";
  }, [hasKitchen, kdsEnabled, printerEnabled]);

  async function handleSave() {
    if (!businessId || saving) return;

    setSaving(true);
    setSaved(false);
    setError(null);

    try {
      const modules: ModuleId[] = ["caja", "pedidos"];
      if (hasTables) modules.push("mesas");
      if (hasWaiters) modules.push("meseros");
      if (hasKitchen) modules.push("cocina");
      if (hasInventory) modules.push("inventario");
      if (useCustomers) modules.push("clientes");

      const config: OperationConfig = {
        serviceMode: hasTables ? "both" : "counter",
        tablesEnabled: hasTables,
        waiterModeEnabled: hasWaiters,
        waiterPhotosEnabled: operationConfig?.waiterPhotosEnabled ?? true,
        kitchenEnabled: hasKitchen,
        kitchenOutputMode,
        prepStations: operationConfig?.prepStations ?? [],
        salesChannels,
        inventoryType: hasInventory ? inventoryType : null,
        productionMode: hasInventory ? productionMode : null,
        kdsEnabled: hasKitchen && kdsEnabled,
        printerEnabled: hasKitchen && printerEnabled,
      };

      await setBusinessOperatingProfile(businessId, modules, config);

      enabledModulesStore.set(modules);
      operationConfigStore.set(config);

      kitchenOutputModeStore.set(
        kitchenOutputMode === "printer" ? "impresora" :
        kitchenOutputMode === "both" ? "ambos" :
        kitchenOutputMode === "kds" ? "pantalla" :
        "none"
      );

      setSaved(true);
      window.setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la configuración.");
    } finally {
      setSaving(false);
    }
  }

  function toggleSalesChannel(channel: SalesChannel) {
    setSalesChannels((current) =>
      current.includes(channel)
        ? current.filter((value) => value !== channel)
        : [...current, channel]
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-8 pb-10">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300/80">Configuración</p>
        <h1 className="mt-2 text-3xl font-bold text-white">Cómo trabaja tu negocio</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">
          VIMDY adapta Caja, Meseros, Mesas, Cocina e Inventario a estas decisiones. Puedes cambiarlas cuando cambie tu operación.
        </p>
      </header>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="text-xl font-semibold text-white">Canales de venta</h2>
        <p className="mt-1 text-sm text-slate-400">Activa únicamente los canales que realmente utilizas.</p>
        <div className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {SALES_CHANNEL_OPTIONS.map((option) => {
            const active = salesChannels.includes(option.value);
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => toggleSalesChannel(option.value)}
                className={`flex items-center gap-2 rounded-xl border px-3 py-3 text-left text-sm transition ${
                  active ? "border-cyan-400/50 bg-cyan-400/10 text-white" : "border-slate-700 text-slate-400 hover:border-slate-600"
                }`}
              >
                <span>{option.emoji}</span>
                <span className="flex-1">{option.label}</span>
                {active && <Check size={16} className="text-cyan-300" />}
              </button>
            );
          })}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="text-xl font-semibold text-white">Forma de atención</h2>
        <p className="mt-1 text-sm text-slate-400">Mesas y meseros son independientes.</p>
        <div className="mt-5 space-y-3">
          <ToggleRow icon="🪑" label="Usa mesas" description="El cliente puede ocupar una mesa y pedir desde allí." checked={hasTables} onChange={setHasTables} />
          <ToggleRow icon="👥" label="Usa meseros" description="Hay personas que toman pedidos o atienden clientes. Funciona con o sin mesas." checked={hasWaiters} onChange={setHasWaiters} />
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="text-xl font-semibold text-white">Preparación</h2>
        <div className="mt-5 space-y-3">
          <ToggleRow icon="👨‍🍳" label="Prepara productos" description="Tienes cocina, barra o una estación de producción." checked={hasKitchen} onChange={(value) => {
            setHasKitchen(value);
            if (!value) { setKdsEnabled(false); setPrinterEnabled(false); }
          }} />
          {hasKitchen && (
            <div className="grid gap-3 border-t border-slate-700 pt-4 sm:grid-cols-2">
              <ToggleRow icon="📺" label="Pantalla / KDS" description="Los pedidos aparecen en una pantalla de producción." checked={kdsEnabled} onChange={setKdsEnabled} />
              <ToggleRow icon="🖨️" label="Impresora" description="Los pedidos salen en una impresora de comandas." checked={printerEnabled} onChange={setPrinterEnabled} />
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-slate-700 bg-slate-800/50 p-6">
        <h2 className="text-xl font-semibold text-white">Inventario y clientes</h2>
        <div className="mt-5 space-y-3">
          <ToggleRow icon="📦" label="Maneja inventario" description="Controla ingredientes, productos terminados o ambos." checked={hasInventory} onChange={(value) => {
            setHasInventory(value);
            if (!value) { setInventoryType(null); setProductionMode(null); }
          }} />
          {hasInventory && (
            <div className="space-y-5 border-t border-slate-700 pt-4">
              <ChoiceGroup title="¿Qué manejas?" value={inventoryType} options={INVENTORY_TYPE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={setInventoryType} />
              <ChoiceGroup title="¿Cómo produces?" value={productionMode} options={PRODUCTION_MODE_OPTIONS.map((option) => ({ value: option.value, label: option.label }))} onChange={setProductionMode} />
            </div>
          )}
          <ToggleRow icon="👤" label="Gestiona clientes" description="Guarda clientes, historial y relación de compras." checked={useCustomers} onChange={setUseCustomers} />
        </div>
      </section>

      {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">{error}</div>}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-sm text-slate-500">
          {saved ? "Configuración guardada y aplicada." : "Los cambios se guardan en el negocio activo."}
        </div>
        <button
          type="button"
          disabled={saving || !businessId}
          onClick={handleSave}
          className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-cyan-300 px-6 text-sm font-bold text-slate-950 transition hover:bg-cyan-200 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {saving ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
          {saving ? "Guardando…" : "Guardar configuración"}
        </button>
      </div>
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
      onClick={() => props.onChange(!props.checked)}
      className="flex w-full items-center gap-4 rounded-xl border border-slate-700 bg-slate-900/30 px-4 py-4 text-left transition hover:border-slate-600"
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
    <div>
      <p className="mb-2 text-sm font-medium text-slate-300">{title}</p>
      <div className="grid gap-2 sm:grid-cols-3">
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            className={`rounded-xl border px-3 py-3 text-left text-sm transition ${
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
