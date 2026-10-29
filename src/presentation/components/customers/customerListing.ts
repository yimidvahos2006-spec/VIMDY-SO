import type { CustomerWithStats } from "../../../core/store/useCustomers";

/**
 * Lógica pura de la lista de Clientes (buscar y ordenar), sacada del
 * componente para poder probarla sin pantalla.
 *
 * BUSCADOR INSTANTÁNEO
 * ---------------------------------------------------------------------------
 * - Se arma UN índice por lista de clientes (buildCustomerSearchIndex): el
 *   nombre ya sin tildes ni mayúsculas, el teléfono solo con dígitos y el
 *   correo en minúsculas. Así cada tecla solo compara texto ya preparado, sin
 *   volver a normalizar a todos los clientes.
 * - Se puede escribir por partes: "ana 300" encuentra a Ana con teléfono
 *   que contenga 300. Cada parte tiene que coincidir con el cliente.
 * - Teléfono: da igual si lo escriben "300 123 4567", "300-123-4567" o
 *   "+57 300 123 4567"; se compara solo por dígitos y sin el indicativo 57.
 * - Nombre: las coincidencias al INICIO de una palabra ("an" → Ana, María
 *   Anaya) salen primero que las que están en medio ("an" → Susana).
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

/** Minúsculas y sin tildes: "Pérez" y "perez" son lo mismo al buscar. */
export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Deja solo los dígitos de un teléfono y quita el indicativo de Colombia (57). */
export function normalizePhoneDigits(value: string): string {
  const digits = value.replace(/\D/g, "");
  // Número completo con indicativo: 57 + 10 dígitos (celular) o 57 + 7-8 (fijo).
  if (digits.startsWith("57") && digits.length >= 10 && digits.length <= 12) {
    return digits.slice(2);
  }
  return digits;
}

interface CustomerSearchEntry {
  readonly customer: CustomerWithStats;
  /** Nombre normalizado completo. */
  readonly name: string;
  /** Palabras del nombre normalizadas (para coincidir "al inicio de una palabra"). */
  readonly words: readonly string[];
  /** Solo dígitos, sin indicativo. */
  readonly phone: string;
  readonly email: string;
}

export type CustomerSearchIndex = readonly CustomerSearchEntry[];

/** Prepara una sola vez el texto de cada cliente para que cada tecla sea barata. */
export function buildCustomerSearchIndex(customers: readonly CustomerWithStats[]): CustomerSearchIndex {
  return customers.map((customer) => {
    const name = normalizeSearchText(customer.name);
    return {
      customer,
      name,
      words: name.split(/\s+/).filter(Boolean),
      phone: normalizePhoneDigits(customer.phone ?? ""),
      email: (customer.email ?? "").trim().toLowerCase()
    };
  });
}

interface SearchToken {
  readonly text: string;
  /** Dígitos de la parte buscada (vacío si no escribió ningún número). */
  readonly digits: string;
}

function parseQuery(search: string): SearchToken[] {
  const raw = search.trim();
  if (raw === "") return [];

  // Un teléfono escrito con espacios o guiones ("300 123 4567", "+57 300-123")
  // se junta en un solo bloque de dígitos, para no exigirle al usuario escribir pegado.
  const onlyPhoneChars = /^[+\d\s().-]+$/.test(raw) && /\d/.test(raw);
  if (onlyPhoneChars) {
    // "+57 300" aún incompleto: el indicativo se quita aunque falten dígitos.
    const digits = /^\+\s*57/.test(raw) ? raw.replace(/\D/g, "").slice(2) : normalizePhoneDigits(raw);
    return digits === "" ? [] : [{ text: digits, digits }];
  }

  return normalizeSearchText(raw)
    .split(/\s+/)
    .filter(Boolean)
    .map((text) => ({ text, digits: text.replace(/\D/g, "") }));
}

/**
 * Qué tan buena es la coincidencia de una parte con un cliente:
 * 0 = no coincide, 1 = coincide en medio de un texto, 2 = coincide al inicio
 * (de una palabra del nombre, del teléfono o del correo).
 */
function scoreToken(entry: CustomerSearchEntry, token: SearchToken): 0 | 1 | 2 {
  let best: 0 | 1 | 2 = 0;

  if (entry.words.some((word) => word.startsWith(token.text))) return 2;
  if (entry.name.includes(token.text)) best = 1;

  if (token.digits !== "" && entry.phone !== "") {
    if (entry.phone.startsWith(token.digits)) return 2;
    if (entry.phone.includes(token.digits)) best = 1;
  }

  if (entry.email !== "") {
    if (entry.email.startsWith(token.text)) return 2;
    if (entry.email.includes(token.text)) best = 1;
  }

  return best;
}

/**
 * Busca sobre el índice ya armado. Devuelve los clientes que coinciden con
 * TODAS las partes escritas; con búsqueda vacía devuelve todos, sin cambios.
 * `rank` va de 0 (mejor: todas las partes al inicio) hacia arriba.
 */
export function searchCustomerIndex(
  index: CustomerSearchIndex,
  search: string
): { customer: CustomerWithStats; rank: number }[] {
  const tokens = parseQuery(search);
  if (tokens.length === 0) {
    return index.map((entry) => ({ customer: entry.customer, rank: 0 }));
  }

  const results: { customer: CustomerWithStats; rank: number }[] = [];
  for (const entry of index) {
    let rank = 0;
    let matches = true;
    for (const token of tokens) {
      const score = scoreToken(entry, token);
      if (score === 0) {
        matches = false;
        break;
      }
      if (score === 1) rank = 1;
    }
    if (matches) results.push({ customer: entry.customer, rank });
  }
  return results;
}

function compareBySort(a: CustomerWithStats, b: CustomerWithStats, sort: SortState): number {
  let diff = 0;
  if (sort.key === "name") diff = a.name.localeCompare(b.name, "es");
  if (sort.key === "ltv") diff = a.ltv - b.ltv;
  if (sort.key === "points") diff = (a.points ?? 0) - (b.points ?? 0);
  if (sort.key === "purchases") diff = a.purchaseCount - b.purchaseCount;
  return sort.dir === "asc" ? diff : -diff;
}

/**
 * Filtra con el índice y ordena. Con una búsqueda activa, las coincidencias
 * "al inicio" van primero y dentro de cada grupo manda la columna elegida.
 */
export function filterAndSortWithIndex(
  index: CustomerSearchIndex,
  search: string,
  sort: SortState
): CustomerWithStats[] {
  const found = searchCustomerIndex(index, search);
  found.sort((a, b) => a.rank - b.rank || compareBySort(a.customer, b.customer, sort));
  return found.map((item) => item.customer);
}

/** Filtra por nombre, teléfono o correo y ordena según la columna elegida. */
export function filterAndSortCustomers(
  customers: CustomerWithStats[],
  search: string,
  sort: SortState
): CustomerWithStats[] {
  return filterAndSortWithIndex(buildCustomerSearchIndex(customers), search, sort);
}

/** Al tocar un encabezado: misma columna invierte el orden; otra columna arranca (nombre asc, el resto desc). */
export function nextSortState(current: SortState, key: SortKey): SortState {
  if (current.key === key) {
    return { key, dir: current.dir === "asc" ? "desc" : "asc" };
  }
  return { key, dir: key === "name" ? "asc" : "desc" };
}