import { useState } from "react";
import { Users, UserCheck, Loader2, CheckCircle2 } from "lucide-react";

import { VimdyCard } from "../ui/VimdyCard";
import { VimdyButton } from "../ui/VimdyButton";

interface MeserosConfigStepProps {
  onSaved: (hasWaiters: boolean) => void;
}

export function MeserosConfigStep({ onSaved }: MeserosConfigStepProps) {
  const [selected, setSelected] = useState<boolean | null>(null);
  const [saving, setSaving] = useState(false);

  function handleSelect(hasWaiters: boolean) {
    if (saving) return;
    setSelected(hasWaiters);
    setSaving(true);

    try {
      onSaved(hasWaiters);
    } catch {
      setSelected(null);
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 5 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Tienes meseros?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          ¿Hay personal que toma pedidos y atiende las mesas, o los clientes se sientan solos?
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <button
          type="button"
          onClick={() => handleSelect(true)}
          disabled={saving}
          className={`
            group relative flex flex-col items-center justify-center gap-4 rounded-vimdy-lg border-2 px-6 py-8
            transition-all duration-200 text-center
            disabled:cursor-not-allowed
            ${
              selected === true
                ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
            }
            ${saving && selected !== true ? "opacity-40" : ""}
          `}
        >
          {selected === true && (
            <span className="absolute top-3 right-3 text-vimdy-accent">
              <CheckCircle2 size={18} />
            </span>
          )}

          <div className={`
            w-14 h-14 rounded-vimdy-md flex items-center justify-center transition-colors
            ${selected === true ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
          `}>
            <Users size={28} strokeWidth={1.8} />
          </div>

          <div className="flex flex-col gap-1">
            <span className={`text-base font-semibold ${selected === true ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
              Sí, tengo meseros
            </span>
            <span className="text-xs text-vimdy-text-muted">
              Servicio tradicional
            </span>
          </div>
        </button>

        <button
          type="button"
          onClick={() => handleSelect(false)}
          disabled={saving}
          className={`
            group relative flex flex-col items-center justify-center gap-4 rounded-vimdy-lg border-2 px-6 py-8
            transition-all duration-200 text-center
            disabled:cursor-not-allowed
            ${
              selected === false
                ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
            }
            ${saving && selected !== false ? "opacity-40" : ""}
          `}
        >
          {selected === false && (
            <span className="absolute top-3 right-3 text-vimdy-accent">
              <CheckCircle2 size={18} />
            </span>
          )}

          <div className={`
            w-14 h-14 rounded-vimdy-md flex items-center justify-center transition-colors
            ${selected === false ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
          `}>
            <UserCheck size={28} strokeWidth={1.8} />
          </div>

          <div className="flex flex-col gap-1">
            <span className={`text-base font-semibold ${selected === false ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
              No, autoservicio
            </span>
            <span className="text-xs text-vimdy-text-muted">
              Clientes se sientan solos
            </span>
          </div>
        </button>
      </div>

      {saving && (
        <p className="text-center text-sm text-vimdy-text-secondary mt-6 flex items-center justify-center gap-2">
          <Loader2 size={14} className="animate-spin" />
          Guardando configuración...
        </p>
      )}
    </div>
  );
}