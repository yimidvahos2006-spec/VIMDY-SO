// src/presentation/components/waiter/quickOrder/QuickOptionsSheet.tsx
/* ===========================================================================
   Hoja de opciones de un plato (táctil)
   ---------------------------------------------------------------------------
   Se abre desde la vista rápida de la mesa para:
     - "add":        elegir tamaño, extras, cantidad y notas ANTES de agregar.
     - "edit-note":  cambiar solo las notas de una línea ya agregada (el
                     tamaño y los extras no se tocan: son parte de su precio).
   No habla con Supabase ni con los engines: solo devuelve lo elegido.
=========================================================================== */

import React, { useMemo, useState } from "react";
import { Check, Minus, Plus, X } from "lucide-react";

import type { Product } from "../../../../core/entities/Entities";
import { useTranslation } from "../../../../core/i18n/useTranslation";
import { VimdyButton } from "../../ui/VimdyButton";
import { QUICK_NOTE_PRESETS, computeUnitPrice } from "./quickOrderLogic";

export interface QuickOptionsResult {
  sizeId: string | null;
  extraIds: string[];
  quantity: number;
  quickNotes: string[];
  freeText: string;
  /** Solo en "edit-note": a cuántas unidades de la línea se aplica la nota. */
  units?: number;
}

interface Props {
  product: Product;
  mode: "add" | "edit-note";
  /** Texto fijo de tamaño/extras de la línea (solo "edit-note"). */
  lockedVariantLabel?: string;
  /** Unidades de la línea (solo "edit-note"): permite poner la nota a 1 sola. */
  lineQuantity?: number;
  /** Precio actual de la línea (solo "edit-note"), para mostrarlo. */
  lineUnitPrice?: number;
  initialQuickNotes?: readonly string[];
  initialFreeText?: string;
  onCancel: () => void;
  onConfirm: (result: QuickOptionsResult) => void;
}

export function QuickOptionsSheet({
  product,
  mode,
  lockedVariantLabel,
  lineQuantity = 1,
  lineUnitPrice,
  initialQuickNotes = [],
  initialFreeText = "",
  onCancel,
  onConfirm
}: Props) {
  const { money } = useTranslation();
  const isAdd = mode === "add";

  const [sizeId, setSizeId] = useState<string | null>(null);
  const [extraIds, setExtraIds] = useState<string[]>([]);
  const [quantity, setQuantity] = useState(1);
  const [quickNotes, setQuickNotes] = useState<string[]>([...initialQuickNotes]);
  const [freeText, setFreeText] = useState(initialFreeText);
  const [onlyOne, setOnlyOne] = useState(false);

  const sizes = product.sizes ?? [];
  const extras = product.extras ?? [];

  const selectedSize = sizes.find((size) => size.id === sizeId) ?? null;
  const selectedExtras = extras.filter((extra) => extraIds.includes(extra.id));

  const unitPrice = useMemo(
    () => (isAdd ? computeUnitPrice(product.price, selectedSize, selectedExtras) : lineUnitPrice ?? product.price),
    [isAdd, product.price, selectedSize, selectedExtras, lineUnitPrice]
  );

  function toggleExtra(id: string) {
    setExtraIds((current) =>
      current.includes(id) ? current.filter((extraId) => extraId !== id) : [...current, id]
    );
  }

  function toggleQuickNote(note: string) {
    setQuickNotes((current) =>
      current.includes(note) ? current.filter((item) => item !== note) : [...current, note]
    );
  }

  function confirm() {
    onConfirm({
      sizeId: isAdd ? sizeId : null,
      extraIds: isAdd ? extraIds : [],
      quantity: isAdd ? quantity : lineQuantity,
      quickNotes,
      freeText,
      ...(!isAdd && lineQuantity > 1 && onlyOne ? { units: 1 } : {})
    });
  }

  const chipBase =
    "min-h-[44px] px-3.5 rounded-vimdy-md border text-vimdy-small font-semibold transition-colors active:scale-[0.98]";

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={isAdd ? `Opciones de ${product.name}` : `Notas de ${product.name}`}
      className="fixed inset-0 z-[1002] flex items-end md:items-center justify-center bg-black/70 md:p-4"
      onClick={onCancel}
    >
      <div
        className="w-full md:max-w-lg max-h-[92vh] flex flex-col rounded-t-vimdy-xl md:rounded-vimdy-xl bg-vimdy-surface border border-vimdy-border shadow-vimdy-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 p-4 border-b border-vimdy-border flex-shrink-0">
          <div className="min-w-0">
            <h3 className="text-vimdy-text font-bold text-vimdy-body leading-tight">{product.name}</h3>
            <p className="text-vimdy-text-secondary text-vimdy-small mt-0.5">
              {isAdd ? "Elige opciones y notas" : "Notas para cocina"}
              {!isAdd && lockedVariantLabel ? ` · ${lockedVariantLabel}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Cerrar"
            className="w-11 h-11 -m-1 shrink-0 flex items-center justify-center rounded-vimdy-md text-vimdy-text-secondary hover:text-vimdy-text hover:bg-vimdy-surface-hover transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-5">
          {isAdd && sizes.length > 0 && (
            <section aria-label="Tamaño">
              <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold uppercase tracking-wide mb-2">
                Tamaño
              </p>
              <div className="flex flex-col gap-2">
                {sizes.map((size) => {
                  const active = sizeId === size.id;
                  return (
                    <button
                      key={size.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setSizeId(active ? null : size.id)}
                      className={`${chipBase} h-12 flex items-center justify-between ${
                        active
                          ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                          : "border-vimdy-border text-vimdy-text hover:border-vimdy-accent/50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-full border-2 flex items-center justify-center ${
                            active ? "border-vimdy-accent" : "border-vimdy-border"
                          }`}
                        >
                          {active && <span className="w-2.5 h-2.5 rounded-full bg-vimdy-accent" />}
                        </span>
                        {size.name}
                      </span>
                      {size.priceDelta !== 0 && (
                        <span className="tabular-nums text-vimdy-text-secondary">
                          {size.priceDelta > 0 ? "+" : "−"}
                          {money(Math.abs(size.priceDelta))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          {isAdd && extras.length > 0 && (
            <section aria-label="Extras">
              <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold uppercase tracking-wide mb-2">
                Extras (puedes elegir varios)
              </p>
              <div className="flex flex-col gap-2">
                {extras.map((extra) => {
                  const checked = extraIds.includes(extra.id);
                  return (
                    <button
                      key={extra.id}
                      type="button"
                      aria-pressed={checked}
                      onClick={() => toggleExtra(extra.id)}
                      className={`${chipBase} h-12 flex items-center justify-between ${
                        checked
                          ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent"
                          : "border-vimdy-border text-vimdy-text hover:border-vimdy-accent/50"
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          aria-hidden="true"
                          className={`w-5 h-5 rounded-vimdy-sm border-2 flex items-center justify-center ${
                            checked ? "border-vimdy-accent bg-vimdy-accent" : "border-vimdy-border"
                          }`}
                        >
                          {checked && <Check size={13} className="text-white" />}
                        </span>
                        {extra.name}
                      </span>
                      {extra.priceDelta !== 0 && (
                        <span className="tabular-nums text-vimdy-text-secondary">
                          {extra.priceDelta > 0 ? "+" : "−"}
                          {money(Math.abs(extra.priceDelta))}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </section>
          )}

          <section aria-label="Notas rápidas">
            <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold uppercase tracking-wide mb-2">
              Notas rápidas para cocina
            </p>
            <div className="flex flex-wrap gap-2">
              {QUICK_NOTE_PRESETS.map((note) => {
                const active = quickNotes.includes(note);
                return (
                  <button
                    key={note}
                    type="button"
                    aria-pressed={active}
                    onClick={() => toggleQuickNote(note)}
                    className={`${chipBase} ${
                      active
                        ? "border-vimdy-warning bg-vimdy-warning/15 text-vimdy-warning-hover"
                        : "border-vimdy-border text-vimdy-text-secondary hover:border-vimdy-warning/60"
                    }`}
                  >
                    {note}
                  </button>
                );
              })}
            </div>
            <input
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              placeholder="Otra nota (ej: sin queso, poco picante)"
              maxLength={120}
              autoComplete="off"
              enterKeyHint="done"
              aria-label="Otra nota para cocina"
              className="mt-3 w-full h-12 px-3.5 rounded-vimdy-md bg-vimdy-background border border-vimdy-border text-vimdy-text text-vimdy-small outline-none focus:border-vimdy-accent transition-colors placeholder:text-vimdy-text-tertiary"
            />
          </section>

          {!isAdd && lineQuantity > 1 && (
            <section aria-label="Aplicar a">
              <p className="text-vimdy-text-secondary text-vimdy-micro font-semibold uppercase tracking-wide mb-2">
                ¿A cuántas unidades?
              </p>
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  aria-pressed={onlyOne}
                  onClick={() => setOnlyOne(true)}
                  className={`${chipBase} ${
                    onlyOne ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent" : "border-vimdy-border text-vimdy-text"
                  }`}
                >
                  Solo a 1
                </button>
                <button
                  type="button"
                  aria-pressed={!onlyOne}
                  onClick={() => setOnlyOne(false)}
                  className={`${chipBase} ${
                    !onlyOne ? "border-vimdy-accent bg-vimdy-accent/10 text-vimdy-accent" : "border-vimdy-border text-vimdy-text"
                  }`}
                >
                  A las {lineQuantity}
                </button>
              </div>
            </section>
          )}
        </div>

        <div className="p-4 border-t border-vimdy-border flex-shrink-0 space-y-3">
          {isAdd && (
            <div className="flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.max(1, current - 1))}
                  aria-label="Menos unidades"
                  className="w-12 h-12 rounded-vimdy-md bg-vimdy-surface-active border border-vimdy-border text-vimdy-text flex items-center justify-center active:scale-95 transition"
                >
                  <Minus size={18} />
                </button>
                <span className="w-10 text-center text-vimdy-text font-black text-xl tabular-nums" aria-live="polite">
                  {quantity}
                </span>
                <button
                  type="button"
                  onClick={() => setQuantity((current) => Math.min(99, current + 1))}
                  aria-label="Más unidades"
                  className="w-12 h-12 rounded-vimdy-md bg-vimdy-accent text-white flex items-center justify-center active:scale-95 transition"
                >
                  <Plus size={18} />
                </button>
              </div>
              <div className="text-right">
                <p className="text-vimdy-text-secondary text-vimdy-micro">Total</p>
                <p className="text-vimdy-text font-black text-xl tabular-nums">{money(unitPrice * quantity)}</p>
              </div>
            </div>
          )}

          <div className="flex gap-2">
            <div className="flex-1">
              <VimdyButton variant="secondary" size="lg" fullWidth onClick={onCancel}>
                Cancelar
              </VimdyButton>
            </div>
            <div className="flex-[1.4]">
              <VimdyButton variant="primary" size="lg" fullWidth onClick={confirm}>
                {isAdd ? "Agregar al pedido" : "Guardar nota"}
              </VimdyButton>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}