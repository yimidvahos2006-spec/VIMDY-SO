import { useState } from "react";
import {
  UtensilsCrossed,
  Coffee,
  Pizza,
  Flame,
  Wine,
  Croissant,
  IceCream,
  Truck,
  Utensils,
  CupSoda,
  CheckCircle2,
  Loader2
} from "lucide-react";

import { VimdyButton } from "../ui/VimdyButton";
import { setBusinessType } from "../../../infrastructure/supabase/authBusinessContext";
import { BUSINESS_TYPES, type BusinessTypeId } from "../../../core/config/businessTypes";

interface BusinessTypeStepProps {
  businessId: string;
  onSaved: (businessType: BusinessTypeId, customLabel?: string) => void;
}

const ICONS: Record<string, React.ElementType> = {
  restaurante: UtensilsCrossed,
  cafeteria: Coffee,
  pizzeria: Pizza,
  asadero: Flame,
  bar: Wine,
  panaderia: Croissant,
  pasteleria: Croissant,
  reposteria: Croissant,
  heladeria: IceCream,
  food_truck: Truck,
  comida_rapida: Utensils,
  negocio_bebidas: CupSoda,
  jugueria: CupSoda,
  catering: UtensilsCrossed,
  comedor: Utensils,
  cadena: UtensilsCrossed
};

export function BusinessTypeStep({ businessId, onSaved }: BusinessTypeStepProps) {
  const [selected, setSelected] = useState<BusinessTypeId | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCardClick(businessType: BusinessTypeId) {
    if (saving) return;
    setError(null);
    setSelected(businessType);
  }

  async function handleContinue() {
    if (saving || !selected) return;

    setSaving(true);
    setError(null);

    try {
      await setBusinessType(businessId, selected);
      onSaved(selected);
    } catch (err) {
      const message = err instanceof Error ? err.message : "No se pudo guardar el tipo de negocio.";
      setError(message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 1 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Qué tipo de negocio tienes?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Personalizaremos VIMDY según tu operación. Puedes cambiar esto después en Configuración.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
        {BUSINESS_TYPES.map((type) => {
          const isSelected = selected === type.id;
          const Icon = ICONS[type.id];

          return (
            <button
              key={type.id}
              type="button"
              onClick={() => handleCardClick(type.id)}
              disabled={saving}
              className={`
                group relative flex flex-col items-center justify-center gap-3 rounded-vimdy-lg border-2 px-4 py-6
                transition-all duration-200
                disabled:cursor-not-allowed
                ${
                  isSelected
                    ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent scale-[1.02]"
                    : "border-vimdy-border bg-vimdy-surface hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover hover:-translate-y-0.5"
                }
              `}
            >
              {isSelected && (
                <span className="absolute top-2.5 right-2.5 text-vimdy-accent">
                  <CheckCircle2 size={18} />
                </span>
              )}

              <div className={`
                w-12 h-12 rounded-vimdy-md flex items-center justify-center transition-colors
                ${isSelected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                {Icon ? <Icon size={26} strokeWidth={1.8} /> : null}
              </div>

              <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                {type.label}
              </span>
            </button>
          );
        })}

      </div>

      <div className="mt-8 flex justify-center">
        <VimdyButton
          onClick={handleContinue}
          disabled={saving || !selected}
          variant="primary"
          size="lg"
          className="min-w-[200px]"
        >
          {saving ? (
            <span className="flex items-center gap-2">
              <Loader2 size={18} className="animate-spin" />
              Guardando...
            </span>
          ) : (
            "Continuar"
          )}
        </VimdyButton>
      </div>

      {error && (
        <div className="mt-6 flex items-start gap-2 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger-bg px-4 py-3 text-vimdy-small text-vimdy-danger">
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>{error}</span>
        </div>
      )}
    </div>
  );
}