import React, { useState, useEffect } from "react";
import { container } from "../../../infrastructure/di/CompositionRoot";
import { useAuth } from "../../context/AuthContext";
import { useOperationConfig } from "../../../core/store/useOperationConfig";
import { useEnabledModules } from "../../../core/store/useEnabledModules";
import { enabledModulesStore } from "../../../core/store/enabledModulesStore";
import { operationConfigStore } from "../../../core/store/operationConfigStore";
import { setEnabledModules, setOperationConfig } from "../../../infrastructure/supabase/authBusinessContext";
import {
  SALES_CHANNEL_OPTIONS,
  INVENTORY_TYPE_OPTIONS,
  PRODUCTION_MODE_OPTIONS,
  type SalesChannel,
  type InventoryType,
  type ProductionMode
} from "../../../core/config/operation";

/**
 * OperationSettings — Configuración → Operación del negocio.
 * Permite al dueño cambiar la operación posteriormente.
 */
export function OperationSettings() {
  const { businessId } = useAuth();
  const operationConfig = useOperationConfig();
  const enabledModules = useEnabledModules();

  const [salesChannels, setSalesChannels] = useState<SalesChannel[]>([]);
  const [inventoryType, setInventoryType] = useState<InventoryType | null>(null);
  const [productionMode, setProductionMode] = useState<ProductionMode | null>(null);
  const [kdsEnabled, setKdsEnabled] = useState(false);
  const [printerEnabled, setPrinterEnabled] = useState(false);
  const [hasTables, setHasTables] = useState(false);
  const [hasStaff, setHasStaff] = useState(false);
  const [hasKitchen, setHasKitchen] = useState(false);
  const [hasInventory, setHasInventory] = useState(false);
  const [useCustomers, setUseCustomers] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Sincronizar estado local con stores
  useEffect(() => {
    if (operationConfig) {
      setSalesChannels(operationConfig.salesChannels);
      setInventoryType(operationConfig.inventoryType);
      setProductionMode(operationConfig.productionMode);
      setKdsEnabled(operationConfig.kdsEnabled);
      setPrinterEnabled(operationConfig.printerEnabled);
    }
    if (enabledModules) {
      setHasTables(enabledModules.includes("mesas"));
      setHasStaff(enabledModules.includes("mesas"));
      setHasKitchen(enabledModules.includes("cocina"));
      setHasInventory(enabledModules.includes("inventario"));
      setUseCustomers(enabledModules.includes("clientes"));
    }
  }, [operationConfig, enabledModules]);

  async function handleSave() {
    if (!businessId) return;
    setSaving(true);
    setSaved(false);

    try {
      // Calcular módulos basado en toggles
      const modules: string[] = ['caja', 'pedidos'];
      if (hasTables) modules.push('mesas');
      if (hasKitchen) modules.push('cocina');
      if (hasInventory) modules.push('inventario');
      if (useCustomers) modules.push('clientes');

      // Guardar módulos (cast a ModuleId[] para el tipo)
      const moduleIds = modules as import("../../../core/config/modules").ModuleId[];
      await setEnabledModules(businessId, moduleIds);
      enabledModulesStore.set(moduleIds);

      // Guardar operación
      const config = {
        salesChannels,
        inventoryType: hasInventory ? inventoryType : null,
        productionMode: hasInventory ? productionMode : null,
        kdsEnabled: hasKitchen ? kdsEnabled : false,
        printerEnabled: hasKitchen ? printerEnabled : false
      };
      await setOperationConfig(businessId, config);
      operationConfigStore.set(config);

      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (err) {
      console.error("Error guardando configuración:", err);
    } finally {
      setSaving(false);
    }
  }

  function toggleSalesChannel(channel: SalesChannel) {
    if (salesChannels.includes(channel)) {
      setSalesChannels(sc => sc.filter(c => c !== channel));
    } else {
      setSalesChannels(sc => [...sc, channel]);
    }
  }

  return (
    <div className="max-w-2xl mx-auto space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-white mb-2">Operación del negocio</h1>
        <p className="text-slate-400">
          Configura cómo funciona tu negocio. Los cambios se aplican inmediatamente.
        </p>
      </div>

      {/* Canales de venta */}
      <section className="p-6 rounded-2xl border border-slate-700 bg-slate-800/50">
        <h2 className="text-xl font-semibold text-white mb-4">Canales de venta</h2>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          {SALES_CHANNEL_OPTIONS.map(option => (
            <button
              key={option.value}
              onClick={() => toggleSalesChannel(option.value)}
              className={`
                flex items-center gap-2 p-3 rounded-xl border transition
                ${salesChannels.includes(option.value)
                  ? "border-cyan-500 bg-cyan-500/10 text-white"
                  : "border-slate-700 text-slate-400 hover:border-slate-600"
                }
              `}
            >
              <span>{option.emoji}</span>
              <span className="text-sm">{option.label}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Forma de operación */}
      <section className="p-6 rounded-2xl border border-slate-700 bg-slate-800/50">
        <h2 className="text-xl font-semibold text-white mb-4">Forma de operación</h2>
        <div className="space-y-3">
          <ToggleRow
            icon="🪑"
            label="Usa mesas"
            description="Atiende clientes en mesas"
            checked={hasTables}
            onChange={setHasTables}
          />
          <ToggleRow
            icon="👥"
            label="Usa personal"
            description="Tienes empleados que atienden u operan"
            checked={hasStaff}
            onChange={setHasStaff}
          />
          <ToggleRow
            icon="👨‍🍳"
            label="Prepara productos"
            description="Tienes cocina o preparas pedidos"
            checked={hasKitchen}
            onChange={setHasKitchen}
          />
          <ToggleRow
            icon="📦"
            label="Maneja inventario"
            description="Controlas ingredientes o productos"
            checked={hasInventory}
            onChange={setHasInventory}
          />
          <ToggleRow
            icon="👤"
            label="Gestiona clientes"
            description="Llevas registro de clientes"
            checked={useCustomers}
            onChange={setUseCustomers}
          />
        </div>
      </section>

      {/* Configuración de cocina */}
      {hasKitchen && (
        <section className="p-6 rounded-2xl border border-slate-700 bg-slate-800/50">
          <h2 className="text-xl font-semibold text-white mb-4">Cocina</h2>
          <p className="text-slate-400 text-sm mb-4">¿Cómo reciben los pedidos?</p>
          <div className="flex gap-3">
            <ToggleRow
              icon="📺"
              label="KDS / Pantalla"
              checked={kdsEnabled}
              onChange={setKdsEnabled}
            />
            <ToggleRow
              icon="🖨️"
              label="Impresora"
              description="Próximamente"
              checked={printerEnabled}
              onChange={setPrinterEnabled}
              disabled={true}
            />
          </div>
        </section>
      )}

      {/* Configuración de inventario */}
      {hasInventory && (
        <section className="p-6 rounded-2xl border border-slate-700 bg-slate-800/50">
          <h2 className="text-xl font-semibold text-white mb-4">Inventario</h2>
          <div className="space-y-4">
            <div>
              <p className="text-slate-400 text-sm mb-2">¿Qué manejas?</p>
              <div className="grid grid-cols-3 gap-2">
                {INVENTORY_TYPE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setInventoryType(option.value)}
                    className={`
                      p-3 rounded-xl border text-left transition
                      ${inventoryType === option.value
                        ? "border-cyan-500 bg-cyan-500/10 text-white"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                      }
                    `}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <p className="text-slate-400 text-sm mb-2">¿Cómo produces?</p>
              <div className="grid grid-cols-3 gap-2">
                {PRODUCTION_MODE_OPTIONS.map(option => (
                  <button
                    key={option.value}
                    onClick={() => setProductionMode(option.value)}
                    className={`
                      p-3 rounded-xl border text-left transition
                      ${productionMode === option.value
                        ? "border-cyan-500 bg-cyan-500/10 text-white"
                        : "border-slate-700 text-slate-400 hover:border-slate-600"
                      }
                    `}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {/* Botón guardar */}
      <div className="flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={saving}
          className="px-8 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 transition disabled:opacity-50"
        >
          {saving ? "Guardando..." : "Guardar cambios"}
        </button>
        {saved && (
          <span className="text-emerald-400 text-sm">✓ Guardado correctamente</span>
        )}
      </div>
    </div>
  );
}

interface ToggleRowProps {
  icon: string;
  label: string;
  description?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}

function ToggleRow({ icon, label, description, checked, onChange, disabled }: ToggleRowProps) {
  return (
    <button
      onClick={() => !disabled && onChange(!checked)}
      disabled={disabled}
      className={`
        w-full flex items-center gap-3 p-3 rounded-xl border transition text-left
        ${disabled
          ? "border-slate-700/50 bg-slate-800/30 opacity-50 cursor-not-allowed"
          : checked
            ? "border-cyan-500 bg-cyan-500/10"
            : "border-slate-700 hover:border-slate-600"
        }
      `}
    >
      <span className="text-xl">{icon}</span>
      <div className="flex-1">
        <div className={`text-sm font-medium ${checked ? "text-white" : "text-slate-300"}`}>
          {label}
        </div>
        {description && (
          <div className="text-xs text-slate-500">{description}</div>
        )}
      </div>
      <div className={`
        w-10 h-6 rounded-full transition relative
        ${checked ? "bg-cyan-500" : "bg-slate-600"}
      `}>
        <div className={`
          w-4 h-4 rounded-full bg-white absolute top-1 transition
          ${checked ? "right-1" : "left-1"}
        `} />
      </div>
    </button>
  );
}
