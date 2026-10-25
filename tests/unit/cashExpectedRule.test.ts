// tests/unit/cashExpectedRule.test.ts
/* ===========================================================================
   REGLA ÚNICA DEL EFECTIVO ESPERADO — pantalla = cierre = disponible

   Los mismos 7 movimientos de este archivo se probaron en una base PostgreSQL
   real con la migración 20261111000000_cash_expected_single_rule.sql y dieron
   exactamente estas cifras (paridad TypeScript <-> SQL):

     fondo 50.000 | esperado 54.000 | efectivo que entró 12.000 | efectivo que salió 8.000
     ingresos totales 31.000 | salidas totales 16.000 | por medio { CARD 24.000, CASH 7.000 }

   Antes de la migración el cierre daba 46.000 (restaba el reembolso Wompi) y
   shift_cash_available daba 58.000 (sumaba la venta con tarjeta sin cashAmount).
=========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { CashMovement, Shift } from "../../src/core/entities/Entities";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";
import {
  cashMovementCashEffect,
  cashMovementCashPortion,
  computeShiftCashTotals,
  type CashRuleMovement,
  type ShiftCashTotals,
} from "../../src/core/caja/cashExpectedRule";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

/** Los 7 movimientos del escenario de paridad con el SQL. */
const SCENARIO: CashRuleMovement[] = [
  // Venta en efectivo de 5.000 pagada con 10.000 + el vuelto de 5.000.
  { type: "IN", amount: 5000, cashAmount: 10000, paymentMethod: "CASH" },
  { type: "OUT", amount: 5000, cashAmount: 5000, paymentMethod: "CASH" },
  // Venta con tarjeta de 20.000 (no entra efectivo).
  { type: "IN", amount: 20000, cashAmount: 0, paymentMethod: "CARD" },
  // Reembolso electrónico (Wompi): el dinero vuelve a la tarjeta, NO sale del cajón.
  { type: "OUT", amount: 8000, cashAmount: 0, paymentMethod: "CARD" },
  // Gasto en efectivo.
  { type: "OUT", amount: 3000, cashAmount: 3000, paymentMethod: "CASH" },
  // Ingreso antiguo sin medio ni cashAmount: se trata como efectivo.
  { type: "IN", amount: 2000 },
  // Ingreso antiguo con tarjeta y sin cashAmount: NO es efectivo.
  { type: "IN", amount: 4000, paymentMethod: "CARD" },
];

describe("Regla única de efectivo: un movimiento", () => {
  it("un reembolso electrónico (cashAmount 0) no saca efectivo del cajón", () => {
    expect(
      cashMovementCashEffect({ type: "OUT", amount: 8000, cashAmount: 0, paymentMethod: "CARD" })
    ).toBe(0);
  });

  it("un ingreso con tarjeta sin cashAmount no suma efectivo", () => {
    expect(cashMovementCashEffect({ type: "IN", amount: 10000, paymentMethod: "CARD" })).toBe(0);
  });

  it("un ingreso sin medio ni cashAmount es efectivo completo", () => {
    expect(cashMovementCashEffect({ type: "IN", amount: 10000 })).toBe(10000);
  });

  it("una venta en efectivo suma lo recibido y el vuelto lo resta", () => {
    expect(
      cashMovementCashEffect({ type: "IN", amount: 5000, cashAmount: 10000, paymentMethod: "CASH" })
    ).toBe(10000);
    expect(
      cashMovementCashEffect({ type: "OUT", amount: 5000, cashAmount: 5000, paymentMethod: "CASH" })
    ).toBe(-5000);
  });

  it("un pago MIXED suma solo su parte en efectivo", () => {
    expect(
      cashMovementCashEffect({ type: "IN", amount: 20000, cashAmount: 12000, paymentMethod: "MIXED" })
    ).toBe(12000);
  });

  it("un gasto o retiro antiguo (sin medio ni cashAmount) resta su monto", () => {
    expect(cashMovementCashEffect({ type: "OUT", amount: 3000 })).toBe(-3000);
    expect(cashMovementCashPortion({ type: "OUT", amount: 3000 })).toBe(3000);
  });

  it("cashAmount = 0 se respeta (no cae al monto completo)", () => {
    expect(
      cashMovementCashPortion({ type: "IN", amount: 9000, cashAmount: 0, paymentMethod: "CASH" })
    ).toBe(0);
  });
});

describe("Regla única de efectivo: totales del turno (paridad con el SQL)", () => {
  it("da las mismas cifras que get_shift_cash_summary en PostgreSQL", () => {
    const totals = computeShiftCashTotals(50000, SCENARIO);

    expect(totals.expectedAmount).toBe(54000);
    expect(totals.totalCashIncome).toBe(12000);
    expect(totals.totalCashExpense).toBe(8000);
    expect(totals.totalIncome).toBe(31000);
    expect(totals.totalExpense).toBe(16000);
    expect(totals.incomeByMethod).toEqual({ CARD: 24000, CASH: 7000 });
    expect(totals.movementCount).toBe(7);
  });

  it("sin movimientos, el esperado es el fondo inicial", () => {
    expect(computeShiftCashTotals(50000, []).expectedAmount).toBe(50000);
  });
});

describe("ShiftEngine: la pantalla usa la regla única", () => {
  let cashMovements: InMemoryRepository<CashMovement>;
  let shifts: InMemoryRepository<Shift>;
  let shiftEngine: ShiftEngine;

  async function seedScenario(): Promise<Shift> {
    const shift = await shiftEngine.openShift("cashier-1", 50000);
    let n = 0;
    for (const movement of SCENARIO) {
      n += 1;
      await cashMovements.save({
        id: `mv-${n}`,
        date: new Date(),
        ...movement,
      } as CashMovement);
    }
    return shift;
  }

  beforeEach(() => {
    cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
    shifts = new InMemoryRepository<Shift>("shifts");
    shiftEngine = new ShiftEngine(shifts, new CashEngine(cashMovements));
  });

  it("el resumen en vivo da 54.000 (no 46.000) con un reembolso electrónico en el turno", async () => {
    const shift = await seedScenario();
    const summary = await shiftEngine.getShiftSummary(shift.id);

    expect(summary.expectedAmount).toBe(54000);
    expect(summary.totalCashExpense).toBe(8000);
    expect(summary.totalExpense).toBe(16000);
    expect(summary.source).toBe("local");
  });

  it("el cierre graba exactamente la misma cifra que mostraba la pantalla", async () => {
    const shift = await seedScenario();
    const live = await shiftEngine.getShiftSummary(shift.id);

    const closed = await shiftEngine.closeShift(shift.id, 54000);

    expect(closed.expectedAmount).toBe(live.expectedAmount);
    expect(closed.totalCashExpense).toBe(8000);
    expect(closed.difference).toBe(0);
  });

  it("si el repositorio puede preguntar al servidor, la pantalla muestra LA cifra del servidor", async () => {
    class ServerBackedShifts extends InMemoryRepository<Shift> {
      public getCashSummary = vi.fn(async (): Promise<ShiftCashTotals> => ({
        openingAmount: 50000,
        totalIncome: 31000,
        totalExpense: 16000,
        totalCashIncome: 12000,
        totalCashExpense: 8000,
        expectedAmount: 54321, // distinta a propósito: prueba que se usa la del servidor
        incomeByMethod: { CARD: 24000, CASH: 7000 },
        movementCount: 7,
      }));
    }
    const serverShifts = new ServerBackedShifts("shifts");
    const engine = new ShiftEngine(serverShifts, new CashEngine(cashMovements));
    const shift = await engine.openShift("cashier-1", 50000);

    const summary = await engine.getShiftSummary(shift.id);

    expect(serverShifts.getCashSummary).toHaveBeenCalledWith(shift.id);
    expect(summary.expectedAmount).toBe(54321);
    expect(summary.source).toBe("server");
  });

  it("si el servidor no responde, usa el espejo local de la misma regla", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    class BrokenServerShifts extends InMemoryRepository<Shift> {
      public async getCashSummary(): Promise<ShiftCashTotals> {
        throw new Error("SHIFT_CASH_SUMMARY_RPC_FAILED: sin conexión");
      }
    }
    const engine = new ShiftEngine(new BrokenServerShifts("shifts"), new CashEngine(cashMovements));
    const shift = await engine.openShift("cashier-1", 50000);
    let n = 0;
    for (const movement of SCENARIO) {
      n += 1;
      await cashMovements.save({ id: `mv-${n}`, date: new Date(), ...movement } as CashMovement);
    }

    const summary = await engine.getShiftSummary(shift.id);

    expect(summary.expectedAmount).toBe(54000);
    expect(summary.source).toBe("local");
    warn.mockRestore();
  });
});