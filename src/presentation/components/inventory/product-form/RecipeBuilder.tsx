// src/presentation/components/inventory/product-form/RecipeBuilder.tsx
//
// "¿Qué lleva?": buscador de ingredientes + filas con cantidad y unidad.
// Si el ingrediente no existe, se crea ahí mismo (tarjeta inline) sin salir del plato.

import React, { useId } from "react";
import { Plus, Search } from "lucide-react";
import type { Product } from "../../../../core/entities/Entities";
import { normalizeUnit } from "../../../../core/utils/unitConversion";
import { QuickIngredientCard } from "../QuickIngredientCard";
import { money } from "../inventoryShared";
import { RecipeRow, unitLabel } from "./RecipeRow";
import type { RecipeSummary } from "./recipeSummary";
import type { RecipeBuilderState } from "./useRecipeBuilder";

interface Props {
  builder: RecipeBuilderState;
  allProducts: Product[];
  summary: RecipeSummary | null;
  loading: boolean;
}

function marginTone(percent: number): string {
  if (percent < 0) return "text-vimdy-danger";
  if (percent < 30) return "text-vimdy-warning";
  return "text-vimdy-success";
}

export function RecipeBuilder({ builder, allProducts, summary, loading }: Props) {
  const listId = useId();
  const {
    rows,
    query,
    suggestOpen,
    activeIndex,
    suggestions,
    canCreate,
    quickName
  } = builder;

  const typed = query.trim();
  const showList = suggestOpen && quickName === null && (suggestions.length > 0 || canCreate);
  const createIndex = suggestions.length;
  const byId = new Map(allProducts.map((p) => [p.id, p]));

  return (
    <section aria-labelledby={`${listId}-title`} className="space-y-vimdy-sm">
      <div>
        <h3 id={`${listId}-title`} className="text-vimdy-small font-semibold text-vimdy-text">
          ¿Qué lleva?
        </h3>
        <p className="text-vimdy-micro font-normal text-vimdy-text-tertiary">
          Cada ingrediente se descuenta del inventario al vender el plato.
        </p>
      </div>

      {/* Buscador */}
      <div className="relative">
        <Search
          size={16}
          aria-hidden="true"
          className="pointer-events-none absolute left-vimdy-md top-1/2 -translate-y-1/2 text-vimdy-text-tertiary"
        />
        <input
          ref={builder.searchRef}
          type="text"
          role="combobox"
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-opt-${activeIndex}` : undefined}
          value={query}
          disabled={loading || quickName !== null}
          onChange={(e) => builder.setQuery(e.target.value)}
          onFocus={() => builder.setSuggestOpen(true)}
          onBlur={() => window.setTimeout(() => builder.setSuggestOpen(false), 120)}
          onKeyDown={builder.onSearchKeyDown}
          placeholder={loading ? "Cargando insumos…" : "Busca o escribe un ingrediente (ej. Pan, Carne)"}
          autoComplete="off"
          className="h-11 w-full rounded-vimdy-sm border border-vimdy-border bg-vimdy-surface pl-10 pr-vimdy-md text-vimdy-small text-vimdy-text outline-none transition-colors duration-vimdy-fast placeholder:text-vimdy-text-tertiary focus:border-vimdy-accent focus:ring-2 focus:ring-vimdy-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
        />

        {showList && (
          <ul
            id={listId}
            role="listbox"
            aria-label="Ingredientes"
            className="absolute z-20 mt-vimdy-xs max-h-64 w-full overflow-y-auto rounded-vimdy-md border border-vimdy-border bg-vimdy-surface py-vimdy-xs shadow-vimdy-md"
          >
            {suggestions.map((p, i) => (
              <li
                key={p.id}
                id={`${listId}-opt-${i}`}
                role="option"
                aria-selected={i === activeIndex}
                // mouseDown (no click): se ejecuta antes del blur del buscador.
                onMouseDown={(e) => {
                  e.preventDefault();
                  builder.addIngredient(p.id);
                }}
                onMouseEnter={() => builder.setActiveIndex(i)}
                className={`flex cursor-pointer items-center justify-between gap-vimdy-sm px-vimdy-md py-vimdy-sm text-vimdy-small ${
                  i === activeIndex ? "bg-vimdy-surface-active" : ""
                }`}
              >
                <span className="truncate text-vimdy-text">{p.name}</span>
                <span className="shrink-0 text-vimdy-micro font-normal text-vimdy-text-tertiary">
                  {unitLabel(normalizeUnit(p.unit))}
                </span>
              </li>
            ))}
            {canCreate && (
              <li
                id={`${listId}-opt-${createIndex}`}
                role="option"
                aria-selected={activeIndex === createIndex}
                onMouseDown={(e) => {
                  e.preventDefault();
                  builder.openQuickCreate();
                }}
                onMouseEnter={() => builder.setActiveIndex(createIndex)}
                className={`flex cursor-pointer items-center gap-vimdy-sm px-vimdy-md py-vimdy-sm text-vimdy-small text-vimdy-accent-hover ${
                  activeIndex === createIndex ? "bg-vimdy-surface-active" : ""
                } ${suggestions.length > 0 ? "border-t border-vimdy-border-subtle" : ""}`}
              >
                <Plus size={16} aria-hidden="true" />
                <span className="truncate">
                  Crear “{typed}” como ingrediente nuevo
                </span>
              </li>
            )}
          </ul>
        )}
      </div>

      {/* Crear ingrediente al vuelo: aparece aquí mismo, sin tapar el formulario */}
      {quickName !== null && (
        <div
          onKeyDown={(e) => {
            // Escape cierra solo esta tarjeta, no el formulario completo.
            if (e.key === "Escape") e.stopPropagation();
          }}
        >
          <QuickIngredientCard
            initialName={quickName}
            creating={builder.creating}
            onSubmit={builder.submitQuickCreate}
            onCancel={builder.closeQuickCreate}
          />
        </div>
      )}

      {/* Filas */}
      {rows.length > 0 ? (
        <ul className="divide-y divide-vimdy-border-subtle border-y border-vimdy-border-subtle">
          {rows.map((row) => (
            <RecipeRow
              key={row.rowId}
              row={row}
              ingredient={byId.get(row.productId)}
              invalid={builder.invalidRowId === row.rowId}
              onChange={(field, value) => builder.updateRow(row.rowId, field, value)}
              onRemove={() => builder.removeRow(row.rowId)}
              onEnter={builder.focusSearch}
            />
          ))}
        </ul>
      ) : (
        quickName === null && (
          <p className="rounded-vimdy-md border border-dashed border-vimdy-border px-vimdy-md py-vimdy-md text-center text-vimdy-small text-vimdy-text-tertiary">
            Aún sin ingredientes. Escribe uno arriba y toca Enter.
            <br />
            Si no llevas receta, el plato se vende igual pero no descuenta inventario.
          </p>
        )
      )}

      {/* Costo y ganancia en vivo */}
      {summary && (
        <div
          role="status"
          className="flex flex-wrap items-baseline justify-between gap-x-vimdy-md gap-y-vimdy-xs rounded-vimdy-md bg-vimdy-surface px-vimdy-md py-vimdy-sm"
        >
          <span className="text-vimdy-small text-vimdy-text-secondary">
            Te cuesta <span className="tabular-nums text-vimdy-text">{money(summary.cost)}</span>
          </span>
          <span className={`text-vimdy-small ${marginTone(summary.marginPercent)}`}>
            Ganas <span className="font-semibold tabular-nums">{money(summary.profit)}</span>
            <span className="tabular-nums"> ({Math.round(summary.marginPercent)}%)</span>
          </span>
          {summary.costUnreliable && (
            <span className="basis-full text-vimdy-micro font-normal text-vimdy-warning">
              A algún insumo le falta el precio de compra: el costo real puede ser mayor.
            </span>
          )}
        </div>
      )}
    </section>
  );
}