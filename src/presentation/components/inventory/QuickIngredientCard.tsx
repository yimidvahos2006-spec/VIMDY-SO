// src/presentation/components/inventory/QuickIngredientCard.tsx
//
// Tarjeta para crear un ingrediente nuevo SIN salir de la receta.
//
// Problema de UX que resuelve: el campo "Precio de compra" aparecía antes que
// la cantidad y los dueños escribían lo que cuestan los 200 g del plato en
// vez de lo que cuesta el kilo completo del supermercado.
//
// Orden nuevo (de lo más natural a lo secundario):
//   1. Nombre                       -> "¿Qué ingrediente es?"
//   2. Cantidad que lleva el plato  -> "200 [g]"            (PRINCIPAL)
//   3. ¿Cómo lo compras?            -> chips Kilo/Litro/...  (1 toque)
//   4. Precio del formato completo  -> con microcopy y preview en vivo (OPCIONAL)
//
// Es solo presentación: no toca el motor. Devuelve un payload y el padre
// (ProductFormModal) crea el insumo y agrega la fila a la receta.

import React, { useMemo, useRef, useState } from "react";
import { Sparkles, X } from "lucide-react";
import type { Category } from "../../../core/entities/Entities";
import { autoCategoryValue, buildCategoryPickerOptions } from "../../../core/utils/insumoCategoryChoice";
import { MoneyInput } from "../ui/MoneyInput";
import { parseMoneyInput } from "../../../core/utils/parseMoneyInput";
import { compatibleUnits, convertQuantity, normalizeUnit } from "../../../core/utils/unitConversion";
import { parseDecimalInput } from "./importHelpers";
import { sanitizeQuantityInput } from "./recipeFormHelpers";
import { computePackUnitCost, isPackUnit } from "../../../core/utils/packageCost";

export interface QuickIngredientPayload {
  name: string;
  /**
   * Unidad en la que se guarda el insumo (kg, lt, lb, unidad...). El precio es POR esta unidad.
   * Si compró por Paquete o Caja, aquí llega "unidad" y el precio ya viene dividido por
   * las unidades que trae el paquete.
   */
  storedUnit: string;
  /** Precio de compra de UNA `storedUnit` completa. undefined si no lo escribió. */
  purchasePrice?: number;
  /**
   * Categoría que el dueño eligió a mano en el selector ("id" o "new:Nombre").
   * null = no tocó el selector: se usa la sugerida según el nombre.
   */
  categoryChoice: string | null;
  /** Cantidad que lleva el plato, tal cual la escribió ("200"). Puede venir vacía. */
  quantity: string;
  /** Unidad en la que escribió la cantidad ("g"). "" = misma que storedUnit. */
  recipeUnit: string;
}

interface Props {
  initialName: string;
  /** Categorías de insumos que el negocio ya tiene (para el selector del insumo nuevo). */
  categories: readonly Category[];
  creating: boolean;
  onSubmit: (payload: QuickIngredientPayload) => void | Promise<void>;
  onCancel: () => void;
}

/** Formatos de compra más comunes: un toque en vez de un <select> con 8 opciones. */
const PURCHASE_FORMATS: ReadonlyArray<{ value: string; label: string; emoji: string }> = [
  { value: "kg", label: "Kilo", emoji: "⚖️" },
  { value: "lt", label: "Litro", emoji: "🥛" },
  { value: "lb", label: "Libra", emoji: "🧺" },
  { value: "unidad", label: "Unidad", emoji: "🥚" }
];
const OTHER_FORMATS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "paquete", label: "Paquete" },
  { value: "caja", label: "Caja" }
];

/** Cómo se llama el formato completo en lenguaje de tienda. */
function formatNoun(unit: string): { noun: string; article: string; label: string } {
  switch (normalizeUnit(unit)) {
    case "kg": return { noun: "kilo", article: "el", label: "del kilo completo" };
    case "litro": return { noun: "litro", article: "el", label: "del litro completo" };
    case "libra": return { noun: "libra", article: "la", label: "de la libra completa" };
    case "paquete": return { noun: "paquete", article: "el", label: "del paquete completo" };
    case "caja": return { noun: "caja", article: "la", label: "de la caja completa" };
    default: return { noun: "unidad", article: "cada", label: "de cada unidad" };
  }
}

const UNIT_WORD: Record<string, string> = { g: "gramos", kg: "kilos", libra: "libras", ml: "mililitros", litro: "litros", unidad: "unidades" };
const money = (v: number) => `$${Math.round(v).toLocaleString("es-CO")}`;

const fieldBase =
  "h-11 px-3 rounded-vimdy-sm bg-vimdy-surface border border-vimdy-border text-vimdy-text text-sm placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe";

export function QuickIngredientCard({ initialName, categories, creating, onSubmit, onCancel }: Props) {
  const [name, setName] = useState(initialName);
  // null = automática (sigue al nombre); si la cambia a mano, se respeta.
  const [manualCategory, setManualCategory] = useState<string | null>(null);
  const [storedUnit, setStoredUnit] = useState("kg");
  const [quantity, setQuantity] = useState("");
  const [recipeUnit, setRecipeUnit] = useState("g");
  const [price, setPrice] = useState("");
  // Solo para Paquete / Caja: cuántas unidades trae y cuánto cuesta el paquete completo.
  const [packUnits, setPackUnits] = useState("");

  const qtyRef = useRef<HTMLInputElement>(null);
  const priceWrapRef = useRef<HTMLDivElement>(null);

  const isPack = isPackUnit(storedUnit);
  // Si compra por paquete/caja, el insumo se guarda y se gasta en UNIDADES sueltas (tajadas, huevos...).
  const effectiveUnit = isPack ? "unidad" : storedUnit;
  const unitChoices = useMemo(() => compatibleUnits(effectiveUnit), [effectiveUnit]);
  const { noun, article, label } = formatNoun(storedUnit);
  const isCountable = !["kg", "litro", "libra"].includes(normalizeUnit(effectiveUnit));
  const packCost = useMemo(() => (isPack ? computePackUnitCost(packUnits, price) : null), [isPack, packUnits, price]);
  const packReady = !isPack || packCost !== null;

  // Este selector solo existe porque el insumo es NUEVO; uno que ya existe nunca llega aquí.
  const categoryOptions = useMemo(() => buildCategoryPickerOptions(categories), [categories]);
  const nameReady = name.trim().length >= 2;
  const categoryValue = manualCategory ?? (nameReady ? autoCategoryValue(name, categories) : "");

  // Al cambiar el formato de compra, la unidad de la receta pasa a la más natural:
  // kilo/libra -> gramos, litro -> mililitros, el resto -> la misma unidad.
  function pickFormat(value: string) {
    setStoredUnit(value);
    const norm = isPackUnit(value) ? "unidad" : normalizeUnit(value);
    setRecipeUnit(norm === "kg" || norm === "libra" ? "g" : norm === "litro" ? "ml" : norm);
  }

  // Preview en vivo: demuestra que VIMDY hace la conversión, no el usuario.
  const preview = useMemo(() => {
    const qty = parseDecimalInput(quantity);
    // Paquete/caja: el precio por unidad sale de dividir; si no, es el precio escrito.
    const p = isPack ? (packCost?.unitCost ?? Number.NaN) : parseMoneyInput(price);
    if (!Number.isFinite(qty) || qty <= 0 || !Number.isFinite(p) || p <= 0) return null;
    const converted = convertQuantity(qty, recipeUnit, effectiveUnit);
    if (converted === null) return null;
    return { cost: converted * p, qty, unitWord: UNIT_WORD[normalizeUnit(recipeUnit)] ?? recipeUnit };
  }, [quantity, price, recipeUnit, effectiveUnit, isPack, packCost]);

  // Sanity check amistoso (no bloquea): precio por kilo de un solo dígito suele ser el precio de los gramos.
  const priceLooksTooLow = (() => {
    const p = parseMoneyInput(price);
    return !isPack && Number.isFinite(p) && p > 0 && p < 100 && !isCountable;
  })();

  function submit() {
    const trimmed = name.trim();
    if (!trimmed || creating) return;
    // Paquete/caja: sin los dos datos no se puede calcular el costo, así que no se crea.
    if (isPack) {
      if (!packCost) return;
      void onSubmit({
        name: trimmed,
        categoryChoice: manualCategory,
        storedUnit: "unidad",
        purchasePrice: packCost.unitCost,
        quantity: quantity.trim(),
        recipeUnit: ""
      });
      return;
    }
    const parsedPrice = price.trim() ? parseMoneyInput(price) : undefined;
    void onSubmit({
      name: trimmed,
      categoryChoice: manualCategory,
      storedUnit,
      purchasePrice: parsedPrice !== undefined && Number.isFinite(parsedPrice) && parsedPrice > 0 ? parsedPrice : undefined,
      quantity: quantity.trim(),
      recipeUnit: normalizeUnit(recipeUnit) === normalizeUnit(storedUnit) ? "" : recipeUnit
    });
  }

  return (
    <div
      className="p-3 sm:p-4 rounded-vimdy-md bg-vimdy-recipe/5 border border-vimdy-recipe/20 space-y-3"
      onKeyDown={(e) => {
        if (e.key === "Escape") onCancel();
      }}
    >
      {/* 1 · Nombre + categoría del insumo nuevo (se sugiere sola según el nombre) */}
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              qtyRef.current?.focus();
            }
          }}
          placeholder="¿Qué ingrediente es? (ej: Arroz, Leche...)"
          aria-label="Nombre del ingrediente"
          className={`w-full sm:flex-1 ${fieldBase}`}
        />
        <select
          value={categoryValue}
          onChange={(e) => setManualCategory(e.target.value || null)}
          aria-label="Categoría del insumo"
          title="Categoría del insumo"
          className={`w-full sm:w-44 shrink-0 text-vimdy-text-secondary ${fieldBase}`}
        >
          <option value="" disabled hidden>
            Categoría
          </option>
          {categoryOptions.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </div>

      {/* 2 · Cantidad que lleva el plato (PRINCIPAL) */}
      <div>
        <label className="block text-vimdy-text text-xs font-semibold mb-1.5">
          ¿Cuánto lleva <span className="text-vimdy-recipe">cada plato</span>?
        </label>
        <div className="flex items-center gap-2">
          <input
            ref={qtyRef}
            type="text"
            inputMode="decimal"
            value={quantity}
            onChange={(e) => setQuantity(sanitizeQuantityInput(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                priceWrapRef.current?.querySelector<HTMLInputElement>("input")?.focus();
              }
            }}
            placeholder="200"
            aria-label="Cantidad que lleva el plato"
            className={`w-28 text-lg font-semibold ${fieldBase} h-12`}
          />
          {unitChoices.length > 1 ? (
            <div role="radiogroup" aria-label="Unidad de la cantidad" className="flex gap-1">
              {unitChoices.map((u) => (
                <button
                  key={u}
                  type="button"
                  role="radio"
                  aria-checked={recipeUnit === u}
                  onClick={() => setRecipeUnit(u)}
                  className={`h-12 min-w-12 px-3 rounded-vimdy-sm border text-sm font-medium transition ${
                    recipeUnit === u
                      ? "bg-vimdy-recipe text-white border-vimdy-recipe"
                      : "bg-vimdy-surface text-vimdy-text-secondary border-vimdy-border hover:bg-vimdy-surface-hover"
                  }`}
                >
                  {u === "libra" ? "lb" : u === "litro" ? "lt" : u}
                </button>
              ))}
            </div>
          ) : (
            <span className="text-vimdy-text-secondary text-sm">{normalizeUnit(effectiveUnit)}</span>
          )}
        </div>
      </div>

      {/* 3 · ¿Cómo lo compras? */}
      <div>
        <p className="text-vimdy-text-secondary text-xs font-medium mb-1.5">¿Cómo lo compras?</p>
        <div className="flex flex-wrap gap-1.5">
          {PURCHASE_FORMATS.map((f) => {
            const active = normalizeUnit(storedUnit) === normalizeUnit(f.value);
            return (
              <button
                key={f.value}
                type="button"
                aria-pressed={active}
                onClick={() => pickFormat(f.value)}
                className={`h-9 px-3 rounded-full border text-xs font-medium transition flex items-center gap-1.5 ${
                  active
                    ? "bg-vimdy-recipe/15 text-vimdy-recipe border-vimdy-recipe/50"
                    : "bg-vimdy-surface text-vimdy-text-secondary border-vimdy-border hover:bg-vimdy-surface-hover"
                }`}
              >
                <span aria-hidden>{f.emoji}</span>
                {f.label}
              </button>
            );
          })}
          <select
            value={OTHER_FORMATS.some((o) => o.value === storedUnit) ? storedUnit : ""}
            onChange={(e) => e.target.value && pickFormat(e.target.value)}
            aria-label="Otro formato de compra"
            className="h-9 px-2 rounded-full bg-vimdy-surface border border-vimdy-border text-vimdy-text-secondary text-xs focus:outline-none focus:border-vimdy-recipe"
          >
            <option value="">Otro…</option>
            {OTHER_FORMATS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* 4 · Paquete / Caja: dos datos obligatorios, VIMDY divide */}
      {isPack && (
        <div className="rounded-vimdy-sm bg-vimdy-surface/70 border border-vimdy-border-subtle p-3 space-y-3">
          <div>
            <label className="block text-vimdy-text text-xs font-semibold mb-1.5">
              Unidades que trae {article} {noun} <span className="text-vimdy-danger">*</span>
            </label>
            <input
              type="text"
              inputMode="decimal"
              value={packUnits}
              onChange={(e) => setPackUnits(sanitizeQuantityInput(e.target.value))}
              placeholder="Ej: 40"
              aria-label={`Unidades que trae ${article} ${noun}`}
              aria-required="true"
              className={`w-full ${fieldBase}`}
            />
            <p className="text-vimdy-text-tertiary text-xs mt-1">Cuenta cuántas piezas sueltas vienen adentro (tajadas, huevos, bolsitas...).</p>
          </div>
          <div ref={priceWrapRef}>
            <label className="block text-vimdy-text text-xs font-semibold mb-1.5">
              Precio total {label.replace(" completo", "").replace(" completa", "")} <span className="text-vimdy-danger">*</span>
            </label>
            <MoneyInput
              value={price}
              onValueChange={setPrice}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  submit();
                }
              }}
              placeholder="Ej: 16.000"
              aria-label={`Precio total ${label}`}
              aria-required="true"
              className={`w-full ${fieldBase}`}
            />
          </div>
          {packCost ? (
            <p className="text-vimdy-accent text-xs flex items-center gap-1.5" aria-live="polite">
              <Sparkles size={12} className="shrink-0" />
              Cada unidad te cuesta <strong>≈ {money(packCost.unitCost)}</strong> ({money(packCost.packPrice)} ÷ {packCost.units.toLocaleString("es-CO")})
            </p>
          ) : (
            <p className="text-vimdy-text-tertiary text-xs" aria-live="polite">
              Escribe las dos cosas y VIMDY calcula el costo de cada unidad por ti.
            </p>
          )}
          {preview && (
            <p className="text-vimdy-accent text-xs flex items-center gap-1.5" aria-live="polite">
              <Sparkles size={12} className="shrink-0" />
              {preview.qty.toLocaleString("es-CO")} {preview.unitWord} de {name.trim() || "este ingrediente"} te cuestan{" "}
              <strong>≈ {money(preview.cost)}</strong> por plato
            </p>
          )}
        </div>
      )}

      {/* 4 · Precio del formato COMPLETO (secundario, con ayuda) */}
      {!isPack && (
      <div className="rounded-vimdy-sm bg-vimdy-surface/70 border border-vimdy-border-subtle p-3 space-y-2">
        <div className="flex items-center justify-between gap-2">
          <label className="text-vimdy-text-secondary text-xs font-medium">
            Precio {label}{" "}
            <span className="text-vimdy-text-tertiary font-normal">(opcional)</span>
          </label>
        </div>
        <div ref={priceWrapRef}>
        <MoneyInput
          value={price}
          onValueChange={setPrice}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ej: 6.500"
          aria-label={`Precio de compra de ${article === "cada" ? "cada" : article} ${noun}`}
          className={`w-full ${fieldBase}`}
        />
        </div>
        <p className="text-vimdy-text-tertiary text-xs leading-relaxed">
          {isCountable
            ? `Escribe cuánto te cuesta ${article === "cada" ? "cada" : article} ${noun}. VIMDY lo multiplica por las que lleva el plato.`
            : `Escribe cuánto te costó ${article} ${noun} completo en el supermercado. VIMDY calcula solo los ${
                UNIT_WORD[normalizeUnit(recipeUnit)] ?? "gramos"
              }.`}
        </p>

        {preview && (
          <p className="text-vimdy-accent text-xs flex items-center gap-1.5" aria-live="polite">
            <Sparkles size={12} className="shrink-0" />
            {preview.qty.toLocaleString("es-CO")} {preview.unitWord} de {name.trim() || "este ingrediente"} te cuestan{" "}
            <strong>≈ {money(preview.cost)}</strong> por plato
          </p>
        )}
        {priceLooksTooLow && (
          <p className="text-vimdy-text-tertiary text-xs">
            💡 Recuerda: es el precio del {noun} completo, no de los {UNIT_WORD[normalizeUnit(recipeUnit)] ?? "gramos"} del plato.
          </p>
        )}
      </div>
      )}

      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={submit}
          disabled={creating || !name.trim() || !packReady}
          className="flex-1 h-11 px-4 rounded-vimdy-sm bg-vimdy-recipe text-white hover:bg-vimdy-recipe/90 disabled:opacity-40 transition text-sm font-medium whitespace-nowrap"
        >
          {creating ? "Creando..." : "Crear y agregar a la receta"}
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancelar"
          className="h-11 w-11 shrink-0 rounded-vimdy-sm border border-vimdy-border text-vimdy-text-secondary hover:bg-vimdy-surface flex items-center justify-center"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}