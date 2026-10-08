/**
 * PaymentSessionManager.ts
 * ---------------------------------------------------------------------------
 * Gestiona las sesiones de checkout de VIMDY Payments.
 *
 * Hay dos escenarios distintos y no deben mezclarse:
 *
 * 1) SUSCRIPCIONES:
 *    payment_sessions es de escritura server-side. El navegador solo puede
 *    consultar. El trigger sync_subscription_payment_session crea/actualiza
 *    la sesión cuando la Edge Function persiste subscription_payments.
 *
 * 2) POS EXTERNO (Wompi):
 *    createForSale() llama a la RPC SECURITY DEFINER
 *    create_wompi_sale_payment_session_atomic(), que valida tenant, venta,
 *    método, importes e idempotencia en PostgreSQL.
 *
 * Las mutaciones genéricas updateStatus() y clearExpired() NO escriben
 * directamente desde el navegador porque RLS revoca UPDATE/DELETE a
 * authenticated. Quedan fail-closed para que nadie confunda una operación
 * server-side con una escritura cliente que aparentemente funcionó.
 */

import { supabase } from "../../infrastructure/supabase/supabaseClient";
import type { PaymentSession } from "./models/PaymentModels";
import type {
  CurrencyCode,
  PaymentProviderName,
  PaymentStatus
} from "./types/payment.types";
import { nowIso } from "./utils/paymentUtils";

const PAYMENT_METHODS = new Set(["CARD", "TRANSFER", "QR", "MIXED"]);
const TERMINAL_METHODS = new Set(["CARD", "MIXED"]);
const PROVIDER_METHODS = new Set(["TRANSFER", "QR"]);
const MAX_MONEY_DELTA = 0.005;

interface PaymentSessionRow {
  id: string;
  business_id?: string | null;
  branch_id?: string | null;
  provider: string;
  provider_reference?: string | null;
  currency: string;
  amount: number | string;
  status: PaymentStatus;
  idempotency_key?: string | null;
  metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
  expires_at?: string | null;
}

export class PaymentSessionManager {
  static async create(params: {
    provider: PaymentProviderName;
    currency: CurrencyCode;
    amount: number;
    businessId?: string;
    branchId?: string | null;
    providerReference?: string | null;
    idempotencyKey?: string | null;
    metadata?: Record<string, unknown>;
    expiresAt?: string | null;
    saleId?: string | null;
    subscriptionPaymentId?: string | null;
  }): Promise<PaymentSession> {
    PaymentSessionManager.validateBaseInput(params);

    const now = nowIso();
    const sessionId = crypto.randomUUID();
    const idempotencyKey = params.idempotencyKey?.trim() || sessionId;

    if (idempotencyKey.length > 200) {
      throw new Error("PAYMENT_SESSION_IDEMPOTENCY_REQUIRED: máximo 200 caracteres.");
    }

    if (params.saleId) {
      if (!params.businessId) {
        throw new Error("PAYMENT_SESSION_BUSINESS_REQUIRED");
      }

      return this.createForSale({
        saleId: params.saleId,
        paymentMethod: "CARD",
        externalAmount: params.amount,
        idempotencyKey,
        metadata: params.metadata
      });
    }

    if (params.subscriptionPaymentId) {
      const existing = await this.findByIdempotencyKey(idempotencyKey);
      if (existing) return existing;
    }

    let businessCurrency: CurrencyCode | null = null;

    if (params.businessId) {
      const { data: business, error: businessError } = await supabase
        .from("businesses")
        .select("currency")
        .eq("id", params.businessId)
        .maybeSingle();

      if (businessError) {
        throw new Error(`PAYMENT_SESSION_BUSINESS_GET_FAILED: ${businessError.message}`);
      }

      if (business?.currency) {
        businessCurrency = business.currency as CurrencyCode;
      }
    }

    const currency = businessCurrency ?? params.currency;

    return {
      id: sessionId,
      businessId: params.businessId,
      branchId: params.branchId,
      provider: params.provider,
      providerReference: params.providerReference,
      currency,
      amount: params.amount,
      status: "pending",
      idempotencyKey,
      metadata: params.metadata ?? {},
      createdAt: now,
      updatedAt: now,
      expiresAt:
        params.expiresAt ??
        new Date(Date.now() + 30 * 60 * 1000).toISOString()
    };
  }

  static async createForSale(params: {
    saleId: string;
    paymentMethod: "CARD" | "TRANSFER" | "QR" | "MIXED";
    cashAmount?: number;
    externalAmount?: number;
    idempotencyKey: string;
    shiftId?: string | null;
    cashRegisterId?: string | null;
    metadata?: Record<string, unknown>;
  }): Promise<PaymentSession> {
    if (!params.saleId?.trim()) {
      throw new Error("PAYMENT_SESSION_SALE_ID_REQUIRED");
    }

    const method = params.paymentMethod.toUpperCase() as typeof params.paymentMethod;
    if (!PAYMENT_METHODS.has(method)) {
      throw new Error(`PAYMENT_SESSION_METHOD_INVALID: ${params.paymentMethod}`);
    }

    const idempotencyKey = params.idempotencyKey?.trim() ?? "";
    if (!idempotencyKey || idempotencyKey.length > 200) {
      throw new Error("PAYMENT_SESSION_IDEMPOTENCY_REQUIRED");
    }

    const cashAmount = params.cashAmount ?? 0;
    const externalAmount = params.externalAmount ?? 0;

    if (!Number.isFinite(cashAmount) || cashAmount < 0) {
      throw new Error("PAYMENT_SESSION_CASH_AMOUNT_INVALID");
    }

    if (!Number.isFinite(externalAmount) || externalAmount <= 0) {
      throw new Error("PAYMENT_SESSION_EXTERNAL_AMOUNT_INVALID");
    }

    if (
      PROVIDER_METHODS.has(method) &&
      Math.abs(cashAmount) > MAX_MONEY_DELTA
    ) {
      throw new Error(
        "PAYMENT_SESSION_CASH_AMOUNT_MUST_BE_ZERO_FOR_EXTERNAL_PROVIDER"
      );
    }

    if (TERMINAL_METHODS.has(method) && externalAmount <= 0) {
      throw new Error("PAYMENT_SESSION_EXTERNAL_AMOUNT_REQUIRED");
    }

    if (method === "MIXED" && cashAmount <= 0) {
      throw new Error("PAYMENT_SESSION_MIXED_CASH_REQUIRED");
    }

    const rpcParams: Record<string, unknown> = {
      p_sale_id: params.saleId.trim(),
      p_payment_method: method,
      p_cash_amount: cashAmount,
      p_external_amount: externalAmount,
      p_idempotency_key: idempotencyKey
    };

    if (params.shiftId?.trim()) {
      rpcParams.p_shift_id = params.shiftId.trim();
    }

    if (params.cashRegisterId?.trim()) {
      rpcParams.p_cash_register_id = params.cashRegisterId.trim();
    }

    const { data, error } = await supabase.rpc(
      "create_wompi_sale_payment_session_atomic",
      rpcParams
    );

    if (error) {
      throw new Error(`PAYMENT_SESSION_CREATE_FAILED: ${error.message}`);
    }

    const row = this.getRpcRow(data);

    if (!row.success) {
      throw new Error(
        `PAYMENT_SESSION_CREATE_FAILED: ${row.error ?? row.message ?? "Unknown error"}`
      );
    }

    if (!row.session || typeof row.session !== "object") {
      throw new Error(
        "PAYMENT_SESSION_CREATE_FAILED: la RPC no devolvió la sesión."
      );
    }

    return this.mapRowToSession(row.session as Record<string, unknown>);
  }

  static async get(sessionId: string): Promise<PaymentSession | null> {
    const normalizedId = sessionId?.trim();
    if (!normalizedId) {
      throw new Error("PAYMENT_SESSION_ID_REQUIRED");
    }

    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("id", normalizedId)
      .maybeSingle();

    if (error) {
      throw new Error(`PAYMENT_SESSION_GET_FAILED: ${error.message}`);
    }

    return data
      ? this.mapRowToSession(data as unknown as Record<string, unknown>)
      : null;
  }

  static async findByIdempotencyKey(
    idempotencyKey: string
  ): Promise<PaymentSession | null> {
    const normalizedKey = idempotencyKey?.trim();
    if (!normalizedKey) {
      throw new Error("PAYMENT_SESSION_IDEMPOTENCY_REQUIRED");
    }

    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("idempotency_key", normalizedKey)
      .maybeSingle();

    if (error) {
      throw new Error(`PAYMENT_SESSION_FIND_FAILED: ${error.message}`);
    }

    return data
      ? this.mapRowToSession(data as unknown as Record<string, unknown>)
      : null;
  }

  /**
   * PaymentSessionManager vive en el navegador. payment_sessions revoca
   * UPDATE para authenticated; por eso una mutación genérica aquí sería un
   * falso camino de escritura. Los webhooks/Edge Functions deben modificar
   * el estado server-side mediante sus RPCs/triggers.
   */
  static async updateStatus(
    _sessionId: string,
    _status: PaymentStatus,
    _patch: Partial<PaymentSession> = {}
  ): Promise<PaymentSession | null> {
    throw new Error(
      "PAYMENT_SESSION_UPDATE_SERVER_ONLY: las sesiones de pago solo se actualizan mediante RPC/Edge Function del servidor."
    );
  }

  static async listAll(): Promise<PaymentSession[]> {
    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`PAYMENT_SESSION_LIST_FAILED: ${error.message}`);
    }

    return (data ?? []).map((row) =>
      this.mapRowToSession(row as unknown as Record<string, unknown>)
    );
  }

  static async clearExpired(_now: Date = new Date()): Promise<number> {
    throw new Error(
      "PAYMENT_SESSION_CLEAR_SERVER_ONLY: la limpieza de sesiones expiradas debe ejecutarse en servidor/cron con service_role."
    );
  }

  private static validateBaseInput(params: {
    provider: PaymentProviderName;
    currency: CurrencyCode;
    amount: number;
  }): void {
    if (!params.provider) {
      throw new Error("PAYMENT_SESSION_PROVIDER_REQUIRED");
    }

    if (!params.currency) {
      throw new Error("PAYMENT_SESSION_CURRENCY_REQUIRED");
    }

    if (!Number.isFinite(params.amount) || params.amount <= 0) {
      throw new Error("PAYMENT_SESSION_AMOUNT_INVALID");
    }
  }

  private static getRpcRow(data: unknown): {
    success?: boolean;
    error?: string;
    message?: string;
    session?: unknown;
  } {
    if (Array.isArray(data)) {
      const first = data[0];
      return first && typeof first === "object"
        ? (first as {
            success?: boolean;
            error?: string;
            message?: string;
            session?: unknown;
          })
        : {};
    }

    if (data && typeof data === "object") {
      return data as {
        success?: boolean;
        error?: string;
        message?: string;
        session?: unknown;
      };
    }

    return {};
  }

  private static mapRowToSession(
    row: Record<string, unknown>
  ): PaymentSession {
    const id = this.requireString(row.id, "id");
    const provider = this.requireProvider(row.provider);
    const currency = this.requireCurrency(row.currency);
    const amount = Number(row.amount);

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("PAYMENT_SESSION_INVALID_ROW: amount inválido.");
    }

    const status = this.requirePaymentStatus(row.status);

    return {
      id,
      businessId: this.optionalString(row.business_id) ?? undefined,
      branchId: this.optionalString(row.branch_id),
      provider,
      providerReference: this.optionalString(row.provider_reference),
      currency,
      amount,
      status,
      idempotencyKey: this.optionalString(row.idempotency_key),
      metadata:
        row.metadata && typeof row.metadata === "object"
          ? (row.metadata as Record<string, unknown>)
          : {},
      createdAt: this.requireString(row.created_at, "created_at"),
      updatedAt: this.requireString(row.updated_at, "updated_at"),
      expiresAt: this.optionalString(row.expires_at)
    };
  }

  private static requireString(value: unknown, field: string): string {
    if (typeof value !== "string" || !value.trim()) {
      throw new Error(`PAYMENT_SESSION_INVALID_ROW: ${field} inválido.`);
    }
    return value;
  }

  private static optionalString(value: unknown): string | null | undefined {
    if (value === null || value === undefined) return value;
    return typeof value === "string" ? value : String(value);
  }

  private static requireProvider(value: unknown): PaymentProviderName {
    if (value === "wompi" || value === "mercadopago" || value === "paypal") {
      return value;
    }
    throw new Error("PAYMENT_SESSION_INVALID_ROW: provider inválido.");
  }

  private static requireCurrency(value: unknown): CurrencyCode {
    if (
      value === "COP" ||
      value === "MXN" ||
      value === "ARS" ||
      value === "CLP" ||
      value === "PEN" ||
      value === "USD" ||
      value === "EUR"
    ) {
      return value;
    }
    throw new Error("PAYMENT_SESSION_INVALID_ROW: currency inválida.");
  }

  private static requirePaymentStatus(value: unknown): PaymentStatus {
    if (
      value === "pending" ||
      value === "approved" ||
      value === "declined" ||
      value === "cancelled" ||
      value === "expired" ||
      value === "refunded" ||
      value === "partially_refunded" ||
      value === "error"
    ) {
      return value;
    }
    throw new Error("PAYMENT_SESSION_INVALID_ROW: status inválido.");
  }
}
