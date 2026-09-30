import React from "react";
import { OperationConfig, OnboardingAnswers, calculateModulesFromAnswers, calculateOperationConfigFromAnswers, SALES_CHANNEL_LABELS } from "../../../core/config/operation";
import { MODULE_CATALOG } from "../../../core/config/modules";

interface Props {
  answers: OnboardingAnswers;
  onEdit: (step: string) => void;
  onConfirm: (modules: string[], config: OperationConfig) => void;
}

/**
 * SummaryStep — Pantalla final del onboarding: "Así funcionará VIMDY en tu negocio"
 * Muestra un resumen editable antes de confirmar.
 */
export function SummaryStep({ answers, onEdit, onConfirm }: Props) {
  const modules = calculateModulesFromAnswers(answers);
  const config = calculateOperationConfigFromAnswers(answers);

  const allModules = MODULE_CATALOG.filter(m => m.id !== "pedidos" && m.id !== "ia");

  const activeModules = allModules.filter(m => modules.includes(m.id));
  const inactiveModules = allModules.filter(m => !modules.includes(m.id));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">
          Así funcionará VIMDY en tu negocio
        </h2>
        <p className="text-slate-400">
          Revisa la configuración antes de confirmar. Puedes editar cualquier sección.
        </p>
      </div>

      {/* Canales de venta */}
      <div className="p-4 rounded-xl border border-slate-700 bg-slate-800/50">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-white font-semibold">Canales de venta</h3>
          <button
            onClick={() => onEdit("sales_channels")}
            className="text-xs text-cyan-400 hover:text-cyan-300"
          >
            Editar
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {config.salesChannels.length > 0 ? (
            config.salesChannels.map(ch => (
              <span key={ch} className="px-3 py-1 rounded-full bg-slate-700 text-sm text-slate-300">
                {SALES_CHANNEL_LABELS[ch]}
              </span>
            ))
          ) : (
            <span className="text-slate-500 text-sm">Pendiente de configurar</span>
          )}
        </div>
      </div>

      {/* Módulos activados */}
      <div className="p-4 rounded-xl border border-emerald-500/30 bg-emerald-500/5">
        <h3 className="text-emerald-400 font-semibold mb-3">✓ Activado</h3>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {activeModules.map(mod => (
            <div key={mod.id} className="flex items-center gap-2 text-white">
              <span>{mod.emoji}</span>
              <span className="text-sm">{mod.label}</span>
            </div>
          ))}
          {/* Caja siempre activo */}
          <div className="flex items-center gap-2 text-white">
            <span>💵</span>
            <span className="text-sm">Caja</span>
          </div>
          <div className="flex items-center gap-2 text-white">
            <span>🧾</span>
            <span className="text-sm">Pedidos</span>
          </div>
        </div>
      </div>

      {/* Módulos desactivados */}
      {inactiveModules.length > 0 && (
        <div className="p-4 rounded-xl border border-slate-700 bg-slate-800/50">
          <h3 className="text-slate-400 font-semibold mb-3">○ Desactivado</h3>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {inactiveModules.map(mod => (
              <div key={mod.id} className="flex items-center gap-2 text-slate-500">
                <span>{mod.emoji}</span>
                <span className="text-sm line-through">{mod.label}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Configuración de cocina */}
      {answers.hasKitchen === true && (
        <div className="p-4 rounded-xl border border-slate-700 bg-slate-800/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Cocina</h3>
            <button
              onClick={() => onEdit("kitchen_config")}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              Editar
            </button>
          </div>
          <div className="flex gap-2">
            {config.kdsEnabled && (
              <span className="px-3 py-1 rounded-full bg-slate-700 text-sm text-slate-300">
                📺 KDS
              </span>
            )}
            {config.printerEnabled && (
              <span className="px-3 py-1 rounded-full bg-slate-700 text-sm text-slate-300">
                🖨️ Impresora
              </span>
            )}
            {!config.kdsEnabled && !config.printerEnabled && (
              <span className="text-slate-500 text-sm">Pendiente de configurar</span>
            )}
          </div>
        </div>
      )}

      {/* Configuración de inventario */}
      {answers.hasInventory === true && (
        <div className="p-4 rounded-xl border border-slate-700 bg-slate-800/50">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-white font-semibold">Inventario</h3>
            <button
              onClick={() => onEdit("inventory_config")}
              className="text-xs text-cyan-400 hover:text-cyan-300"
            >
              Editar
            </button>
          </div>
          <div className="flex flex-wrap gap-2">
            {config.inventoryType && (
              <span className="px-3 py-1 rounded-full bg-slate-700 text-sm text-slate-300">
                📦 {config.inventoryType}
              </span>
            )}
            {config.productionMode && (
              <span className="px-3 py-1 rounded-full bg-slate-700 text-sm text-slate-300">
                ⚙️ {config.productionMode === "on_demand" ? "Bajo pedido" : config.productionMode === "batch" ? "Por lotes" : "Ambos"}
              </span>
            )}
            {!config.inventoryType && !config.productionMode && (
              <span className="text-slate-500 text-sm">Pendiente de configurar</span>
            )}
          </div>
        </div>
      )}

      {/* Botones de acción */}
      <div className="flex gap-3 pt-4">
        <button
          type="button"
          onClick={() => onEdit("operation_type")}
          className="flex-1 px-6 py-3 rounded-xl border border-slate-600 text-slate-300 font-medium hover:bg-slate-800 transition"
        >
          ← Editar configuración
        </button>
        <button
          type="button"
          onClick={() => onConfirm(modules, config)}
          className="flex-1 px-6 py-3 rounded-xl bg-cyan-500 text-slate-950 font-bold hover:bg-cyan-400 transition"
        >
          ✓ Confirmar
        </button>
      </div>
    </div>
  );
}
