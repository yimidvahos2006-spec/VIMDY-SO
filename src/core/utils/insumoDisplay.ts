// src/core/utils/insumoDisplay.ts
//
// Cómo se escribe una cantidad de insumo en pantalla: "12,5 kg", "1 litro",
// "3 unidades". Quita el ruido de coma flotante (9.120000000000001 → 9,12) y
// usa la unidad en palabras del dueño. Solo presentación: no toca el stock.

import { normalizeUnit } from "./unitConversion";

const quantityFormatter = new Intl.NumberFormat("es-CO", { maximumFractionDigits: 3 });

/** Unidades que no cambian al pasar a plural. */
const INVARIANT_UNITS = new Set(["kg", "g", "ml"]);

const PLURALS: Record<string, string> = {
  litro: "litros",
  libra: "libras",
  unidad: "unidades",
  paquete: "paquetes",
  caja: "cajas"
};

/** Número sin ruido de coma flotante y con formato colombiano (coma decimal). */
export function formatInsumoQuantity(quantity: number): string {
  if (!Number.isFinite(quantity)) return "0";
  const clean = Math.round(quantity * 10000) / 10000;
  // -0 se pintaría "-0": se muestra "0".
  return quantityFormatter.format(clean === 0 ? 0 : clean);
}

/** Nombre de la unidad que corresponde a esa cantidad: 1 → "litro", 2 → "litros". */
export function insumoUnitLabel(unit: string | undefined | null, quantity = 2): string {
  const normalized = normalizeUnit(unit);
  if (INVARIANT_UNITS.has(normalized)) return normalized;
  const singular = normalized;
  const plural = PLURALS[normalized] ?? normalized;
  return Math.abs(quantity) === 1 ? singular : plural;
}

/** Cantidad + unidad lista para pintar: "12,5 kg". */
export function formatInsumoAmount(quantity: number, unit: string | undefined | null): string {
  return `${formatInsumoQuantity(quantity)} ${insumoUnitLabel(unit, quantity)}`;
}