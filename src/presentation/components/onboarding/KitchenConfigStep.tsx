import React from "react";

interface Props {
  hasKitchen: boolean | null;
  value: "kds" | "printer" | "ambos" | null;
  onChange: (value: "kds" | "printer" | "ambos" | null) => void;
}

/**
 * KitchenConfigStep — Paso condicional: "¿Cómo reciben los pedidos?"
 * Solo aparece si el negocio tiene cocina.
 * KDS e impresora pueden coexistir.
 */
export function KitchenConfigStep({ hasKitchen, value, onChange }: Props) {
  if (hasKitchen !== true) return null;

  const options = [
    {
      id: "kds" as const,
      icon: "📺",
      label: "Pantalla KDS",
      description: "Los pedidos se muestran en pantalla"
    },
    {
      id: "printer" as const,
      icon: "🖨️",
      label: "Impresora",
      description: "Próximamente"
    },
    {
      id: "ambos" as const,
      icon: "📺🖨️",
      label: "Ambos",
      description: "Pantalla KDS + impresora"
    }
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">¿Cómo reciben los pedidos?</h2>
        <p className="text-slate-400">
          Selecciona cómo tu equipo recibe los pedidos en cocina.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {options.map(option => {
          const isSelected = value === option.id;
          const isDisabled = option.id === "printer";
          return (
            <button
              key={option.id}
              type="button"
              onClick={() => !isDisabled && onChange(option.id)}
              disabled={isDisabled}
              className={`
                flex flex-col items-center gap-2 p-4 rounded-xl border transition-all text-center
                ${isDisabled
                  ? "border-slate-700 bg-slate-800/30 text-slate-500 cursor-not-allowed"
                  : isSelected
                    ? "border-cyan-500 bg-cyan-500/10 text-white"
                    : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600"
                }
              `}
            >
              <span className="text-3xl">{option.icon}</span>
              <span className="font-medium">{option.label}</span>
              <span className="text-xs text-slate-400">
                {isDisabled ? "Próximamente" : option.description}
              </span>
            </button>
          );
        })}
      </div>

      <button
        type="button"
        onClick={() => onChange(null)}
        className="text-sm text-slate-400 hover:text-slate-300 transition"
      >
        Configurar después
      </button>
    </div>
  );
}
