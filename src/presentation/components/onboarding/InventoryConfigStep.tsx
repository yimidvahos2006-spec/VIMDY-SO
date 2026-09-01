import React from "react";
import { InventoryType, INVENTORY_TYPE_OPTIONS, ProductionMode, PRODUCTION_MODE_OPTIONS } from "../../../core/config/operation";

interface Props {
  hasInventory: boolean | null;
  inventoryType: InventoryType | null;
  productionMode: ProductionMode | null;
  onInventoryTypeChange: (value: InventoryType | null) => void;
  onProductionModeChange: (value: ProductionMode | null) => void;
}

/**
 * InventoryConfigStep — Paso condicional: "¿Qué manejas?"
 * Solo aparece si el negocio tiene inventario.
 */
export function InventoryConfigStep({
  hasInventory,
  inventoryType,
  productionMode,
  onInventoryTypeChange,
  onProductionModeChange
}: Props) {
  if (hasInventory !== true) return null;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">¿Qué manejas en inventario?</h2>
        <p className="text-slate-400">
          Selecciona qué tipo de inventario controlas.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {INVENTORY_TYPE_OPTIONS.map(option => {
          const isSelected = inventoryType === option.value;
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => onInventoryTypeChange(option.value)}
              className={`
                flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left
                ${isSelected
                  ? "border-cyan-500 bg-cyan-500/10 text-white"
                  : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600"
                }
              `}
            >
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-slate-400">{option.description}</span>
            </button>
          );
        })}
      </div>

      <div>
        <h3 className="text-lg font-semibold text-white mb-3">¿Cómo produces?</h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {PRODUCTION_MODE_OPTIONS.map(option => {
            const isSelected = productionMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onProductionModeChange(option.value)}
                className={`
                  flex flex-col items-start gap-1 p-4 rounded-xl border transition-all text-left
                  ${isSelected
                    ? "border-cyan-500 bg-cyan-500/10 text-white"
                    : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600"
                  }
                `}
              >
                <span className="font-medium">{option.label}</span>
                <span className="text-xs text-slate-400">{option.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      <button
        type="button"
        onClick={() => {
          onInventoryTypeChange(null);
          onProductionModeChange(null);
        }}
        className="text-sm text-slate-400 hover:text-slate-300 transition"
      >
        Configurar después
      </button>
    </div>
  );
}
