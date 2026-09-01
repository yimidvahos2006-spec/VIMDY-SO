import React from "react";
import { SalesChannel, SALES_CHANNEL_OPTIONS } from "../../../core/config/operation";

interface Props {
  value: SalesChannel[];
  onChange: (channels: SalesChannel[]) => void;
}

/**
 * SalesChannelsStep — Paso del onboarding: "¿Cómo vendes?"
 * Selección múltiple de canales de venta.
 * Mesas NO es un canal de venta (es forma de operación).
 */
export function SalesChannelsStep({ value, onChange }: Props) {
  function toggle(channel: SalesChannel) {
    if (value.includes(channel)) {
      onChange(value.filter(c => c !== channel));
    } else {
      onChange([...value, channel]);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-bold text-white mb-2">¿Cómo vendes?</h2>
        <p className="text-slate-400">
          Selecciona todos los canales que uses. Puedes cambiarlos después.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SALES_CHANNEL_OPTIONS.map(option => {
          const isSelected = value.includes(option.value);
          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={`
                flex items-center gap-3 p-4 rounded-xl border transition-all text-left
                ${isSelected
                  ? "border-cyan-500 bg-cyan-500/10 text-white"
                  : "border-slate-700 bg-slate-800/50 text-slate-300 hover:border-slate-600"
                }
              `}
            >
              <span className="text-2xl">{option.emoji}</span>
              <span className="font-medium">{option.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
