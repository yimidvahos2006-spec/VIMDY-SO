import type { CustomerWithStats } from "../../../core/store/useCustomers";

/**
 * Lógica pura de la lista de Clientes (buscar y ordenar), sacada del
 * componente para poder probarla sin pantalla.
 */

export type SortKey = "name" | "ltv" | "points" | "purchases";
export type SortDir = "asc" | "desc";

export interface SortState {
  readonly key: SortKey;
  readonly dir: SortDir;
}

export const DEFAULT_SORT: SortState = { key: "ltv", dir: "desc" };

/** Clientes registrados que todavía no tienen ninguna compra pagada. */
export function getNeverPurchased(customers: CustomerWithStats[]): CustomerWithStats[] {
  return customers.filter((customer) => customer.purchaseCount === 0);
}

/** Filtra por nombre, teléfono o correo y ordena según la columna elegida. */
export function filterAndSortCustomers(
  customers: CustomerWithStats[],
  search: string,
  sort: SortState
): CustomerWithStats[] {
  let list = customers;

  if (search.trim() !== "") {
    const value = search.trim().toLowerCase();
    list = list.filter(
      (customer) =>
        customer.name.toLowerCase().includes(value) ||
        (customer.phone ?? "").includes(value) ||
        (customer.email ?? "").toLowerCase().includes(value)
    );
  }

  return [...list].sort((a, b) => {
    let diff = 0;
    if (sort.key === "name") diff = a.name.localeCompare(b.name);
    if (sort.key === "ltv") diff = a.ltv - b.ltv;
    if (sort.key === "points") diff = (a.points ?? 0) - (b.points ?? 0);
    if (sort.key === "purchases") diff = a.purchaseCount - b.purchaseCount;
    return sort.dir === "asc" ? diff : -diff;
  });
}

/** Al tocar un encabezado: misma columna invierte el orden; otra columna arranca (nombre asc, el resto desc). */
export function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: key === "name" ? "asc" : "desc" };
}