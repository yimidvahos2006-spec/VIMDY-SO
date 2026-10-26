import { DuplicateNameError } from "../errors/DuplicateNameError";

/**
 * customerPhoneConflict
 * ---------------------------------------------------------------------------
 * PASO 3 del plan offline: reconocer el error 23505 (violación de índice
 * único) cuando es por TELÉFONO DUPLICADO de un cliente, y calcular la misma
 * llave de unicidad que usa el servidor para encontrar al cliente existente.
 *
 * El servidor compara teléfonos con regexp_replace(phone, '[^0-9A-Za-z]', '')
 * (ver core/domain/customers/phone.ts): "+57 300 123 4567" y "573001234567"
 * son el mismo teléfono; "300 123 4567" NO. Aquí se replica esa llave tal
 * cual, ni más estricta ni más laxa, para no "reconectar" con un cliente
 * que el servidor no considera igual.
 */

/** Llave de unicidad de teléfono idéntica a la del índice del servidor. */
export function customerPhoneKey(phone: string | null | undefined): string {
  return (phone ?? "").replace(/[^0-9A-Za-z]/g, "");
}

const PHONE_HINT = /phone|telefono|tel[eé]fono|e164|celular|mobile/i;

/**
 * true si `error` es un 23505 sobre la tabla de clientes que puede deberse
 * al teléfono.
 *
 * - Con detalle de Postgres (constraint/details/message): solo si menciona
 *   el teléfono; así un choque por otra restricción (p. ej. correo) NO se
 *   confunde y sigue su camino de error de siempre.
 * - Sin detalle: se acepta como posible conflicto de teléfono; quien
 *   resuelve lo verifica de todos modos buscando al cliente existente.
 */
export function isCustomerPhoneConflict(error: unknown): error is DuplicateNameError {
  if (!(error instanceof DuplicateNameError)) return false;
  if (error.entity !== "customers") return false;

  const pg = error.pg;
  if (!pg) return true;

  const haystack = [pg.constraint, pg.details, pg.message].filter(Boolean).join(" ");
  if (haystack.trim() === "") return true;

  return PHONE_HINT.test(haystack);
}