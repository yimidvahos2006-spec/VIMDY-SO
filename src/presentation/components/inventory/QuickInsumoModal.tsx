// src/presentation/components/inventory/QuickInsumoModal.tsx
//
// Modal ágil para crear un insumo NUEVO: solo Nombre, Unidad y Costo de compra.
// La categoría se propone sola a partir del nombre (ver insumoCategoryGuess) y
// se puede cambiar con un toque. Stock mínimo, proveedor, SKU, etc. se editan
// después con el botón "Editar" de la tabla.

import React, { useMemo, useRef, useState } from "react";
import { X } from "lucide-react";
import { toast } from "../../../core/store/toastStore";
import type { Category } from "../../../core/entities/Entities";
import type { ProductInput } from "../../../core/engines/InventoryEngine";
import { VimdyButton } from "../ui/VimdyButton";
import { MoneyInput } from "../ui/MoneyInput";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import {
  buildCategoryPickerOptions,
  describeCategoryTarget,
  resolveInsumoCategory
} from "../../../core/utils/insumoCategoryChoice";

/** Las tres unidades de siempre van a un toque; el resto, en "Otra". */
const MAIN_UNITS: ReadonlyArray<{ value: string; label: string; short: string }> = [
  { value: "kg", label: "Kilo", short: "kg" },
  { value: "unidad", label: "Unidad", short: "unidad" },
  { value: "litro", label: "Litro", short: "litro" }
];
const OTHER_UNITS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "g", label: "Gramo (g)" },
  { value: "libra", label: "Libra" },
  { value: "ml", label: "Mililitro (ml)" }
];

interface Props {
  /** Categorías de insumos que el negocio ya tiene. */
  categories: Category[];
  /** Solo quien tenga inventory.viewCosts ve y llena el costo. */
  canViewCosts: boolean;
  onCreateCategory: (name: string) => Promise<Category | null>;
  /** Debe lanzar un Error con mensaje claro si no se pudo guardar. */
  onSave: (input: ProductInput) => Promise<void>;
  onClose: () => void;
}

export function QuickInsumoModal({ categories, canViewCosts, onCreateCategory, onSave, onClose }: Props) {
  const [name, setName] = useState("");
  const [unit, setUnit] = useState("");
  const [cost, setCost] = useState("");
  // null = categoría automática; "id" o "new:Nombre" = el dueño la eligió a mano.
  const [manualChoice, setManualChoice] = useState<string | null>(null);
  const [pickingCategory, setPickingCategory] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);

  // Qué categoría se va a usar y cómo se llama (para mostrarla antes de guardar).
  const targetLabel = useMemo(
    () => describeCategoryTarget(name, manualChoice, categories),
    [name, manualChoice, categories]
  );
  const pickerOptions = useMemo(() => buildCategoryPickerOptions(categories), [categories]);

  async function submit(keepOpen: boolean) {
    setError(null);
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Escribe el nombre del insumo.");
      nameRef.current?.focus();
      return;
    }
    if (!unit) {
      setError("Elige la unidad en la que lo compras (kilo, unidad, litro...).");
      return;
    }
    let purchasePrice: number | undefined;
    if (canViewCosts && cost.trim() !== "") {
      purchasePrice = parseMoneyInput(cost);
      if (!Number.isFinite(purchasePrice) || purchasePrice < 0) {
        setError("El costo de compra no es válido.");
        return;
      }
    }

    setSaving(true);
    try {
      const resolved = await resolveInsumoCategory({ name: trimmed, manualChoice, categories, createCategory: onCreateCategory });
      if (!resolved.ok) {
        setError(resolved.reason);
        return;
      }
      const categoryId = resolved.categoryId;

      await onSave({
        name: trimmed,
        categoryId,
        price: 0,
        purchasePrice,
        stock: 0,
        minStock: 0,
        unit,
        active: true,
        isIngredient: true,
        trackStock: true,
        requiresKitchen: false
      });

      toast.success(`"${trimmed}" creado en ${targetLabel}.`);
      if (keepOpen) {
        // Listo para el siguiente: se conserva la unidad (suelen venir en tandas).
        setName("");
        setCost("");
        setManualChoice(null);
        setPickingCategory(false);
        nameRef.current?.focus();
      } else {
        onClose();
      }
    } catch (err: any) {
      setError(err?.message ?? "No se pudo guardar el insumo.");
    } finally {
      setSaving(false);
    }
  }

  const unitLabel = unit ? (MAIN_UNITS.find((u) => u.value === unit)?.short ?? unit) : null;
  const otherSelected = !!unit && !MAIN_UNITS.some((u) => u.value === unit);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Nuevo insumo"
        className="w-full max-w-md rounded-vimdy-lg border border-vimdy-border bg-vimdy-surface p-6"
      >
        <div className="flex items-start justify-between mb-5">
          <div>
            <h2 className="text-xl font-bold text-vimdy-text">Nuevo insumo</h2>
            <p className="text-vimdy-text-secondary text-sm mt-0.5">Lo que compras para preparar tus productos.</p>
          </div>
          <button onClick={onClose} aria-label="Cerrar" className="text-vimdy-text-secondary hover:text-vimdy-text">
            <X size={20} />
          </button>
        </div>

        {error && (
          <div role="alert" className="mb-4 rounded-vimdy-md border border-vimdy-danger/40 bg-vimdy-danger/10 text-vimdy-danger text-sm px-3 py-2">
            {error}
          </div>
        )}

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
          className="space-y-5"
        >
          <div>
            <label htmlFor="quick-insumo-name" className="block text-vimdy-text-secondary text-sm font-medium mb-1">
              Nombre
            </label>
            <input
              id="quick-insumo-name"
              ref={nameRef}
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ej: Carne molida, Leche, Vasos 12oz..."
              className="w-full h-12 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
            />
            {name.trim().length >= 2 && (
              <div className="mt-2 flex items-center gap-2 text-xs text-vimdy-text-secondary" aria-live="polite">
                <span>Categoría:</span>
                {pickingCategory ? (
                  <select
                    autoFocus
                    value={manualChoice ?? ""}
                    onChange={(e) => {
                      setManualChoice(e.target.value || null);
                      setPickingCategory(false);
                    }}
                    onBlur={() => setPickingCategory(false)}
                    aria-label="Elegir categoría"
                    className="h-8 px-2 rounded-vimdy-sm bg-vimdy-background border border-vimdy-border text-vimdy-text text-xs outline-none focus:border-vimdy-accent"
                  >
                    <option value="">Automática ({targetLabel})</option>
                    {pickerOptions.map((o) => (
                      <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                  </select>
                ) : (
                  <>
                    <span className="px-2 py-0.5 rounded-full bg-vimdy-accent/15 text-vimdy-accent border border-vimdy-accent/30 font-semibold">
                      {targetLabel}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickingCategory(true)}
                      className="text-vimdy-text-tertiary hover:text-vimdy-text underline underline-offset-2"
                    >
                      Cambiar
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div>
            <span className="block text-vimdy-text-secondary text-sm font-medium mb-1">Unidad en que lo compras</span>
            <div className="grid grid-cols-4 gap-2" role="radiogroup" aria-label="Unidad de medida">
              {MAIN_UNITS.map((u) => {
                const selected = unit === u.value;
                return (
                  <button
                    key={u.value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setUnit(u.value)}
                    className={`h-12 rounded-vimdy-md border text-sm font-semibold transition ${
                      selected
                        ? "bg-vimdy-accent/20 border-vimdy-accent text-vimdy-text"
                        : "bg-vimdy-background border-vimdy-border text-vimdy-text-secondary hover:text-vimdy-text hover:border-vimdy-accent/60"
                    }`}
                  >
                    {u.label}
                  </button>
                );
              })}
              <select
                value={otherSelected ? unit : ""}
                onChange={(e) => e.target.value && setUnit(e.target.value)}
                aria-label="Otra unidad"
                className={`h-12 px-2 rounded-vimdy-md border text-sm font-semibold outline-none transition ${
                  otherSelected
                    ? "bg-vimdy-accent/20 border-vimdy-accent text-vimdy-text"
                    : "bg-vimdy-background border-vimdy-border text-vimdy-text-secondary focus:border-vimdy-accent"
                }`}
              >
                <option value="">Otra…</option>
                {OTHER_UNITS.map((u) => (
                  <option key={u.value} value={u.value}>{u.label}</option>
                ))}
              </select>
            </div>
          </div>

          {canViewCosts && (
            <div>
              <label htmlFor="quick-insumo-cost" className="block text-vimdy-text-secondary text-sm font-medium mb-1">
                Costo de compra{unitLabel ? ` por ${unitLabel}` : ""}
              </label>
              <MoneyInput
                id="quick-insumo-cost"
                value={cost}
                onValueChange={setCost}
                placeholder="0"
                className="w-full h-12 px-3 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-accent"
              />
              <p className="text-vimdy-text-tertiary text-xs mt-1">
                Lo que te cuesta {unitLabel ? `un ${unitLabel}` : "una unidad"}. Si no lo sabes, déjalo vacío y lo completas al registrar la compra.
              </p>
            </div>
          )}

          <div className="flex flex-col-reverse sm:flex-row items-stretch sm:items-center justify-end gap-2 pt-4 border-t border-vimdy-border">
            <VimdyButton variant="ghost" type="button" onClick={onClose} disabled={saving}>
              Cancelar
            </VimdyButton>
            <VimdyButton variant="secondary" type="button" onClick={() => void submit(true)} disabled={saving}>
              Guardar y agregar otro
            </VimdyButton>
            <VimdyButton type="submit" loading={saving}>
              Guardar insumo
            </VimdyButton>
          </div>
        </form>
      </div>
    </div>
  );
}