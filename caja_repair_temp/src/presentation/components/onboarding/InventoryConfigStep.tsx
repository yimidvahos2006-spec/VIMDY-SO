import React from "react";
import { CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { InventoryType, INVENTORY_TYPE_OPTIONS, ProductionMode, PRODUCTION_MODE_OPTIONS } from "../../../core/config/operation";

interface Props {
  hasInventory: boolean | null;
  inventoryType: InventoryType | null;
  productionMode: ProductionMode | null;
  onInventoryTypeChange: (value: InventoryType | null) => void;
  onProductionModeChange: (value: ProductionMode | null) => void;
}

export function InventoryConfigStep({
  hasInventory,
  inventoryType,
  productionMode,
  onInventoryTypeChange,
  onProductionModeChange
}: Props) {
  if (hasInventory !== true) return null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 7 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Qué manejas en inventario?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Selecciona qué tipo de inventario controlas.
        </p>
      </div>

      <VimdyCard padding="lg" className="w-full">
        <div className="mb-8">
          <h3 className="text-vimdy-h3 text-vimdy-text mb-4">Tipo de inventario</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {INVENTORY_TYPE_OPTIONS.map(option => {
              const isSelected = inventoryType === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onInventoryTypeChange(option.value)}
                  className={`
                    group relative flex flex-col items-start gap-2 rounded-vimdy-lg border-2 px-5 py-4
                    transition-all duration-200 text-left
                    ${
                      isSelected
                        ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                        : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                    }
                  `}
                >
                  {isSelected && (
                    <span className="absolute top-3 right-3 text-vimdy-accent">
                      <CheckCircle2 size={18} />
                    </span>
                  )}

                  <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                    {option.label}
                  </span>
                  <span className="text-xs text-vimdy-text-muted">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="mb-8">
          <h3 className="text-vimdy-h3 text-vimdy-text mb-4">¿Cómo produces?</h3>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {PRODUCTION_MODE_OPTIONS.map(option => {
              const isSelected = productionMode === option.value;

              return (
                <button
                  key={option.value}
                  type="button"
                  onClick={() => onProductionModeChange(option.value)}
                  className={`
                    group relative flex flex-col items-start gap-2 rounded-vimdy-lg border-2 px-5 py-4
                    transition-all duration-200 text-left
                    ${
                      isSelected
                        ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                        : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                    }
                  `}
                >
                  {isSelected && (
                    <span className="absolute top-3 right-3 text-vimdy-accent">
                      <CheckCircle2 size={18} />
                    </span>
                  )}

                  <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                    {option.label}
                  </span>
                  <span className="text-xs text-vimdy-text-muted">
                    {option.description}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex justify-center">
          <VimdyButton variant="ghost" onClick={() => {
            onInventoryTypeChange(null);
            onProductionModeChange(null);
          }}>
            Configurar después
          </VimdyButton>
        </div>
      </VimdyCard>
    </div>
  );
}