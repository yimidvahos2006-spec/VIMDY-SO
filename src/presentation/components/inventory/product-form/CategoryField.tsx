// src/presentation/components/inventory/product-form/CategoryField.tsx
//
// Categoría de venta: lista + "Crear categoría nueva" en el mismo lugar.

import React from "react";
import type { Category } from "../../../../core/entities/Entities";
import { VimdyButton } from "../../ui/VimdyButton";
import { VimdyInput } from "../../ui/VimdyInput";
import { VimdySelect } from "../../ui/VimdySelect";
import { NEW_CATEGORY_VALUE } from "./productFormTypes";

interface Props {
  categories: readonly Category[];
  value: string;
  onChange: (categoryId: string) => void;
  disabled?: boolean;
  newName: string;
  onNewNameChange: (name: string) => void;
  onCreate: () => void;
  creating: boolean;
  error: string | null;
}

export function CategoryField({ categories, value, onChange, disabled, newName, onNewNameChange, onCreate, creating, error }: Props) {
  const isNew = value === NEW_CATEGORY_VALUE;

  return (
    <div className="space-y-vimdy-sm">
      <VimdySelect label="Categoría" value={value} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
        {categories.map((c) => (
          <option key={c.id} value={c.id}>
            {c.name}
          </option>
        ))}
        <option value={NEW_CATEGORY_VALUE}>+ Crear categoría nueva…</option>
      </VimdySelect>

      {isNew && (
        <div className="flex items-start gap-vimdy-sm">
          <div className="min-w-0 flex-1">
            <VimdyInput
              autoFocus
              value={newName}
              onChange={(e) => onNewNameChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  onCreate();
                }
              }}
              placeholder="Nombre de la categoría (ej. Hamburguesas)"
              aria-label="Nombre de la categoría nueva"
              error={error ?? undefined}
            />
          </div>
          <VimdyButton variant="secondary" onClick={onCreate} loading={creating} disabled={!newName.trim()}>
            Crear
          </VimdyButton>
        </div>
      )}
    </div>
  );
}