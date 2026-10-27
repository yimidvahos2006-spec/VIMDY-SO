// src/core/utils/packageCost.ts
//
// Costo por unidad cuando el insumo se compra en Paquete o Caja.
//
// Ejemplo: un paquete trae 40 tajadas y cuesta $16.000 -> cada tajada cuesta $400.
// El usuario nunca hace la división: VIMDY la hace y guarda el insumo en
// "unidad" con ese costo, así la receta, el costo del plato y el inventario
// quedan exactos con los motores que ya existen.

import { normalizeUnit } from "./unitConversion";
import { parseMoneyInput } from "./parseMoneyInput";

/** ¿Esta unidad de compra es un paquete o una caja? */
export function isPackUnit(unit: string | undefined | null): boolean {
  const u = normalizeUnit(unit);
  return u === "paquete" || u === "caja";
}

/** Convierte lo escrito en "unidades que trae" a número entero positivo (acepta "40", "40 ", "40,0"). */
export function parsePackUnits(raw: string): number {
  const text = String(raw ?? "").replace(/\s/g, "").replace(",", ".");
  if (!/^\d+(\.\d+)?$/.test(text)) return Number.NaN;
  return Number(text);
}

export interface PackCostResult {
  /** Costo de UNA unidad suelta (sin redondear al peso, para no perder exactitud). */
  unitCost: number;
  units: number;
  packPrice: number;
}

/**
 * Divide el precio del paquete entre las unidades que trae.
 * Devuelve null si falta algún dato o no es válido (cero, negativo, texto).
 */
export function computePackUnitCost(
  unitsRaw: string | number,
  packPriceRaw: string | number
): PackCostResult | null {
  const units = typeof unitsRaw === "number" ? unitsRaw : parsePackUnits(unitsRaw);
  const packPrice = parseMoneyInput(packPriceRaw);
  if (!Number.isFinite(units) || units <= 0) return null;
  if (!Number.isFinite(packPrice) || packPrice <= 0) return null;
  // 4 decimales: suficiente para $16.000 / 3 = 5333,3333 sin arrastrar basura de punto flotante.
  const unitCost = Math.round((packPrice / units) * 1e4) / 1e4;
  return { unitCost, units, packPrice };
}