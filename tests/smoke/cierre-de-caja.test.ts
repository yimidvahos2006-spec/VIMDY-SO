// tests/smoke/cierre-de-caja.test.ts
/* ===========================================================================
   SMOKE TEST — Cierre de caja
   ---------------------------------------------------------------------------
   CRÍTICO #7 del checklist de lanzamiento — flujo #2.

   Qué cubre:
     1. No se puede abrir un turno si ya hay uno abierto (regla de negocio
        central de ShiftEngine — evita que dos cajeros operen la misma caja
        sin control).
     2. El arqueo esperado se calcula bien: fondo inicial + efectivo real
        (CASH/MIXED) - egresos. Un pago con tarjeta NO debe sumar al
        efectivo esperado en el cajón, aunque sí cuente como ingreso total.
     3. closeShift() dejar el turno en CLOSED con el faltante/sobrante
        (difference) correcto, y no se puede cerrar dos veces.

   Si el arqueo calcula mal el efectivo esperado, un cajero honesto puede
   verse acusado de un faltante que no existe — por eso este flujo es
   crítico y no solo "bonito de tener".
=========================================================================== */

import { describe, it, expect, beforeEach } from "vitest";

import { CashMovement, Shift } from "../../src/core/entities/Entities";
import { CashEngine } from "../../src/core/engines/CashEngine";
import { ShiftEngine } from "../../src/core/engines/ShiftEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

function buildShiftEngine() {
  const cashMovements = new InMemoryRepository<CashMovement>("cash_movements");
  const shifts = new InMemoryRepository<Shift>("shifts");

  const cash = new CashEngine(cashMovements);
  const shiftEngine = new ShiftEngine(shifts, cash);

  return { shiftEngine, cash, shifts };
}

describe("Smoke: cierre de caja", () => {
  let ctx: ReturnType<typeof buildShiftEngine>;

  beforeEach(() => {
    ctx = buildShiftEngine();
  });

  it("no permite abrir un segundo turno mientras haya uno abierto", async () => {
    await ctx.shiftEngine.openShift("cashier-1", 50000);

    await expect(ctx.shiftEngine.openShift("cashier-2", 50000)).rejects.toThrow(
      /SHIFT_ALREADY_OPEN/
    );
  });

  it("calcula el arqueo esperado solo con el efectivo físico real (no tarjeta) y cierra con el faltante/sobrante correcto", async () => {
    const shift = await ctx.shiftEngine.openShift("cashier-1", 50000, "Fondo inicial del viernes");

    // Ventas en efectivo: sí cuentan para el cajón.
    await ctx.cash.registerIncome(30000, "Venta RAP-000001", "CASH");
    await ctx.cash.registerIncome(20000, "Venta RAP-000002", "CASH");

    // Venta con tarjeta: cuenta como ingreso total, pero NO como efectivo
    // físico del cajón.
    await ctx.cash.registerIncome(80000, "Venta RAP-000003", "CARD");

    // Un retiro: sale del efectivo físico.
    await ctx.cash.registerExpense(10000, "Retiro para cambio");

    const summary = await ctx.shiftEngine.getShiftSummary(shift.id);

    // Esperado en el cajón: 50000 (fondo) + 30000 + 20000 (efectivo) - 10000 (retiro) = 90000.
    // La venta con tarjeta (80000) NO debe estar incluida aquí.
    expect(summary.expectedAmount).toBe(90000);
    expect(summary.totalIncome).toBe(130000); // 30000 + 20000 + 80000, informativo.
    expect(summary.totalCashIncome).toBe(50000); // solo las 2 en efectivo.

    // El cajero cuenta físicamente 88500: faltan 1500.
    const closed = await ctx.shiftEngine.closeShift(shift.id, 88500, "Cuadre de cierre");

    expect(closed.status).toBe("CLOSED");
    expect(closed.expectedAmount).toBe(90000);
    expect(closed.countedAmount).toBe(88500);
    expect(closed.difference).toBe(-1500);

    // No se puede cerrar dos veces el mismo turno.
    await expect(ctx.shiftEngine.closeShift(shift.id, 88500)).rejects.toThrow(
      /SHIFT_ALREADY_CLOSED/
    );

    // Con el turno cerrado, ya se puede abrir uno nuevo sin problema.
    const nextShift = await ctx.shiftEngine.openShift("cashier-2", 90000);
    expect(nextShift.status).toBe("OPEN");
  });
});