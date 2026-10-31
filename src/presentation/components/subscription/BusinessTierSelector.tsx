import React, { useRef } from "react";
import { Building2, Store } from "lucide-react";

import {
  BUSINESS_TIERS,
  TIER_DEFINITIONS,
  type BusinessTier
} from "../../../core/entities/SubscriptionTypes";

interface BusinessTierSelectorProps {
  value: BusinessTier;
  onChange: (tier: BusinessTier) => void;
  /** Niveles que se pueden elegir. Por defecto, todos. */
  availableTiers?: readonly BusinessTier[];
  disabled?: boolean;
}

const TIER_ICONS: Record<BusinessTier, React.ReactNode> = {
  single: <Store size={18} aria-hidden="true" />,
  multi: <Building2 size={18} aria-hidden="true" />
};

/**
 * BusinessTierSelector
 * ---------------------------------------------------------------------------
 * Selector segmentado "Negocio de 1 Sede" / "Multi-Sucursal (2+ sedes)" que
 * va en la parte superior del modal de planes. Es un radiogroup accesible:
 * se navega con las flechas del teclado y lo lee bien un lector de pantalla.
 */
export function BusinessTierSelector({
  value,
  onChange,
  availableTiers = BUSINESS_TIERS,
  disabled = false
}: BusinessTierSelectorProps) {
  const optionRefs = useRef<Partial<Record<BusinessTier, HTMLButtonElement | null>>>({});
  const tiers = BUSINESS_TIERS.filter((tier) => availableTiers.includes(tier));

  function moveSelection(current: BusinessTier, step: 1 | -1) {
    const index = tiers.indexOf(current);
    if (index === -1 || tiers.length === 0) return;
    const next = tiers[(index + step + tiers.length) % tiers.length];
    onChange(next);
    optionRefs.current[next]?.focus();
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLButtonElement>, tier: BusinessTier) {
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      event.preventDefault();
      moveSelection(tier, 1);
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      event.preventDefault();
      moveSelection(tier, -1);
    }
  }

  return (
    <div
      role="radiogroup"
      aria-label="Tipo de negocio"
      className="grid grid-cols-1 sm:grid-cols-2 gap-2 rounded-2xl border border-vimdy-border bg-vimdy-background/60 p-1.5"
    >
      {tiers.map((tier) => {
        const definition = TIER_DEFINITIONS[tier];
        const selected = tier === value;

        return (
          <button
            key={tier}
            ref={(element) => {
              optionRefs.current[tier] = element;
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            disabled={disabled}
            onClick={() => onChange(tier)}
            onKeyDown={(event) => handleKeyDown(event, tier)}
            className={`flex items-center gap-3 rounded-xl px-4 py-3 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent disabled:opacity-60 ${
              selected
                ? "bg-vimdy-accent text-white shadow-sm"
                : "text-vimdy-text-secondary hover:bg-vimdy-surface-active hover:text-vimdy-text"
            }`}
          >
            <span
              className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${
                selected ? "bg-white/20" : "bg-vimdy-surface"
              }`}
            >
              {TIER_ICONS[tier]}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-bold leading-tight">{definition.label}</span>
              <span className={`block text-xs ${selected ? "text-white/80" : "text-vimdy-text-tertiary"}`}>
                {definition.sublabel}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
}