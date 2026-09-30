import { Shift } from "../../../core/entities/Entities";
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
   * Cierra un turno de caja de forma atómica en servidor mediante la RPC
   * `close_shift_atomic()`. Garantiza:
   * 1. ATOMICITY: el arqueo (ingresos, egresos, efectivo esperado, diferencia)
   *    se calcula y persiste en una única transacción de servidor, evitando
   *    condiciones de carrera entre cajeros concurrentes.
   * 2. DOUBLE-CLOSE PROTECTION: un turno ya cerrado no puede volver a cerrarse.
   * 3. MULTI-TENANT: valida que el usuario pertenezca al negocio/branch del turno.
   */
  public async closeAtomic(
    shiftId: string,
    countedAmount: number,
    notes?: string
  ): Promise<Shift> {
    const { data, error } = await supabase.rpc("close_shift_atomic", {
      p_shift_id: shiftId,
      p_counted_amount: countedAmount,
      p_notes: notes ?? null,
    });

    if (error) {
      throw new Error(`SHIFT_CLOSE_RPC_FAILED: ${error.message}`);
    }

    const row = data?.[0];

    if (!row) {
      throw new Error(
        "SHIFT_CLOSE_RPC_FAILED: la RPC no devolvió el turno cerrado."
      );
    }

    const revived = reviveDates(row.data as unknown) as Shift;

    return {
      ...revived,
      version: row.version,
    };
  }
}