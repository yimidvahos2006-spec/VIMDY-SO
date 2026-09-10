import { useState } from "react";
import {
  UtensilsCrossed,
  Coffee,
  Pizza,
  Flame,
  Wine,
  Croissant,
  ShoppingCart,
  IceCream,
  Building2,
  Truck,
  Utensils,
  Store,
  ShoppingBag,
  CupSoda,
  Package,
  Wrench,
  Plus,
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

const ICONS: Record<BusinessTypeId, React.ElementType> = {
  restaurante: UtensilsCrossed,
  cafeteria: Coffee,
  pizzeria: Pizza,
  asadero: Flame,
  bar: Wine,
  panaderia: Croissant,
  tienda: ShoppingCart,
  heladeria: IceCream,
  hotel: Building2,
  food_truck: Truck,
  comida_rapida: Utensils,
  minimercado: Store,
  pequeno_supermercado: ShoppingBag,
  negocio_bebidas: CupSoda,
  negocio_productos: Package,
  negocio_servicios: Wrench,
  otro: Plus
};

export function BusinessTypeStep({ businessId, onSaved }: BusinessTypeStepProps) {
  const [selected, setSelected] = useState<BusinessTypeId | null>(null);
  const [customLabel, setCustomLabel] = useState("");
  const [showCustomInput, setShowCustomInput] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function handleCardClick(businessType: BusinessTypeId) {
    if (saving) return;
    setError(null);
    setSelected(businessType);
    if (businessType !== "otro") {
      setCustomLabel("");
      setShowCustomInput(false);
    }
  }

  function handleOtroClick() {
    if (saving) return;
    setError(null);
    setSelected("otro");
    setShowCustomInput(true);
  }

  async function handleContinue() {
    if (saving || !selected) return;

    if (selected === "otro" && !customLabel.trim()) {
      setError("Escribe el nombre de tu negocio para continuar.");
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const label = selected === "otro" ? customLabel.trim() : undefined;
      await setBusinessType(businessId, selected, label);
      onSaved(selected, label);
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
        {BUSINESS_TYPES.filter((t) => t.id !== "otro").map((type) => {
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
                <Icon size={26} strokeWidth={1.8} />
              </div>

              <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                {type.label}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          onClick={handleOtroClick}
          disabled={saving}
          className={`
            flex flex-col items-center justify-center gap-3 rounded-vimdy-lg border-2 border-dashed px-4 py-6
            transition-all duration-200 disabled:cursor-not-allowed
            ${
              showCustomInput
                ? "border-vimdy-accent bg-vimdy-accent/10 shadow-vimdy-accent"
                : "border-vimdy-border-subtle bg-vimdy-surface/60 hover:border-vimdy-accent/60 hover:bg-vimdy-surface-hover"
            }
          `}
        >
          <div className={`
            w-12 h-12 rounded-vimdy-md flex items-center justify-center transition-colors
            ${showCustomInput ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary"}
          `}>
            <Plus size={26} strokeWidth={1.8} />
          </div>
          <span className={`text-sm font-semibold ${showCustomInput ? "text-vimdy-text" : "text-vimdy-text-secondary"}`}>
            Otro
          </span>
        </button>
      </div>

      {showCustomInput && selected === "otro" && (
        <div className="mt-8 flex flex-col gap-4 max-w-md mx-auto">
          <div>
            <label htmlFor="custom-business" className="block text-vimdy-small font-medium text-vimdy-text-secondary mb-1.5">
              Nombre de tu negocio
            </label>
            <input
              id="custom-business"
              type="text"
              value={customLabel}
              onChange={(e) => setCustomLabel(e.target.value)}
              disabled={saving}
              placeholder="Ej. Empanadas El Buen Sabor"
              autoFocus
              className="w-full rounded-vimdy-md border-2 border-vimdy-border bg-vimdy-surface px-4 py-3 text-vimdy-body text-vimdy-text placeholder-vimdy-text-muted outline-none transition-all duration-200 focus:border-vimdy-accent focus:ring-4 focus:ring-vimdy-accent/10 disabled:opacity-50"
            />
          </div>
        </div>
      )}

      <div className="mt-8 flex justify-center">
        <VimdyButton
          onClick={handleContinue}
          disabled={saving || !selected || (selected === "otro" && !customLabel.trim())}
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
