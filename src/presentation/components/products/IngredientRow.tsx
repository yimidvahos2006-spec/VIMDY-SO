import React from "react";
import { Trash2 } from "lucide-react";
import { Product } from "../../../core/entities/Entities";

/**
 * PASO 3 (eliminar la lógica duplicada de la auditoría):
 * las tres tarjetas que dejan elegir "ingrediente + cantidad" --
 * `IngredientConsumptionEditor` (receta general del producto),
 * `PresentationEditor` (receta propia de un tamaño) y `ExtraEditor`
 * (receta propia de un extra) -- tenían cada una su propia copia del
 * <select> + <input> + unidad + botón "quitar". Mismo comportamiento,
 * mismo shape de datos (`{ productId, quantity }` + callbacks), solo
 * clases de Tailwind ligeramente distintas entre la fila "principal"
 * (`IngredientConsumptionEditor`, con checkbox "Opcional") y las filas
 * "anidadas" dentro de un tamaño/extra (sin ese checkbox, texto más
 * pequeño). Este componente cubre ambos casos con `variant` --
 * no cambia ningún dato, cálculo, ni el contrato con los padres:
 * `RecipeEngine`, `resolveEffectiveRecipe`, `InventoryEngine` y
 * `SalesEngine` no se tocan.
 *
 * `variant="default"`  -> misma apariencia que la fila de
 *   `IngredientConsumptionEditor` (texto sm, ícono 14px, cantidad
 *   w-16, unidad con ancho fijo w-8, admite el checkbox "Opcional").
 * `variant="compact"`  -> misma apariencia que la fila anidada de
 *   `PresentationEditor`/`ExtraEditor` (texto xs, ícono 12px,
 *   cantidad w-20, sin checkbox "Opcional").
 *
 * El checkbox "Opcional" solo existe en la receta general del
 * producto (ver `RecipeIngredientRow.optional` en
 * `IngredientConsumptionEditor.tsx`) -- las recetas propias de un
 * tamaño o un extra no tienen ese campo, así que el checkbox solo se
 * muestra si el padre pasa la prop `optional`.
 */
export interface IngredientRowProps {
  /** id del producto-ingrediente seleccionado en esta fila (o "" si ninguno). */
  productId: string;
  quantity: string;
  /** Catálogo de productos que se pueden elegir como ingrediente (mismo `ingredientOptions` en las 3 tarjetas). */
  ingredientOptions: Product[];
  onProductChange: (value: string) => void;
  onQuantityChange: (value: string) => void;
  onRemove: () => void;

  /**
   * Presente solo en la receta general del producto
   * (`IngredientConsumptionEditor`). Si se omite, la fila no muestra
   * el checkbox "Opcional" -- así se comportan hoy las recetas
   * propias de tamaño/extra.
   */
  optional?: {
    checked: boolean;
    onToggle: () => void;
  };

  /** @default "default" */
  variant?: "default" | "compact";

  /**
   * Fondo de los campos (select/input), para mantener contraste con
   * el contenedor donde vive la fila:
   * - `IngredientConsumptionEditor` vive sobre `bg-vimdy-background` -> campos `bg-vimdy-surface`.
   * - `PresentationEditor` (receta del tamaño) vive sobre `bg-vimdy-surface` -> campos `bg-vimdy-background`.
   * - `ExtraEditor` (receta del extra) vive sobre `bg-vimdy-background` -> campos `bg-vimdy-surface`.
   * @default "surface"
   */
  fieldBackground?: "surface" | "background";

  removeAriaLabel?: string;
}

export function IngredientRow({
  productId,
  quantity,
  ingredientOptions,
  onProductChange,
  onQuantityChange,
  onRemove,
  optional,
  variant = "default",
  fieldBackground = "surface",
  removeAriaLabel = "Quitar ingrediente"
}: IngredientRowProps) {
  const selectedIngredient = ingredientOptions.find((p) => p.id === productId);
  const isCompact = variant === "compact";
  const fieldBgClass = fieldBackground === "background" ? "bg-vimdy-background" : "bg-vimdy-surface";
  const textSizeClass = isCompact ? "text-xs" : "text-sm";
  const trashSize = isCompact ? 12 : 14;

  return (
    <div className={`flex items-center gap-2 ${isCompact ? "" : "px-3 py-2.5"}`}>
      <select
        value={productId}
        onChange={(e) => onProductChange(e.target.value)}
        className={`flex-1 ${isCompact ? "" : "min-w-0"} h-9 px-2 rounded-vimdy-sm ${fieldBgClass} border border-vimdy-border text-vimdy-text ${textSizeClass} ${
          isCompact ? "" : "font-medium"
        } focus:outline-none focus:border-vimdy-recipe`}
      >
        <option value="">Selecciona un ingrediente...</option>
        {ingredientOptions.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name} {p.unit ? `(${p.unit})` : ""}
          </option>
        ))}
      </select>

      <input
        type="number"
        min={0}
        step="0.01"
        value={quantity}
        onChange={(e) => onQuantityChange(e.target.value)}
        placeholder="Cant."
        className={`${isCompact ? "w-20" : "w-16"} h-9 px-2 rounded-vimdy-sm ${fieldBgClass} border border-vimdy-border text-vimdy-text ${textSizeClass} ${
          isCompact ? "" : "text-right"
        } placeholder:text-vimdy-text-tertiary focus:outline-none focus:border-vimdy-recipe`}
      />

      {selectedIngredient?.unit && (
        <span className={`text-vimdy-text-tertiary text-xs ${isCompact ? "" : "w-8"} shrink-0`}>
          {selectedIngredient.unit}
        </span>
      )}

      {optional && (
        <label
          title="El cliente puede pedirlo sin este ingrediente, o agregarlo aparte."
          className="flex items-center gap-1 text-vimdy-text-tertiary text-xs cursor-pointer shrink-0"
        >
          <input
            type="checkbox"
            checked={optional.checked}
            onChange={() => optional.onToggle()}
            className="w-3.5 h-3.5 rounded border-vimdy-border bg-vimdy-background accent-vimdy-recipe"
          />
          Opcional
        </label>
      )}

      <button
        type="button"
        onClick={onRemove}
        aria-label={removeAriaLabel}
        className="h-9 w-9 shrink-0 rounded-vimdy-sm border border-vimdy-danger/30 text-vimdy-danger hover:bg-vimdy-danger/10 flex items-center justify-center"
      >
        <Trash2 size={trashSize} />
      </button>
    </div>
  );
}