/**
 * weightUnits.ts
 * ---------------------------------------------------------------------------
 * BLOQUEANTE (auditoría Fase 2 — rama Supermercado): Product.unit (ver
 * Entities.ts) existía como texto puramente informativo — se mostraba en
 * Compras/Inventario pero la Caja nunca lo leía. Un producto marcado "kg"
 * se vendía igual que uno marcado "unidad": cantidad entera, sin forma de
 * cobrar por el peso real que el cajero pone en la báscula.
 *
 * Este archivo es la única fuente de verdad sobre qué unidades de
 * UNIT_OPTIONS (ver InventoryDashboard.tsx) representan una cantidad
 * VARIABLE que hay que pesar/medir en el momento de vender (kg, g, libra,
 * litro, ml) en vez de una cantidad discreta que se cuenta (unidad,
 * servicio, paquete, caja). PosTopBar/PosProducts la consultan para decidir
 * si un producto se agrega directo al carrito (cantidad 1) o si primero hay
 * que abrir el modal de báscula (ver weightEntryStore/PosWeightEntryModal).
 */

/** Unidades de Product.unit que requieren pesar/medir antes de vender. */
export const VARIABLE_QUANTITY_UNITS: readonly string[] = ["kg", "g", "libra", "litro", "ml"];

/** true si este producto se vende por peso/volumen (báscula) y no por unidad entera. */
export function isVariableQuantityUnit(unit?: string): boolean {
  if (!unit) return false;
  return VARIABLE_QUANTITY_UNITS.includes(unit);
}

/**
 * Paso con el que +/- ajustan la cantidad de un producto pesado en el
 * carrito (ver cartStore.increase/decrease). 0.1 kg (100 g) es un
 * incremento manejable a mano; la báscula real (cuando exista) sigue
 * pudiendo escribir cualquier valor exacto vía weightEntryStore/setQuantity,
 * este paso solo aplica a los botones +/-.
 */
export const WEIGHT_STEP = 0.1;

/**
 * Redondea a 3 decimales (gramo exacto en kg, mililitro exacto en litro)
 * para evitar arrastrar errores de coma flotante (ej. 0.1 + 0.2 =
 * 0.30000000000000004) en cada +/- o suma de la misma línea del carrito.
 */
export function roundWeight(value: number): number {
  return Math.round(value * 1000) / 1000;
}