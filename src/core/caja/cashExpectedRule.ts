// src/core/caja/cashExpectedRule.ts
/* ===========================================================================
   REGLA ÚNICA DEL EFECTIVO ESPERADO EN CAJA
   ---------------------------------------------------------------------------
   La fuente de verdad es el SERVIDOR (supabase/migrations/
   20261111000000_cash_expected_single_rule.sql). Este archivo es el espejo
   exacto de esa regla y se usa solo cuando no se puede preguntar al servidor
   (sin internet, repositorios de prueba, reportes que ya traen los movimientos).

   Regla:
     parte en efectivo de un movimiento =
         cashAmount, si viene informado;
         si no: el monto completo cuando el medio es CASH o no tiene medio;
         en cualquier otro medio (tarjeta, transferencia, QR...): 0.
     efecto en el cajón = +parte (IN)  /  -parte (OUT).
     esperado = fondo inicial + efectivo que entró - efectivo que salió.

   Ejemplo clave: un reembolso de Wompi es una salida (OUT) de 8.000 con
   cashAmount = 0, porque el dinero vuelve a la tarjeta y NO sale del cajón.
   Restar los 8.000 del esperado daría un falso sobrante.

   Si cambias esta regla, cambia también la del SQL (cash_movement_cash_portion)
   y los casos de tests/unit/cashExpectedRule.test.ts.
=========================================================================== */

import type { CashMovement } from "../entities/Entities";

export type CashRuleMovement = Pick<
  CashMovement,
  "type" | "amount" | "cashAmount" | "paymentMethod"
>;

export interface ShiftCashTotals {
  /** Fondo con el que se abrió el turno. */
  readonly openingAmount: number;
  /** Suma de TODOS los ingresos (cualquier medio de pago). Informativo. */
  readonly totalIncome: number;
  /** Suma de TODAS las salidas (incluye reembolsos electrónicos). Informativo. */
  readonly totalExpense: number;
  /** Efectivo físico que entró al cajón. */
  readonly totalCashIncome: number;
  /** Efectivo físico que salió del cajón. */
  readonly totalCashExpense: number;
  /** fondo + efectivo que entró - efectivo que salió. */
  readonly expectedAmount: number;
  /** Ingresos por medio de pago ("sin medio" cuenta como CASH). */
  readonly incomeByMethod: Record<string, number>;
  readonly movementCount: number;
}

function finiteOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Parte de un movimiento que es efectivo físico (siempre >= lo informado en cashAmount). */
export function cashMovementCashPortion(movement: CashRuleMovement): number {
  if (typeof movement.cashAmount === "number" && Number.isFinite(movement.cashAmount)) {
    return movement.cashAmount;
  }
  const method = movement.paymentMethod;
  if (!method || method === "CASH") return finiteOrZero(movement.amount);
  return 0;
}

/** Efecto del movimiento sobre el efectivo del cajón: + en ingresos, - en salidas. */
export function cashMovementCashEffect(movement: CashRuleMovement): number {
  if (movement.type === "IN") return cashMovementCashPortion(movement);
  if (movement.type === "OUT") {
    const portion = cashMovementCashPortion(movement);
    // Evita el "-0" (cero negativo) cuando la salida no saca efectivo.
    return portion === 0 ? 0 : -portion;
  }
  return 0;
}

/**
 * Totales del turno con la regla única. `round` redondea según la moneda
 * (por ejemplo roundMoney con la moneda del negocio).
 */
export function computeShiftCashTotals(
  openingAmount: number,
  movements: readonly CashRuleMovement[],
  round: (value: number) => number = (value) => value
): ShiftCashTotals {
  let totalIncome = 0;
  let totalExpense = 0;
  let totalCashIncome = 0;
  let totalCashExpense = 0;
  const incomeByMethodRaw: Record<string, number> = {};

  for (const movement of movements) {
    const amount = finiteOrZero(movement.amount);
    const cashPart = cashMovementCashPortion(movement);
    if (movement.type === "IN") {
      totalIncome += amount;
      totalCashIncome += cashPart;
      const method = movement.paymentMethod || "CASH";
      incomeByMethodRaw[method] = (incomeByMethodRaw[method] ?? 0) + amount;
    } else if (movement.type === "OUT") {
      totalExpense += amount;
      totalCashExpense += cashPart;
    }
  }

  const opening = finiteOrZero(openingAmount);
  const incomeByMethod: Record<string, number> = {};
  for (const [method, total] of Object.entries(incomeByMethodRaw)) {
    incomeByMethod[method] = round(total);
  }

  return {
    openingAmount: round(opening),
    totalIncome: round(totalIncome),
    totalExpense: round(totalExpense),
    totalCashIncome: round(totalCashIncome),
    totalCashExpense: round(totalCashExpense),
    expectedAmount: round(opening + totalCashIncome - totalCashExpense),
    incomeByMethod,
    movementCount: movements.length,
  };
}