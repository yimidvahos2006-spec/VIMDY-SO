import { SalesChannel, SALES_CHANNEL_OPTIONS } from "../../../core/config/operation";
import { CheckCircle2, Store, Truck, Utensils, Phone, Wifi } from "lucide-react";

interface Props {
  value: SalesChannel[];
  onChange: (channels: SalesChannel[]) => void;
}

const CHANNEL_ICONS: Record<SalesChannel, React.ElementType> = {
  presencial: Store,
  llevar: Utensils,
  domicilio: Truck,
  web: Wifi,
  plataformas: Phone
};

export function SalesChannelsStep({ value, onChange }: Props) {
  function toggle(channel: SalesChannel) {
    if (value.includes(channel)) {
      onChange(value.filter(c => c !== channel));
    } else {
      onChange([...value, channel]);
    }
  }

  return (
    <div className="w-full max-w-3xl mx-auto">
      <div className="text-center mb-10">
        <p className="text-vimdy-micro uppercase tracking-widest text-vimdy-accent font-semibold mb-3">Paso 3 de 7</p>
        <h2 className="text-vimdy-h2 text-vimdy-text mb-2">¿Cómo vendes?</h2>
        <p className="text-vimdy-small text-vimdy-text-secondary max-w-md mx-auto">
          Selecciona todos los canales que uses. Puedes cambiarlos después.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {SALES_CHANNEL_OPTIONS.map(option => {
          const isSelected = value.includes(option.value);
          const Icon = CHANNEL_ICONS[option.value];

          return (
            <button
              key={option.value}
              type="button"
              onClick={() => toggle(option.value)}
              className={`
                group relative flex items-center gap-4 rounded-vimdy-lg border-2 px-5 py-4
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

              <div className={`
                w-11 h-11 rounded-vimdy-md flex items-center justify-center shrink-0 transition-colors
                ${isSelected ? "bg-vimdy-accent/15 text-vimdy-accent" : "bg-vimdy-background text-vimdy-text-secondary group-hover:text-vimdy-text"}
              `}>
                <Icon size={22} strokeWidth={1.8} />
              </div>

              <span className={`text-sm font-semibold ${isSelected ? "text-vimdy-text" : "text-vimdy-text-secondary group-hover:text-vimdy-text"}`}>
                {option.label}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}