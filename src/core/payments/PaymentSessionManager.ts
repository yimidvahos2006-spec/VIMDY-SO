/**
 * PaymentSessionManager.ts
 * ---------------------------------------------------------------------------
 * Mantiene el estado de las sesiones de checkout y permite persistirlas en
 * la tabla payment_sessions de Supabase (PostgreSQL). Esta es la fuente
 * autoritativa server-side para sesiones de pago, con RLS, tenant isolation,
 * índices, constraints e idempotencia.
 */

import { supabase } from "../../infrastructure/supabase/supabaseClient";
import type { PaymentSession } from "./models/PaymentModels";
import type { CountryCode, CurrencyCode, PaymentProviderName, PaymentStatus } from "./types/payment.types";
import { generatePaymentId, nowIso } from "./utils/paymentUtils";

export class PaymentSessionManager {
  static async create(params: {
    provider: PaymentProviderName;
    country: CountryCode;
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
    const now = nowIso();
    const sessionId = generatePaymentId("session");

    const { data, error } = await supabase
      .from("payment_sessions")
      .insert({
        id: sessionId,
        business_id: params.businessId,
        branch_id: params.branchId,
        sale_id: params.saleId,
        subscription_payment_id: params.subscriptionPaymentId,
        provider: params.provider,
        payment_method: null,
        amount: params.amount,
        currency: params.currency,
        status: "pending",
        provider_reference: params.providerReference,
        idempotency_key: params.idempotencyKey ?? sessionId,
        actor_id: null,
        metadata: params.metadata ?? {},
        expires_at: params.expiresAt ?? new Date(Date.now() + 30 * 60 * 1000).toISOString(),
        created_at: now,
        updated_at: now,
      })
      .select()
      .single();

    if (error) {
      throw new Error(`PAYMENT_SESSION_CREATE_FAILED: ${error.message}`);
    }

    return this.mapRowToSession(data);
  }

  static async get(sessionId: string): Promise<PaymentSession | null> {
    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("id", sessionId)
      .maybeSingle();

    if (error) {
      throw new Error(`PAYMENT_SESSION_GET_FAILED: ${error.message}`);
    }

    return data ? this.mapRowToSession(data) : null;
  }

  static async findByIdempotencyKey(idempotencyKey: string): Promise<PaymentSession | null> {
    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .eq("idempotency_key", idempotencyKey)
      .maybeSingle();

    if (error) {
      throw new Error(`PAYMENT_SESSION_FIND_FAILED: ${error.message}`);
    }

    return data ? this.mapRowToSession(data) : null;
  }

  static async updateStatus(
    sessionId: string,
    status: PaymentStatus,
    patch: Partial<PaymentSession> = {}
  ): Promise<PaymentSession | null> {
    const updateData: Record<string, unknown> = {
      status,
      updated_at: nowIso(),
    };

    if (patch.providerReference !== undefined) {
      updateData.provider_reference = patch.providerReference;
    }
    if (patch.metadata !== undefined) {
      updateData.metadata = patch.metadata;
    }

    const { data, error } = await supabase
      .from("payment_sessions")
      .update(updateData)
      .eq("id", sessionId)
      .select()
      .single();

    if (error) {
      throw new Error(`PAYMENT_SESSION_UPDATE_FAILED: ${error.message}`);
    }

    return data ? this.mapRowToSession(data) : null;
  }

  static async listAll(): Promise<PaymentSession[]> {
    const { data, error } = await supabase
      .from("payment_sessions")
      .select("*")
      .order("created_at", { ascending: false });

    if (error) {
      throw new Error(`PAYMENT_SESSION_LIST_FAILED: ${error.message}`);
    }

    return (data ?? []).map(this.mapRowToSession);
  }

  static async clearExpired(now: Date = new Date()): Promise<number> {
    const { data, error } = await supabase
      .from("payment_sessions")
      .delete()
      .lt("expires_at", now.toISOString())
      .select("id");

    if (error) {
      throw new Error(`PAYMENT_SESSION_CLEAR_FAILED: ${error.message}`);
    }

    return data?.length ?? 0;
  }

  private static mapRowToSession(row: any): PaymentSession {
    return {
      id: row.id,
      businessId: row.business_id,
      branchId: row.branch_id,
      provider: row.provider,
      providerReference: row.provider_reference,
      country: row.country,
      currency: row.currency,
      amount: Number(row.amount),
      status: row.status,
      idempotencyKey: row.idempotency_key,
      metadata: row.metadata ?? {},
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      expiresAt: row.expires_at,
    };
  }
}