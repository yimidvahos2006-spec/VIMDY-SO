import { CashMovement } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { IRepository } from "./IRepository";
import { supabase } from "../../supabase/supabaseClient";
import { logError } from "../../logging/opsLogger";

/**
 * CashMovementRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "cash_movements" ya no viven solo en el navegador, viven
 * en la tabla `cash_movements` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export interface ICashMovementRepository extends IRepository<CashMovement> {
   /**
    * Inserta un movimiento de caja de forma ATÓMICA en servidor mediante
    * la RPC `register_movement_atomic()`. Garantiza:
    * 1. IDEMPOTENCIA: si el `id` (usado como idempotency_key) ya existe para
    *    el mismo business + branch, el RPC hace DO NOTHING y devuelve el
    *    movimiento original. Nunca se pisa ni modifica un movimiento existente.
    *    Un reintento con la misma clave devuelve exactamente el movimiento
    *    original, con los mismos montos y método que la primera vez.
    * 2. MULTI-TENANT: la idempotencia está aislada por business_id + branch_id,
    *    así que dos negocios distintos pueden usar la misma idempotency_key
    *    sin interferirse.
    * 3. ATOMICITY: el movimiento se persiste en una única operación de
    *    servidor, evitando condiciones de carrera entre cashiers concurrentes.
    *
    * La implementación concreta (CashMovementRepository) delega en el RPC
    * PostgreSQL. Implementaciones de test (InMemory) pueden simplemente
    * delegar en `save()` que ya es idempotente por id.
    */
  saveAtomic(movement: CashMovement, saleId?: string | null): Promise<CashMovement>;

  /**
   * Registra los movimientos de caja asociados al cobro de una venta
   * (ingreso del total cobrado + egreso de cambio en efectivo) de forma
   * atómica en servidor mediante la RPC `register_sale_payment_atomic()`.
   * Garantiza atomicity entre el ingreso y el egreso de cambio: ambos
   * movimientos se persisten en una única transacción o ninguno.
   */
  saveAtomicPayment(params: {
    saleId: string;
    businessId: string;
    branchId: string;
    cashRegisterId?: string;
    shiftId?: string;
    paymentId: string;
    changeId?: string | null;
    paymentMethod: string;
    total: number;
    cashAmount: number;
    received: number;
    change: number;
    reference?: string | null;
    verificationSource?: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER" | null;
  }): Promise<{ income: CashMovement; change: CashMovement | null }>;

  /**
   * Ejecuta un reembolso CASH de forma atómica en servidor mediante la RPC
   * `refund_sale_cash_atomic()`. Garantiza:
   * 1. Valida que la venta esté PAID/CLOSED y paymentStatus = CONFIRMED
   * 2. Valida que paymentMethod = CASH (reembolsos externos usan otro flujo)
   * 3. Calcula montos reembolsables por ítem (respeta reembolsos previos)
   * 4. Reversa inventario/Kardex atómicamente
   * 5. Registra movimiento de caja OUT + payment_refunds + audit_log
   * 6. Actualiza estado de venta (REFUNDED / parcialmente reembolsada)
   * 7. Idempotencia por p_refund_id (business_id + idempotency_key)
   */
   refundSaleCashAtomic(params: {
     businessId: string;
     branchId: string;
     saleId: string;
     refundId: string;
     refundItems: { productId: string; quantity: number }[];
     reason: string;
     cashRegisterId?: string | null;
     refundAmount?: number;
   }): Promise<{
     success: boolean;
     idempotent: boolean;
     refundId: string;
     refundAmount: number;
     cashMovementId: string;
     sale: any;
   }>;
}

export class CashMovementRepository
  extends SupabaseRepository<CashMovement>
  implements ICashMovementRepository
{
  protected tableName = "cash_movements" as const;

  public async saveAtomicPayment(params: {
    saleId: string;
    businessId: string;
    branchId: string;
    cashRegisterId?: string;
    shiftId?: string;
    paymentId: string;
    changeId?: string | null;
    paymentMethod: string;
    total: number;
    cashAmount: number;
    received: number;
    change: number;
    reference?: string | null;
    verificationSource?: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER" | null;
  }): Promise<{ income: CashMovement; change: CashMovement | null }> {
    const {
      saleId,
      businessId,
      branchId,
      cashRegisterId,
      shiftId,
      paymentId,
      changeId,
      paymentMethod,
      total,
      cashAmount,
      received,
      change,
      reference,
      verificationSource,
    } = params;

    const { data, error } = await supabase.rpc("register_sale_payment_atomic", {
      p_sale_id: saleId,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_cash_register_id: cashRegisterId ?? null,
      p_verification_source: verificationSource ?? null,
      p_shift_id: shiftId ?? null,
      p_payment_id: paymentId,
      p_change_id: changeId ?? null,
      p_payment_method: paymentMethod,
      p_total: total,
      p_cash_amount: cashAmount,
      p_received: received,
      p_change: change,
      p_reference: reference ?? null,
    });

    if (error) {
      logError(error, {
        category: "payment",
        context: {
          saleId,
          paymentId,
          amount: total,
        },
      });
      throw new Error(`SUPABASE_REGISTER_PAYMENT_FAILED: ${error.message}`);
    }

    const row = data?.[0];

    if (!row) {
      throw new Error(
        "SUPABASE_REGISTER_PAYMENT_FAILED: la RPC no devolvió el movimiento."
      );
    }

    const income: CashMovement = {
      id: row.payment_idempotency_key ?? paymentId,
      amount: Number(row.payment_amount),
      type: "IN",
      description: row.payment_description,
      date: new Date(row.payment_date),
      paymentMethod: row.payment_method,
      cashAmount: Number(row.payment_cash_amount),
      businessId: row.business_id,
      branchId: row.branch_id,
      cashRegisterId: row.cash_register_id ?? undefined,
      shiftId: row.shift_id,
      paymentVerificationSource:
        row.payment_verification_source ?? undefined,
    };

    let changeMovement: CashMovement | null = null;
    if (row.change_idempotency_key) {
      changeMovement = {
        id: row.change_idempotency_key,
        amount: Number(row.change_amount),
        type: "OUT",
        description: row.change_description,
        date: new Date(row.change_date),
        paymentMethod: "CASH",
        cashAmount: Number(row.change_amount),
        businessId: income.businessId,
        branchId: income.branchId,
        cashRegisterId: income.cashRegisterId,
        shiftId: row.shift_id,
        paymentVerificationSource: "CASH",
      };
    }

return { income, change: changeMovement };
  }

  /**
   * Ejecuta reembolso CASH atómico vía RPC `refund_sale_cash_atomic()`.
   * La RPC valida todo en servidor: venta pagada, método CASH, montos reembolsables,
   * inventario, caja, y registra payment_refunds + cash_movements + audit_log + sale update.
   */
  public async refundSaleCashAtomic(params: {
    businessId: string;
    branchId: string;
    saleId: string;
    refundId: string;
    refundItems: { productId: string; quantity: number }[];
    reason: string;
    cashRegisterId?: string | null;
  }): Promise<{
    success: boolean;
    idempotent: boolean;
    refundId: string;
    refundAmount: number;
    cashMovementId: string;
    sale: any;
  }> {
    const { data, error } = await supabase.rpc("refund_sale_cash_atomic", {
      p_business_id: params.businessId,
      p_branch_id: params.branchId,
      p_sale_id: params.saleId,
      p_refund_id: params.refundId,
      p_refund_items: params.refundItems,
      p_reason: params.reason,
      p_cash_register_id: params.cashRegisterId ?? null,
    });

    if (error) {
      logError(error, {
        category: "payment",
        context: {
          saleId: params.saleId,
          refundId: params.refundId,
          businessId: params.businessId,
          branchId: params.branchId,
        },
      });
      throw new Error(`SUPABASE_REFUND_SALE_CASH_FAILED: ${error.message}`);
    }

    const row = data?.[0];
    if (!row) {
      throw new Error("SUPABASE_REFUND_SALE_CASH_FAILED: la RPC no devolvió resultado.");
    }

    return {
      success: row.success ?? true,
      idempotent: row.idempotent ?? false,
      refundId: row.refundid ?? row.refund_id ?? "",
      refundAmount: Number(row.refundamount ?? row.refund_amount ?? 0),
      cashMovementId: row.cashmovementid ?? row.cash_movement_id ?? params.refundId,
      sale: row.sale ?? null,
    };
  }

  /**
   * Idempotencia + atomicidad vía RPC `register_movement_atomic()`.
    * El RPC hace ON CONFLICT (business_id, branch_id, idempotency_key)
    * DO NOTHING en servidor: si dos cajeros intentan registrar el mismo
    * movimiento al mismo tiempo, UNO inserta y el otro obtiene el mismo
    * registro sin crear duplicados ni modificar el original.
    */
  public async saveAtomic(
    movement: CashMovement,
    saleId?: string | null
  ): Promise<CashMovement> {
    const { data, error } = await supabase.rpc("register_movement_atomic", {
      p_idempotency_key: movement.id,
      p_business_id: movement.businessId,
      p_branch_id: movement.branchId,
      p_type: movement.type,
      p_amount: movement.amount,
      p_description: movement.description,
      p_payment_method: movement.paymentMethod,
      p_cash_amount: movement.cashAmount,
      p_sale_id: saleId ?? null,
      p_created_at: movement.date,
      p_cash_register_id: movement.cashRegisterId ?? null,
      p_verification_source: movement.paymentVerificationSource ?? null,
    });

    if (error) {
      logError(error, {
        category: "payment",
        context: {
          idempotencyKey: movement.id,
          movementType: movement.type,
          amount: movement.amount,
          saleId: saleId ?? null,
        },
      });
      throw new Error(`SUPABASE_REGISTER_MOVEMENT_FAILED: ${error.message}`);
    }

    const row = data?.[0];

    if (!row) {
      throw new Error(
        "SUPABASE_REGISTER_MOVEMENT_FAILED: la RPC no devolvió el movimiento."
      );
    }

    return {
      ...movement,
      id: row.idempotency_key ?? movement.id,
      date: new Date(row.date ?? movement.date.toISOString()),
      businessId: row.business_id ?? movement.businessId,
      branchId: row.branch_id ?? movement.branchId,
      cashRegisterId: row.cash_register_id ?? movement.cashRegisterId,
      shiftId: row.shift_id ?? movement.shiftId,
      paymentVerificationSource:
        row.payment_verification_source ?? movement.paymentVerificationSource,
    };
  }
}