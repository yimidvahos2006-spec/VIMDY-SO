// src/presentation/components/inventory/product-form/KitchenStationPicker.tsx
//
// "¿Dónde se prepara?": selector opcional de estación (Cocina, Barra...).
// Sin elegir nada, el ticket va a la estación de la categoría.

import React, { useId, useState } from "react";
import { Plus } from "lucide-react";

interface Props {
  /** "" = automática. */
  value: string;
  onChange: (station: string) => void;
  stations: readonly string[];
  /** Estación que se usa si no se elige ninguna (la de la categoría o "Cocina"). */
  autoLabel: string;
}

const chip = (selected: boolean) =>
  `h-9 rounded-vimdy-md border px-vimdy-md text-vimdy-small font-medium transition-colors duration-vimdy-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40 ${
    selected
      ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent-hover"
      : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover hover:text-vimdy-text"
  }`;

export function KitchenStationPicker({ value, onChange, stations, autoLabel }: Props) {
  const titleId = useId();
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");

  function commitDraft() {
    const typed = draft.trim();
    setAdding(false);
    setDraft("");
    if (!typed) return;
    // Reutiliza una estación existente si solo cambian mayúsculas.
    onChange(stations.find((s) => s.toLowerCase() === typed.toLowerCase()) ?? typed);
  }

  const isCustom = value !== "" && !stations.some((s) => s.toLowerCase() === value.toLowerCase());
  const options = isCustom ? [...stations, value] : stations;

  return (
    <section aria-labelledby={titleId} className="space-y-vimdy-sm">
      <div>
        <h3 id={titleId} className="text-vimdy-small font-semibold text-vimdy-text">
          ¿A dónde va el ticket?
        </h3>
        <p className="text-vimdy-micro font-normal text-vimdy-text-tertiary">
          Opcional. Si no eliges, va a: {autoLabel}.
        </p>
      </div>

      <div role="radiogroup" aria-labelledby={titleId} className="flex flex-wrap gap-vimdy-sm">
        <button type="button" role="radio" aria-checked={value === ""} onClick={() => onChange("")} className={chip(value === "")}>
          Automático
        </button>
        {options.map((station) => (
          <button
            key={station}
            type="button"
            role="radio"
            aria-checked={value.toLowerCase() === station.toLowerCase()}
            onClick={() => onChange(station)}
            className={chip(value.toLowerCase() === station.toLowerCase())}
          >
            {station}
          </button>
        ))}

        {adding ? (
          <input
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commitDraft}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                commitDraft();
              } else if (e.key === "Escape") {
                e.stopPropagation();
                setAdding(false);
                setDraft("");
              }
            }}
            placeholder="Ej. Parrilla"
            aria-label="Nombre de la nueva estación"
            maxLength={30}
            className="h-9 w-36 rounded-vimdy-md border border-vimdy-accent bg-vimdy-surface px-vimdy-md text-vimdy-small text-vimdy-text outline-none placeholder:text-vimdy-text-tertiary"
          />
        ) : (
          <button type="button" onClick={() => setAdding(true)} className={`${chip(false)} inline-flex items-center gap-vimdy-xs`}>
            <Plus size={14} aria-hidden="true" />
            Otra
          </button>
        )}
      </div>
    </section>
  );
}