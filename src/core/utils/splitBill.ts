// src/core/utils/splitBill.ts
/* ===========================================================================
   Dividir la cuenta en partes iguales — sin perder ni inventar pesos.
   ---------------------------------------------------------------------------
   El total en pesos colombianos no tiene centavos útiles, así que se reparte
   en pesos enteros: todas las partes suman EXACTAMENTE el total. Si no se
   divide justo, las primeras personas pagan $1 más (p. ej. $100 entre 3 →
   $34, $33 y $33). Antes la pantalla mostraba total/personas con decimales y
   solo informaba con un alert(); no repartía el resto.
=========================================================================== */

export interface BillSplit {
  people: number;
  total: number;
  /** Lo que paga cada persona, de mayor a menor. Siempre suma `total`. */
  shares: number[];
  /** Monto menor y mayor (iguales cuando se divide justo). */
  low: number;
  high: number;
  /** Cuántas personas pagan el monto mayor. */
  highCount: number;
  even: boolean;
}

export function splitBillEvenly(total: number, people: number): BillSplit {
  const count = Math.trunc(Number(people));
  if (!Number.isFinite(count) || count < 1) {
    throw new Error("SPLIT_PEOPLE_INVALID: indica 1 persona o más");
  }
  const amount = Math.round(Number(total));
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("SPLIT_TOTAL_INVALID: el total de la cuenta no es válido");
  }

  const base = Math.floor(amount / count);
  const remainder = amount - base * count;
  const shares = Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));

  return {
    people: count,
    total: amount,
    shares,
    low: base,
    high: remainder > 0 ? base + 1 : base,
    highCount: remainder > 0 ? remainder : count,
    even: remainder === 0
  };
}