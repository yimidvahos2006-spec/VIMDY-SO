import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../supabase/supabaseClient";
import type {
  CashDrawerCount,
  CashMovementReasonCode,
  EnterpriseCashMovementResult,
  CashRegisterTransferResult,
  CloseShiftWithCashCountResult,
} from "../../core/caja/CajaEnterpriseTypes";
import { normalizeDenominationCounts, calculateDenominationTotal } from "../../core/caja/cashDenominations";
import { reviveDates } from "../di/repositories/SupabaseRepository";

function requireCurrentContext(): { businessId: string; branchId: string } {
  const businessId = getCurrentBusinessId();
  const branchId = getCurrentBranchId();
  if (!businessId || !branchId) {
    throw new Error("NO_BUSINESS_CONTEXT: Caja necesita negocio y sucursal activos.");
  }
  return { businessId, branchId };
}

function normalizeRpcError(prefix: string, error: { message?: string; code?: string }): Error {
  const message = error.message ?? "Error desconocido";
  return new Error(`${prefix}: ${message}`);
}

export const enterpriseCashService = {
  async registerManualMovement(params: {
    shiftId: string;
    cashRegisterId: string;
    type: "IN" | "OUT";
    amount: number;
    reasonCode: CashMovementReasonCode;
    description: string;
    idempotencyKey: string;
  }): Promise<EnterpriseCashMovementResult> {
    const { businessId, branchId } = requireCurrentContext();
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error("CAJA_INVALID_MOVEMENT_AMOUNT");
    }
    if (!params.shiftId || !params.cashRegisterId) {
      throw new Error("CAJA_SHIFT_AND_REGISTER_REQUIRED");
    }
    if (!params.idempotencyKey.trim()) {
      throw new Error("CAJA_IDEMPOTENCY_KEY_REQUIRED");
    }

    const { data, error } = await supabase.rpc("register_cash_movement_enterprise", {
      p_idempotency_key: params.idempotencyKey,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_cash_register_id: params.cashRegisterId,
      p_shift_id: params.shiftId,
      p_type: params.type,
      p_amount: params.amount,
      p_reason_code: params.reasonCode,
      p_description: params.description.trim(),
    });

    if (error) throw normalizeRpcError("CAJA_ENTERPRISE_MOVEMENT_FAILED", error);
    const row = data?.[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("CAJA_ENTERPRISE_MOVEMENT_FAILED: la RPC no devolvió movimiento.");

    return {
      movementId: String(row.movement_id),
      idempotencyKey: String(row.idempotency_key),
      type: String(row.type) as "IN" | "OUT",
      amount: Number(row.amount),
      businessId: String(row.business_id),
      branchId: String(row.branch_id),
      cashRegisterId: String(row.cash_register_id),
      shiftId: String(row.shift_id),
      reasonCode: String(row.reason_code) as CashMovementReasonCode,
      date: new Date(String(row.date)),
    };
  },

  async transferBetweenRegisters(params: {
    toCashRegisterId: string;
    fromCashRegisterId: string;
    fromShiftId: string;
    toShiftId: string;
    amount: number;
    reason: string;
    transferId?: string;
  }): Promise<CashRegisterTransferResult> {
    const { businessId, branchId } = requireCurrentContext();
    const transferId = params.transferId ?? crypto.randomUUID();
    if (params.toCashRegisterId === params.fromCashRegisterId) {
      throw new Error("CAJA_TRANSFER_SAME_REGISTER");
    }
    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error("CAJA_INVALID_TRANSFER_AMOUNT");
    }
    if (!params.reason.trim()) throw new Error("CAJA_TRANSFER_REASON_REQUIRED");

    const { data, error } = await supabase.rpc("transfer_cash_between_registers_atomic", {
      p_transfer_id: transferId,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_from_cash_register_id: params.fromCashRegisterId,
      p_to_cash_register_id: params.toCashRegisterId,
      p_from_shift_id: params.fromShiftId,
      p_to_shift_id: params.toShiftId,
      p_amount: params.amount,
      p_reason: params.reason.trim(),
    });

    if (error) throw normalizeRpcError("CAJA_REGISTER_TRANSFER_FAILED", error);
    const row = data?.[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("CAJA_REGISTER_TRANSFER_FAILED: la RPC no devolvió transferencia.");

    return {
      transferId: String(row.transfer_id),
      amount: Number(row.amount),
      fromMovementId: String(row.from_movement_id),
      toMovementId: String(row.to_movement_id),
      fromCashRegisterId: String(row.from_cash_register_id),
      toCashRegisterId: String(row.to_cash_register_id),
      fromShiftId: String(row.from_shift_id),
      toShiftId: String(row.to_shift_id),
      createdAt: new Date(String(row.created_at)),
    };
  },

  async closeShiftWithCashCount(params: {
    shiftId: string;
    cashRegisterId: string;
    countedAmount: number;
    denominations: Record<string, number>;
    notes?: string;
    currencyCode?: string;
  }): Promise<CloseShiftWithCashCountResult> {
    const { businessId, branchId } = requireCurrentContext();
    const denominations = normalizeDenominationCounts(params.denominations);
    const calculated = calculateDenominationTotal(denominations);

    if (!params.cashRegisterId) throw new Error("CAJA_CASH_REGISTER_REQUIRED_FOR_CLOSE");
    if (!Number.isFinite(params.countedAmount) || params.countedAmount < 0) {
      throw new Error("CAJA_INVALID_COUNTED_AMOUNT");
    }
    if (Math.abs(calculated - params.countedAmount) > 0.005) {
      throw new Error("CAJA_DENOMINATIONS_TOTAL_MISMATCH");
    }

    const { data, error } = await supabase.rpc("close_shift_with_cash_count_atomic", {
      p_shift_id: params.shiftId,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_cash_register_id: params.cashRegisterId,
      p_counted_amount: params.countedAmount,
      p_denominations: denominations,
      p_currency_code: params.currencyCode ?? "COP",
      p_notes: params.notes?.trim() || null,
    });

    if (error) throw normalizeRpcError("CAJA_ENTERPRISE_CLOSE_FAILED", error);
    const row = data?.[0] as Record<string, unknown> | undefined;
    if (!row) throw new Error("CAJA_ENTERPRISE_CLOSE_FAILED: la RPC no devolvió cierre.");

    return {
      shiftId: String(row.shift_id),
      countId: String(row.count_id),
      version: Number(row.version),
      expectedAmount: Number(row.expected_amount),
      countedAmount: Number(row.counted_amount),
      difference: Number(row.difference),
      blindCount: Boolean(row.blind_count),
      denominations: normalizeDenominationCounts((row.denominations ?? {}) as Record<string, number>),
      currencyCode: String(row.currency_code),
      closedAt: new Date(String(row.closed_at)),
      shiftData: reviveDates((row.shift_data ?? {}) as Record<string, unknown>),
    };
  },


  async listOpenShifts(): Promise<Array<{ id: string; cashRegisterId: string; cashierId: string; openedAt: Date }>> {
    const { businessId, branchId } = requireCurrentContext();
    const { data, error } = await supabase
      .from("shifts")
      .select("id,cash_register_id,data")
      .eq("business_id", businessId)
      .eq("branch_id", branchId);

    if (error) throw normalizeRpcError("CAJA_OPEN_SHIFTS_READ_FAILED", error);
    return (data ?? [])
      .filter((row: Record<string, unknown>) => {
        const payload = (row.data ?? {}) as Record<string, unknown>;
        return payload.status === "OPEN" && typeof row.cash_register_id === "string";
      })
      .map((row: Record<string, unknown>) => {
        const payload = (row.data ?? {}) as Record<string, unknown>;
        return {
          id: String(row.id),
          cashRegisterId: String(row.cash_register_id),
          cashierId: String(payload.cashierId ?? ""),
          openedAt: new Date(String(payload.openedAt)),
        };
      });
  },

  async getLatestClosingCount(shiftId: string): Promise<CashDrawerCount | null> {
    const { businessId, branchId } = requireCurrentContext();
    const { data, error } = await supabase
      .from("cash_drawer_counts")
      .select("*")
      .eq("business_id", businessId)
      .eq("branch_id", branchId)
      .eq("shift_id", shiftId)
      .eq("count_type", "CLOSING")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error) throw normalizeRpcError("CAJA_DRAWER_COUNT_READ_FAILED", error);
    if (!data) return null;

    return {
      id: String(data.id),
      businessId: String(data.business_id),
      branchId: String(data.branch_id),
      cashRegisterId: String(data.cash_register_id),
      shiftId: String(data.shift_id),
      countType: "CLOSING",
      currencyCode: String(data.currency_code),
      denominations: normalizeDenominationCounts(data.denominations as Record<string, number>),
      countedAmount: Number(data.counted_amount),
      expectedAmount: data.expected_amount == null ? null : Number(data.expected_amount),
      difference: data.difference == null ? null : Number(data.difference),
      blind: Boolean(data.blind),
      notes: data.notes == null ? null : String(data.notes),
      countedBy: String(data.counted_by),
      createdAt: new Date(String(data.created_at)),
    };
  },
};
