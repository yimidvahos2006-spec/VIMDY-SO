import type { Table } from "../entities/Entities";

/**
 * Orden natural de mesas dentro de una zona: 1, 2, 3 … 10, 11 (no 1, 10, 11, 2).
 * Se usa el número final del nombre visible; sin número, va al final en orden alfabético.
 */

/** Nombre visible: quita el sufijo " · Zona" que se añade cuando el nombre ya existía en otra zona. */
export function tableDisplayName(table: Pick<Table, "name" | "zone">): string {
  const zone = table.zone?.trim();
  const suffix = zone ? ` · ${zone}` : "";
  return suffix && table.name.endsWith(suffix) ? table.name.slice(0, -suffix.length) : table.name;
}

/** Número final del nombre visible ("Mesa 12" -> 12) o null si no tiene. */
export function tableNumber(table: Pick<Table, "name" | "zone">): number | null {
  const match = tableDisplayName(table).match(/(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

export function compareTables(a: Pick<Table, "name" | "zone">, b: Pick<Table, "name" | "zone">): number {
  const na = tableNumber(a);
  const nb = tableNumber(b);

  if (na !== null && nb !== null && na !== nb) return na - nb;
  if (na !== null && nb === null) return -1;
  if (na === null && nb !== null) return 1;

  return tableDisplayName(a).localeCompare(tableDisplayName(b), "es", { numeric: true, sensitivity: "base" });
}

/** Devuelve una copia ordenada; no modifica el arreglo original. */
export function sortTables<T extends Pick<Table, "name" | "zone">>(tables: readonly T[]): T[] {
  return [...tables].sort(compareTables);
}