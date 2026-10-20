import type { Table } from "../entities/Entities";

/**
 * Busca la(s) mesa(s) que corresponden al número dicho por el mesero.
 *
 * Ojo: el nombre de una mesa es único en todo el negocio, así que el mismo
 * número puede existir en varias zonas ("Mesa 1" y "Mesa 1 · Terraza").
 * Por eso devolvemos una lista: si hay más de una, la UI deja elegir con un
 * toque en vez de adivinar y abrir la mesa equivocada.
 */

/** Nombre sin el sufijo de zona: "Mesa 1 · Terraza" → "Mesa 1". */
function baseName(table: Table): string {
  const zone = table.zone?.trim();
  const suffix = zone ? ` · ${zone}` : "";
  return suffix && table.name.endsWith(suffix)
    ? table.name.slice(0, -suffix.length)
    : table.name;
}

/** Último número del nombre base ("Mesa 12" → 12, "VIP 3" → 3). */
function numberOf(table: Table): number | null {
  const match = baseName(table).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

export function findTablesByNumber(tables: readonly Table[], tableNumber: number): Table[] {
  return tables.filter(table => numberOf(table) === tableNumber);
}