// src/presentation/components/inventory/product-form/KitchenStationPicker.tsx
//
// "¿A qué área va la comanda?": selector opcional de estación (Cocina, Barra...).
// Sin elegir nada, la comanda va a la estación de la categoría.

import React, { useEffect, useId, useRef, useState } from "react";
import { HelpCircle, Plus } from "lucide-react";

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
  const helpId = useId();
  const sectionRef = useRef<HTMLElement>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  // Ayuda: se abre al pasar el cursor/enfocar, o fija con clic (para táctil).
  const [helpPinned, setHelpPinned] = useState(false);
  const [helpHover, setHelpHover] = useState(false);
  const helpOpen = helpPinned || helpHover;

  useEffect(() => {
    if (!helpPinned) return;
    const onPointerDown = (e: PointerEvent) => {
      if (!sectionRef.current?.contains(e.target as Node)) setHelpPinned(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    return () => document.removeEventListener("pointerdown", onPointerDown);
  }, [helpPinned]);

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
    <section ref={sectionRef} aria-labelledby={titleId} className="relative space-y-vimdy-sm">
      <div>
        <div className="flex items-center gap-vimdy-xs">
          <h3 id={titleId} className="text-vimdy-small font-semibold text-vimdy-text">
            ¿A qué área va la comanda?
          </h3>
          <button
            type="button"
            aria-label="Más información sobre las áreas de envío"
            aria-expanded={helpOpen}
            aria-controls={helpId}
            onClick={() => setHelpPinned((v) => !v)}
            onMouseEnter={() => setHelpHover(true)}
            onMouseLeave={() => setHelpHover(false)}
            onFocus={() => setHelpHover(true)}
            onBlur={() => setHelpHover(false)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && helpOpen) {
                e.stopPropagation();
                setHelpPinned(false);
                setHelpHover(false);
              }
            }}
            className="inline-flex h-5 w-5 items-center justify-center rounded-full text-vimdy-text-tertiary transition-colors duration-vimdy-fast hover:text-vimdy-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40"
          >
            <HelpCircle size={15} aria-hidden="true" />
          </button>
        </div>
        <p className="text-vimdy-micro font-normal text-vimdy-text-tertiary">
          Opcional. Elige la pantalla de cocina (KDS) o estación que prepara este plato. Si no eliges, se envía a: {autoLabel}.
        </p>
      </div>

      {helpOpen && (
        <div
          id={helpId}
          role="tooltip"
          onMouseEnter={() => setHelpHover(true)}
          onMouseLeave={() => setHelpHover(false)}
          className="absolute bottom-full left-0 z-20 mb-vimdy-xs w-full max-w-sm rounded-vimdy-md border border-vimdy-border bg-vimdy-background-secondary p-vimdy-md text-vimdy-small text-vimdy-text-secondary shadow-lg"
        >
          <p>
            Si tu negocio es pequeño y la barra está en la misma caja, déjalo en <strong className="font-semibold text-vimdy-text">Cocina</strong> o{" "}
            <strong className="font-semibold text-vimdy-text">Automático</strong>: no necesitas más.
          </p>
          <p className="mt-vimdy-xs">
            Si tienes pantallas TV o impresoras separadas, elige <strong className="font-semibold text-vimdy-text">Barra</strong> o crea una
            nueva área con <strong className="font-semibold text-vimdy-text">+ Otra</strong>.
          </p>
        </div>
      )}

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