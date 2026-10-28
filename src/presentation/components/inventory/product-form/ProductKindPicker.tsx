// src/presentation/components/inventory/product-form/ProductKindPicker.tsx
//
// "¿Qué vas a vender?": tres botones grandes que deciden qué campos se muestran.
//   Preparado -> receta e ingredientes · Reventa -> costo y código de barras · Servicio -> sin inventario.

import React, { useId } from "react";
import type { FormKind } from "./buildProductInput";

type PickableKind = Exclude<FormKind, "ingrediente">;

interface Props {
  value: PickableKind;
  onChange: (kind: PickableKind) => void;
  disabled?: boolean;
}

const OPTIONS: ReadonlyArray<{
  kind: PickableKind;
  title: string;
  subtitle: string;
  hint: string;
  emoji: string;
}> = [
  {
    kind: "preparado",
    title: "Preparado",
    subtitle: "con receta",
    hint: "Hamburguesas, jugos, platos. Lleva ingredientes, los descuenta del inventario y el costo lo calcula la receta.",
    emoji: "🍔"
  },
  {
    kind: "reventa",
    title: "Reventa",
    subtitle: "directo",
    hint: "Gaseosas, agua, snacks. Lo compras y lo vendes tal cual: pon tu costo y, si quieres, el código de barras.",
    emoji: "🥤"
  },
  {
    kind: "servicio",
    title: "Servicio",
    subtitle: "sin stock",
    hint: "Domicilio, propina o lo que no se cuenta. Se vende directo en la caja, sin descontar inventario ni pedir costos.",
    emoji: "⚡"
  }
];

export function ProductKindPicker({ value, onChange, disabled }: Props) {
  const titleId = useId();
  const hintId = useId();
  const selected = OPTIONS.find((o) => o.kind === value) ?? OPTIONS[0];

  function handleKeyDown(e: React.KeyboardEvent<HTMLButtonElement>, index: number) {
    const step = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const next = OPTIONS[(index + step + OPTIONS.length) % OPTIONS.length];
    onChange(next.kind);
    (e.currentTarget.parentElement?.querySelector(`[data-kind="${next.kind}"]`) as HTMLElement | null)?.focus();
  }

  return (
    <section aria-labelledby={titleId} className="space-y-vimdy-sm">
      <h3 id={titleId} className="text-vimdy-small font-semibold text-vimdy-text">
        ¿Qué vas a vender?
      </h3>

      <div role="radiogroup" aria-labelledby={titleId} aria-describedby={hintId} className="grid grid-cols-3 gap-vimdy-sm">
        {OPTIONS.map(({ kind, title, subtitle, emoji }, index) => {
          const checked = kind === value;
          return (
            <button
              key={kind}
              type="button"
              role="radio"
              data-kind={kind}
              aria-checked={checked}
              tabIndex={checked ? 0 : -1}
              disabled={disabled}
              onClick={() => onChange(kind)}
              onKeyDown={(e) => handleKeyDown(e, index)}
              className={`flex min-h-[4rem] flex-col items-center justify-center gap-vimdy-xs rounded-vimdy-md border px-vimdy-sm py-vimdy-sm text-center transition-colors duration-vimdy-fast focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40 disabled:cursor-not-allowed disabled:opacity-50 ${
                checked
                  ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent-hover"
                  : "border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface-hover hover:text-vimdy-text"
              }`}
            >
              <span aria-hidden="true" className="text-xl leading-none">
                {emoji}
              </span>
              <span className="text-vimdy-small font-semibold leading-tight">{title}</span>
              <span className="text-vimdy-micro font-normal leading-tight opacity-80">{subtitle}</span>
            </button>
          );
        })}
      </div>

      <p id={hintId} aria-live="polite" className="text-vimdy-micro font-normal text-vimdy-text-tertiary">
        {selected.hint}
      </p>
    </section>
  );
}