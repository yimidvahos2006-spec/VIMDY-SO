import type { CashDenominationCount, SupportedCashDenomination } from "./CajaEnterpriseTypes";

/**
 * Denominaciones soportadas por el contador físico COP de VIMDY.
 * Se mantienen ordenadas de mayor a menor para el arqueo de caja.
 */
export const COP_BILL_DENOMINATIONS: readonly SupportedCashDenomination[] = [
  100_000,
  50_000,
  20_000,
  10_000,
  5_000,
  2_000,
];

export const COP_COIN_DENOMINATIONS: readonly SupportedCashDenomination[] = [
  1_000,
  500,
  200,
  100,
  50,
];

export const COP_CASH_DENOMINATIONS: readonly SupportedCashDenomination[] = [
  ...COP_BILL_DENOMINATIONS,
  ...COP_COIN_DENOMINATIONS,
];

export function normalizeDenominationCounts(
  counts: Record<string, number> | Record<number, number> | undefined,
): Record<string, number> {
  const normalized: Record<string, number> = {};
  for (const [key, rawValue] of Object.entries(counts ?? {})) {
    const denomination = Number(key);
    const quantity = Number(rawValue);
    if (!Number.isFinite(denomination) || !Number.isFinite(quantity)) continue;
    if (!Number.isInteger(denomination) || !Number.isInteger(quantity)) continue;
    if (quantity < 0) continue;
    if (quantity === 0) continue;
    normalized[String(denomination)] = quantity;
  }
  return normalized;
}

export function calculateDenominationTotal(
  counts: Record<string, number> | Record<number, number> | undefined,
): number {
  return Object.entries(normalizeDenominationCounts(counts)).reduce(
    (total, [denomination, quantity]) => total + Number(denomination) * quantity,
    0,
  );
}

export function denominationRowsToRecord(
  rows: readonly CashDenominationCount[],
): Record<string, number> {
  return normalizeDenominationCounts(
    Object.fromEntries(rows.map((row) => [row.denomination, row.quantity])),
  );
}

export function validateDenominationCount(
  counts: Record<string, number>,
  expectedTotal: number,
): { valid: true; total: number } | { valid: false; total: number; message: string } {
  const normalized = normalizeDenominationCounts(counts);
  const total = calculateDenominationTotal(normalized);
  if (!Number.isFinite(expectedTotal) || expectedTotal < 0) {
    return { valid: false, total, message: "El total contado no es válido." };
  }
  if (Math.abs(total - expectedTotal) > 0.005) {
    return {
      valid: false,
      total,
      message: `Las denominaciones suman $${Math.round(total).toLocaleString("es-CO")}, pero el total contado es $${Math.round(expectedTotal).toLocaleString("es-CO")}.`,
    };
  }
  return { valid: true, total };
}
