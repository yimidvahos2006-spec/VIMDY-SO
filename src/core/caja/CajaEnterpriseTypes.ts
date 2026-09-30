export type CashMovementDirection = "IN" | "OUT";

export type CashMovementReasonCode =
  | "CHANGE_FUND_IN"
  | "OTHER_IN"
  | "EXPENSE"
  | "OTHER_OUT"
  | "SAFE_DROP"
  | "BANK_DEPOSIT";

export type SupportedCashDenomination = number;

export interface CashDenominationCount {
  denomination: SupportedCashDenomination;
  quantity: number;
}

export interface CashDrawerCount {
  id: string;
  businessId: string;
  branchId: string;
  cashRegisterId: string;
  shiftId: string;
  countType: "CLOSING";
  currencyCode: string;
  denominations: Record<string, number>;
  countedAmount: number;
  expectedAmount: number | null;
  difference: number | null;
  blind: boolean;
  notes?: string | null;
  countedBy: string;
  createdAt: Date;
}

export interface EnterpriseCashMovementRequest {
  idempotencyKey: string;
  businessId: string;
  branchId: string;
  cashRegisterId: string;
  shiftId: string;
  type: CashMovementDirection;
  amount: number;
  reasonCode: CashMovementReasonCode;
  description: string;
}

export interface EnterpriseCashMovementResult {
  movementId: string;
  idempotencyKey: string;
  type: CashMovementDirection;
  amount: number;
  businessId: string;
  branchId: string;
  cashRegisterId: string;
  shiftId: string;
  reasonCode: CashMovementReasonCode;
  date: Date;
}

export interface CloseShiftWithCashCountRequest {
  shiftId: string;
  businessId: string;
  branchId: string;
  cashRegisterId: string;
  countedAmount: number;
  denominations: Record<string, number>;
  currencyCode?: string;
  notes?: string;
}

export interface CloseShiftWithCashCountResult {
  shiftId: string;
  countId: string;
  version: number;
  expectedAmount: number;
  countedAmount: number;
  difference: number;
  blindCount: boolean;
  denominations: Record<string, number>;
  currencyCode: string;
  closedAt: Date;
  shiftData: Record<string, unknown>;
}

export interface CashRegisterTransferRequest {
  transferId: string;
  businessId: string;
  branchId: string;
  fromCashRegisterId: string;
  toCashRegisterId: string;
  fromShiftId: string;
  toShiftId: string;
  amount: number;
  reason: string;
}

export interface CashRegisterTransferResult {
  transferId: string;
  amount: number;
  fromMovementId: string;
  toMovementId: string;
  fromCashRegisterId: string;
  toCashRegisterId: string;
  fromShiftId: string;
  toShiftId: string;
  createdAt: Date;
}