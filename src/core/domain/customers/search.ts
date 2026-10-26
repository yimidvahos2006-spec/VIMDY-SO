// src/core/domain/customers/search.ts
/* ===========================================================================
   Búsqueda rápida de clientes para Caja — dominio puro (sin I/O).
   ---------------------------------------------------------------------------
   Objetivo: que el cajero encuentre al cliente escribiendo 2-3 caracteres.
   - Ignora mayúsculas y tildes ("jose" encuentra "José").
   - Varias palabras = todas deben aparecer ("ana pe" -> "Ana Pérez").
   - Números: coincide por los ÚLTIMOS dígitos del teléfono ("4567"), que es
     como la gente dicta un número, y también por cualquier tramo.
   - Orden: el nombre que EMPIEZA con lo escrito va primero.
   - Sin texto: los clientes más recientes.
=========================================================================== */

import type { Customer } from "../../entities/Entities";

/** Quita tildes y pasa a minúsculas. */
export function foldText(value: string | null | undefined): string {
  return (value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Solo dígitos y letras — misma llave que el índice único del servidor. */
export function phoneDigits(value: string | null | undefined): string {
  return (value ?? "").replace(/[^0-9]/g, "");
}

export interface QuickCreateDraft {
  readonly name: string;
  readonly phone: string;
}

/**
 * Separa lo que el cajero escribió en nombre y teléfono, para precargar el
 * formulario de creación rápida: "Ana 300 123 4567" -> { Ana, 300 123 4567 }.
 * Un teléfono es una racha de 7+ dígitos (con espacios, guiones, + o paréntesis).
 */
export function splitNameAndPhone(query: string): QuickCreateDraft {
  const text = query.trim();
  const pattern = /\+?\(?\d[\d\s().-]{5,}\d/g;

  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const before = match.index > 0 ? text[match.index - 1] : "";
    const glued = /[\p{L}\d]/u.test(before); // "Ana2 3001..." : el 2 es del nombre

    if (!glued && phoneDigits(match[0]).length >= 7) {
      const phone = match[0].trim();
      const name = (text.slice(0, match.index) + " " + text.slice(match.index + match[0].length))
        .replace(/\s+/g, " ")
        .trim();
      return { name, phone };
    }

    pattern.lastIndex = match.index + 1;
  }

  return { name: text, phone: "" };
}

interface Scored {
  readonly customer: Customer;
  readonly score: number;
}

function scoreCustomer(customer: Customer, tokens: readonly string[]): number {
  const name = foldText(customer.name);
  const email = foldText(customer.email);
  const digits = phoneDigits(customer.phone);
  const nameWords = name.split(/\s+/);

  let total = 0;

  for (const token of tokens) {
    const tokenDigits = phoneDigits(token);
    const isNumeric = tokenDigits.length > 0 && tokenDigits.length === token.replace(/[\s+().-]/g, "").length;

    let best = 0;

    if (isNumeric) {
      if (digits.endsWith(tokenDigits)) best = 3;
      else if (digits.includes(tokenDigits)) best = 2;
    } else {
      if (name.startsWith(token)) best = 4;
      else if (nameWords.some((word) => word.startsWith(token))) best = 3;
      else if (name.includes(token)) best = 1.5;
      else if (email.includes(token)) best = 1;
    }

    if (best === 0) return 0; // todas las palabras deben coincidir
    total += best;
  }

  return total;
}

/**
 * Filtra y ordena clientes para la búsqueda de Caja.
 * Sin `query` devuelve los más recientes (createdAt desc, luego nombre).
 */
export function searchCustomers(
  customers: readonly Customer[],
  query: string,
  limit = 8
): Customer[] {
  const max = Math.max(limit, 0);
  const tokens = foldText(query).split(/\s+/).filter(Boolean);

  if (tokens.length === 0) {
    return [...customers]
      .sort((a, b) => {
        const byDate = (b.createdAt?.getTime() ?? 0) - (a.createdAt?.getTime() ?? 0);
        return byDate !== 0 ? byDate : foldText(a.name).localeCompare(foldText(b.name));
      })
      .slice(0, max);
  }

  const scored: Scored[] = [];
  for (const customer of customers) {
    const score = scoreCustomer(customer, tokens);
    if (score > 0) scored.push({ customer, score });
  }

  return scored
    .sort((a, b) =>
      b.score !== a.score
        ? b.score - a.score
        : foldText(a.customer.name).localeCompare(foldText(b.customer.name))
    )
    .slice(0, max)
    .map((item) => item.customer);
}

/** Cliente que ya usa este teléfono (misma llave de dígitos), si existe. */
export function findCustomerByPhone(
  customers: readonly Customer[],
  phone: string
): Customer | null {
  const key = phoneDigits(phone);
  if (key.length < 7) return null;
  return customers.find((customer) => phoneDigits(customer.phone) === key) ?? null;
}