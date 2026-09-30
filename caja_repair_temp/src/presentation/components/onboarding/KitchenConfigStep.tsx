import React from "react";
import { Monitor, Printer, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";

interface Props {
  hasKitchen: boolean | null;
  value: "kds" | "printer" | "ambos" | null;
  onChange: (value: "kds" | "printer" | "ambos" | null) => void;
}

const OPTIONS = [
  {
    id: "kds" as const,
    Icon: Monitor,
    label: "Pantalla KDS",
    description: "Los pedidos se muestran en pantalla"
  },
  {
    id: "printer" as const,
    Icon: Printer,
    label: "Impresora",
    description: "Próximamente"
  },
  {
    id: "ambos" as const,
    Icon: Monitor,
    label: "Ambos",
    description: "Pantalla KDS + impresora"
  }
];

export function KitchenConfigStep({ hasKitchen, value, onChange }: Props) {
  if (hasKitchen !== true) return null;

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 6 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Cómo reciben los pedidos?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Selecciona cómo tu equipo recibe los pedidos en cocina.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {OPTIONS.map(option => {
          const isSelected = value === option.id;
          const isDisabled = option.id === "printer";
          const Icon = option.Icon;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => !isDisabled && onChange(option.id)}
              disabled={isDisabled}
              className={`
                group relative flex flex-col items-center justify-center gap-3 rounded-vimdy-lg border-2 px-5 py-6
                transition-all duration-200 text-center
                disabled:cursor-not-allowed
                ${
                  isDisabled
                    ? "border-vimdy-border-subtle bg-vimdy-surface/60 text-vimdy-text-tertiary"
                    : isSelected
                      ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                      : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                }
              `}
            >
              {isSelected && !isDisabled && (
                <span className="absolute top-2.5 right-2.5 text-vimdy-accent">
                  <CheckCircle2 size={18} />
                </span>
              )}

              <div className={`
                w-12 h-12 rounded-vimdy-md flex items-center justify-center transition-colors
                ${isDisabled ? "bg-vimdy-background text-vimdy-text-muted" : isSelected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Icon size={24} strokeWidth={1.8} />
              </div>

              <div className="flex flex-col gap-1">
                <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : isDisabled ? "text-vimdy-text-tertiary" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                  {option.label}
                </span>
                <span className="text-xs text-vimdy-text-muted">
                  {isDisabled ? "Próximamente" : option.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      <div className="flex justify-center mt-8">
        <VimdyButton variant="ghost" onClick={() => onChange(null)}>
          Configurar después
        </VimdyButton>
      </div>
    </div>
  );
}