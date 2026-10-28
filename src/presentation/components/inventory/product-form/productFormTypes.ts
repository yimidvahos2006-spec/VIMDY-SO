// src/presentation/components/inventory/product-form/productFormTypes.ts
//
// Tipos y constantes compartidos por el formulario "Plato / Receta".

/** Una fila de la receta tal como se edita en pantalla (todo texto, como lo escribe la persona). */
export interface RecipeRowDraft {
  rowId: string;
  productId: string;
  /** Cantidad escrita, ej. "150" o "0,5". */
  quantity: string;
  /** Unidad elegida ("g", "kg"...). "" = la unidad con la que se guarda el insumo. */
  unit: string;
  /** Se conserva al editar (queso opcional, etc.). El formulario simple no lo muestra. */
  optional: boolean;
}

/** Estación por defecto de VIMDY cuando la categoría no define otra. */
export const DEFAULT_STATION = "Cocina";

/** Estaciones que siempre se ofrecen, aunque el negocio todavía no tenga ninguna creada. */
export const SUGGESTED_STATIONS: readonly string[] = [DEFAULT_STATION, "Barra"];

/** Valor del selector de categoría para "crear una nueva". */
export const NEW_CATEGORY_VALUE = "__nueva__";