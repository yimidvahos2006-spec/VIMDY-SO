import { Shift } from "../../../core/entities/Entities";
import type { ShiftCashTotals } from "../../../core/caja/cashExpectedRule";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { supabase } from "../../supabase/supabaseClient";

export interface IShiftRepository {
  openAtomic(
    shiftId: string,
    businessId: string,
    branchId: string,
    cashRegisterId: string,
    cashierId: string,
    openingAmount: number,
    notes?: string
  ): Promise<Shift>;
  closeAtomic(
    shiftId: string,
    countedAmount: number,
    notes?: string
  ): Promise<Shift>;
  /**
   * Efectivo esperado del turno calculado por el SERVIDOR con la regla única
   * (RPC get_shift_cash_summary): la misma consulta con la que se graba el cierre.
   */
  getCashSummary?(shiftId: string): Promise<ShiftCashTotals>;
}

/**
 * ShiftRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "shifts" ya no viven solo en el navegador, viven
 * en la tabla `shifts` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class ShiftRepository
  extends SupabaseRepository<Shift>
  implements IShiftRepository
{
  protected tableName = "shifts" as const;


  public async openAtomic(
    shiftId: string,
    businessId: string,
    branchId: string,
    cashRegisterId: string,
    cashierId: string,
    openingAmount: number,
    notes?: string
  ): Promise<Shift> {
    const { data, error } = await supabase.rpc("open_shift_atomic", {
      p_shift_id: shiftId,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_cash_register_id: cashRegisterId,
      p_cashier_id: cashierId,
      p_opening_amount: openingAmount,
      p_notes: notes ?? null,
    });

    if (error) throw new Error(`SHIFT_OPEN_RPC_FAILED: ${error.message}`);
    const row = data?.[0];
    if (!row) throw new Error("SHIFT_OPEN_RPC_FAILED: la RPC no devolvió el turno abierto.");

    return { ...reviveDates(row.data as unknown) as Shift, version: row.version };
  }

  /**
   * Resumen de efectivo del turno desde el servidor (regla única de caja).
   * Es exactamente la misma consulta que usa el cierre histórico, así que la
   * cifra "esperado" de la pantalla coincide con la que se graba al cerrar.
   */
  public async getCashSummary(shiftId: string): Promise<ShiftCashTotals> {
    const { data, error } = await supabase.rpc("get_shift_cash_summary", {
      p_shift_id: shiftId,
    });

    if (error) throw new Error(`SHIFT_CASH_SUMMARY_RPC_FAILED: ${error.message}`);
    const row = (Array.isArray(data) ? data[0] : data) as Record<string, unknown> | undefined;
    if (!row) {
      throw new Error("SHIFT_CASH_SUMMARY_RPC_FAILED: la RPC no devolvió el resumen del turno.");
    }

    const incomeByMethod: Record<string, number> = {};
    const rawByMethod = (row.income_by_method ?? {}) as Record<string, unknown>;
    for (const [method, total] of Object.entries(rawByMethod)) {
      incomeByMethod[method] = Number(total);
    }

    return {
      openingAmount: Number(row.opening_amount),
      totalIncome: Number(row.total_income),
      totalExpense: Number(row.total_expense),
      totalCashIncome: Number(row.total_cash_income),
      totalCashExpense: Number(row.total_cash_expense),
      expectedAmount: Number(row.expected_amount),
      incomeByMethod,
      movementCount: Number(row.movement_count ?? 0),
    };
  }

  /**
   * El cierre SIN arqueo está deshabilitado.
   *
   * La RPC `close_shift_atomic()` ya no es ejecutable por usuarios autenticados
   * (migración 20261110000000_close_shift_requires_cash_count.sql). Todo cierre
   * debe registrar el conteo físico de billetes y monedas mediante
   * `enterpriseCashService.closeShiftWithCashCount()`, que invoca
   * `close_shift_with_cash_count_atomic()`.
   *
   * Se conserva el método (y no se elimina) a propósito: ShiftEngine usa su
   * existencia para distinguir el repositorio real de los de test/in-memory.
   * Si desapareciera, el motor caería al fallback de cliente. Así, cualquier
   * intento de cerrar sin arqueo falla de forma explícita en vez de silenciosa.
   */
  public async closeAtomic(
    _shiftId: string,
    _countedAmount: number,
    _notes?: string
  ): Promise<Shift> {
    throw new Error(
      "SHIFT_CLOSE_REQUIRES_CASH_COUNT: el cierre de turno exige el arqueo de billetes y monedas. Usa enterpriseCashService.closeShiftWithCashCount()."
    );
  }
}