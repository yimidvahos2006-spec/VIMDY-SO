import { useState } from "react";
import { Monitor, Printer, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";
import { setKitchenOutputMode } from "../../../infrastructure/supabase/authBusinessContext";
import type { KitchenOutputMode } from "../../../core/services/kitchenOutput";

interface CocinaConfigStepProps {
  businessId: string;
  onSaved: (mode: KitchenOutputMode) => void;
}

const OPTIONS: { id: KitchenOutputMode; label: string; description: string; Icon: React.ElementType }[] = [
  { id: "pantalla", label: "Pantalla / TV", description: "Kitchen Display System", Icon: Monitor },
  { id: "impresora", label: "Impresora", description: "Ticket térmico", Icon: Printer }
];

export function CocinaConfigStep({ businessId, onSaved }: CocinaConfigStepProps) {
  const [selected, setSelected] = useState<KitchenOutputMode | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSelect(mode: KitchenOutputMode) {
    if (saving) return;
    setSelected(mode);
    setSaving(true);
    setError(null);

    try {
      await setKitchenOutputMode(businessId, mode);
      onSaved(mode);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar la configuración.";
      setError(message);
      setSelected(null);
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 6 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Cómo ves las comandas?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Elige cómo quieres que cocina reciba los pedidos
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {OPTIONS.map(option => {
          const isSelected = selected === option.id;
          const Icon = option.Icon;

          return (
            <button
              key={option.id}
              type="button"
              onClick={() => handleSelect(option.id)}
              disabled={saving}
              className={`
                group relative flex flex-col items-center justify-center gap-4 rounded-vimdy-lg border-2 px-6 py-8
                transition-all duration-200 text-center
                disabled:cursor-not-allowed
                ${
                  isSelected
                    ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                    : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
                }
                ${saving && selected !== option.id ? "opacity-40" : ""}
              `}
            >
              {isSelected && (
                <span className="absolute top-3 right-3 text-vimdy-accent">
                  <CheckCircle2 size={18} />
                </span>
              )}

              <div className={`
                w-14 h-14 rounded-vimdy-md flex items-center justify-center transition-colors
                ${isSelected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Icon size={28} strokeWidth={1.8} />
              </div>

              <div className="flex flex-col gap-1">
                <span className={`text-base font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                  {option.label}
                </span>
                <span className="text-xs text-vimdy-text-muted">
                  {option.description}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {saving && !error && (
        <p className="text-center text-sm text-vimdy-text-secondary mt-6 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Guardando configuración...
        </p>
      )}

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}