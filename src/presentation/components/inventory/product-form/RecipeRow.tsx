// src/presentation/components/inventory/product-form/RecipeRow.tsx
//
// Una fila de la receta: ingrediente · cantidad · unidad · quitar.

import React from "react";
import { X } from "lucide-react";
import type { Product } from "../../../../core/entities/Entities";
import { compatibleUnits, normalizeUnit } from "../../../../core/utils/unitConversion";
import { sanitizeQuantityInput } from "../recipeFormHelpers";
import type { RecipeRowDraft } from "./productFormTypes";

/** Nombre de la unidad en lenguaje de cocina. */
const UNIT_LABEL: Record<string, string> = {
  g: "gramos",
  kg: "kilos",
  libra: "libras",
  ml: "ml",
  litro: "litros",
  unidad: "unidades",
  paquete: "paquetes",
  caja: "cajas"
};

export const unitLabel = (unit: string) => UNIT_LABEL[normalizeUnit(unit)] ?? unit;

interface Props {
  row: RecipeRowDraft;
  ingredient?: Product;
  invalid: boolean;
  onChange: (field: "quantity" | "unit", value: string) => void;
  onRemove: () => void;
  /** Enter en la cantidad: vuelve al buscador para seguir con el siguiente ingrediente. */
  onEnter: () => void;
}

export function RecipeRow({ row, ingredient, invalid, onChange, onRemove, onEnter }: Props) {
  const name = ingredient?.name ?? "Ingrediente";
  const units = compatibleUnits(ingredient?.unit);
  const currentUnit = row.unit || normalizeUnit(ingredient?.unit);

  return (
    <li className="flex flex-wrap items-center gap-x-vimdy-sm gap-y-vimdy-xs py-vimdy-sm">
      <span className="min-w-0 basis-full truncate text-vimdy-small text-vimdy-text sm:basis-0 sm:flex-1" title={name}>
        {name}
      </span>

      <input
        data-qty-row={row.rowId}
        type="text"
        inputMode="decimal"
        value={row.quantity}
        onChange={(e) => onChange("quantity", sanitizeQuantityInput(e.target.value))}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            onEnter();
          }
        }}
        placeholder="0"
        aria-label={`Cantidad de ${name}`}
        aria-invalid={invalid}
        className={`h-10 w-24 rounded-vimdy-sm border bg-vimdy-surface px-vimdy-sm text-right text-vimdy-small tabular-nums text-vimdy-text outline-none transition-colors duration-vimdy-fast placeholder:text-vimdy-text-tertiary focus:ring-2 ${
          invalid
            ? "border-vimdy-danger focus:border-vimdy-danger focus:ring-vimdy-danger/20"
            : "border-vimdy-border focus:border-vimdy-accent focus:ring-vimdy-accent/20"
        }`}
      />

      {units.length > 1 ? (
        <select
          value={currentUnit}
          onChange={(e) => onChange("unit", e.target.value)}
          aria-label={`Unidad de ${name}`}
          className="h-10 w-28 rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface px-vimdy-sm text-vimdy-small text-vimdy-text outline-none transition-colors duration-vimdy-fast focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20"
        >
          {units.map((u) => (
            <option key={u} value={u}>
              {unitLabel(u)}
            </option>
          ))}
        </select>
      ) : (
        <span className="w-28 px-vimdy-sm text-vimdy-small text-vimdy-text-secondary">{unitLabel(currentUnit)}</span>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={`Quitar ${name}`}
        className="flex h-10 w-10 items-center justify-center rounded-vimdy-sm text-vimdy-text-tertiary transition-colors duration-vimdy-fast hover:bg-vimdy-danger-bg hover:text-vimdy-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-vimdy-accent/40"
      >
        <X size={16} />
      </button>
    </li>
  );
}