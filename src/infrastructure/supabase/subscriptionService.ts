/* ===========================================================================
   SubscriptionService
   ---------------------------------------------------------------------------
   VIMDY — FASE 7.1. Servicio para operaciones de suscripción que tocan
   Supabase.

   Toda operación que MODIFICA el estado de una suscripción pasa por aquí.
   =========================================================================== */

import { supabase } from "./supabaseClient";
import type {
  Subscription,
  SubscriptionPayment,
  SubscriptionAuditEntry
} from "../../core/entities/SubscriptionTypes";
import { subscriptionEngine } from "../../core/engines/SubscriptionEngine";

export interface StartTrialResult {
  ok: boolean;
  error?: string;
}

export interface ActivateSubscriptionResult {
  ok: boolean;
  alreadyActivated?: boolean;
  renewalNumber?: number;
  error?: string;
}

export interface RenewSubscriptionResult {
  ok: boolean;
  alreadyRenewed?: boolean;
  renewalNumber?: number;
  error?: string;
}

export interface ExpireSubscriptionResult {
  ok: boolean;
  alreadyExpired?: boolean;
  error?: string;
}

export interface RefundSubscriptionResult {
  ok: boolean;
  isTotalRefund?: boolean;
  newPaymentStatus?: string;
  error?: string;
}

export class SubscriptionService {
  async startTrial(businessId: string, actorId: string | null = null): Promise<StartTrialResult> {
    try {
      const { data: business, error: fetchError } = await supabase
        .from("businesses")
        .select("trial_used_at, plan, trial_ends_at")
        .eq("id", businessId)
        .single();

      if (fetchError || !business) {
        return { ok: false, error: "NEGOCIO_NO_ENCONTRADO" };
      }

      if (!subscriptionEngine.canStartTrial(business.trial_used_at)) {
        return { ok: false, error: "TRIAL_YA_USADO" };
      }

      if (business.plan !== "trial") {
        return { ok: false, error: "PLAN_YA_ACTIVADO" };
      }

      const now = new Date();
      const trialEndsAt = new Date(now);
      trialEndsAt.setDate(trialEndsAt.getDate() + 30);

      const { error: updateError } = await supabase
        .from("businesses")
        .update({
          trial_ends_at: trialEndsAt.toISOString(),
          trial_used_at: now.toISOString()
        })
        .eq("id", businessId);

      if (updateError) {
        return { ok: false, error: updateError.message };
      }

      const auditEntry = subscriptionEngine.createAuditEntry(
        businessId,
        "TRIAL_STARTED",
        actorId ? "admin" : "system",
        actorId,
        {
          plan: "trial",
          renewalDate: trialEndsAt.toISOString()
        },
        now
      );

      await this.insertAuditEntry(auditEntry);

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async activateSubscription(
    businessId: string,
    plan: "monthly" | "yearly",
    paymentId: string,
    actorId: string | null = null
  ): Promise<ActivateSubscriptionResult> {
    try {
      const { data: payment, error: paymentError } = await supabase
        .from("subscription_payments")
        .select("id, business_id, plan, amount, currency, status, renewal_number")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) {
        return { ok: false, error: paymentError.message };
      }

      if (!payment) {
        return { ok: false, error: "PAGO_NO_ENCONTRADO" };
      }

      if (payment.business_id !== businessId) {
        return { ok: false, error: "PAGO_NO_PERTENECE" };
      }

      if (payment.status === "declined") {
        return { ok: false, error: "PAGO_DECLINADO" };
      }

      if (payment.status === "approved") {
        const renewalNumber = payment.renewal_number ?? 1;
        return { ok: true, alreadyActivated: true, renewalNumber };
      }

      const { data, error } = await supabase.rpc("activate_subscription_server_side", {
        p_business_id: businessId,
        p_plan: plan,
        p_payment_id: paymentId,
        p_now: new Date().toISOString()
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as {
        ok: boolean;
        alreadyActivated: boolean;
        renewalNumber: number;
        renewal_date?: string;
        audit_id?: string;
      };

      if (result.alreadyActivated) {
        return { ok: true, alreadyActivated: true, renewalNumber: result.renewalNumber };
      }

      const auditEntry = subscriptionEngine.createAuditEntry(
        businessId,
        "SUBSCRIPTION_ACTIVATED",
        "payment_provider",
        actorId,
        {
          plan,
          paymentId,
          renewalNumber: result.renewalNumber,
          renewalDate: result.renewal_date
        }
      );

      await this.insertAuditEntry(auditEntry);

      return { ok: true, alreadyActivated: false, renewalNumber: result.renewalNumber };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async renewSubscription(
    businessId: string,
    plan: "monthly" | "yearly",
    paymentId: string,
    actorId: string | null = null
  ): Promise<RenewSubscriptionResult> {
    try {
      const { data: payment, error: paymentError } = await supabase
        .from("subscription_payments")
        .select("id, business_id, plan, amount, currency, status, renewal_number")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) {
        return { ok: false, error: paymentError.message };
      }

      if (!payment) {
        return { ok: false, error: "PAGO_NO_ENCONTRADO" };
      }

      if (payment.business_id !== businessId) {
        return { ok: false, error: "PAGO_NO_PERTENECE" };
      }

      if (payment.status === "declined") {
        return { ok: false, error: "PAGO_DECLINADO" };
      }

      if (payment.status === "approved") {
        const renewalNumber = payment.renewal_number ?? 1;
        return { ok: true, alreadyRenewed: true, renewalNumber };
      }

      const { data, error } = await supabase.rpc("renew_subscription_server_side", {
        p_business_id: businessId,
        p_plan: plan,
        p_payment_id: paymentId,
        p_now: new Date().toISOString()
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as {
        ok: boolean;
        alreadyRenewed: boolean;
        renewalNumber: number;
        renewal_date?: string;
        audit_id?: string;
      };

      if (result.alreadyRenewed) {
        return { ok: true, alreadyRenewed: true, renewalNumber: result.renewalNumber };
      }

      const auditEntry = subscriptionEngine.createAuditEntry(
        businessId,
        "SUBSCRIPTION_RENEWED",
        "payment_provider",
        actorId,
        {
          plan,
          paymentId,
          renewalNumber: result.renewalNumber,
          renewalDate: result.renewal_date
        }
      );

      await this.insertAuditEntry(auditEntry);

      return { ok: true, alreadyRenewed: false, renewalNumber: result.renewalNumber };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async expireSubscription(businessId: string, actorId: string | null = null): Promise<ExpireSubscriptionResult> {
    try {
      const { data, error } = await supabase.rpc("expire_subscription_server_side", {
        p_business_id: businessId,
        p_now: new Date().toISOString()
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as { ok: boolean; already_expired?: boolean; audit_id?: string };

      if (result.already_expired) {
        return { ok: true, alreadyExpired: true };
      }

      const auditEntry = subscriptionEngine.createAuditEntry(
        businessId,
        "SUBSCRIPTION_EXPIRED",
        "cron",
        actorId,
        {}
      );

      await this.insertAuditEntry(auditEntry);

      return { ok: true, alreadyExpired: false };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async refundSubscriptionPayment(
    paymentId: string,
    refundAmount: number,
    providerRefundId: string,
    actorId: string | null = null
  ): Promise<RefundSubscriptionResult> {
    try {
      const { data: payment, error: paymentError } = await supabase
        .from("subscription_payments")
        .select("id, business_id, amount, currency, status")
        .eq("id", paymentId)
        .maybeSingle();

      if (paymentError) {
        return { ok: false, error: paymentError.message };
      }

      if (!payment) {
        return { ok: false, error: "PAGO_NO_ENCONTRADO" };
      }

      if (payment.status !== "approved") {
        return { ok: false, error: "PAGO_NO_APROBADO" };
      }

      const { data, error } = await supabase.rpc("refund_subscription_payment_server_side", {
        p_payment_id: paymentId,
        p_refund_amount: refundAmount,
        p_provider_refund_id: providerRefundId,
        p_now: new Date().toISOString()
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as {
        ok: boolean;
        is_total_refund: boolean;
        new_payment_status: string;
        audit_id?: string;
      };

      const auditEntry = subscriptionEngine.createAuditEntry(
        payment.business_id,
        result.is_total_refund ? "SUBSCRIPTION_REFUNDED" : "PAYMENT_REFUNDED",
        "payment_provider",
        actorId,
        {
          paymentId,
          refundAmount,
          originalAmount: payment.amount,
          currency: payment.currency,
          providerRefundId,
          isTotalRefund: result.is_total_refund,
          newPaymentStatus: result.new_payment_status
        }
      );

      await this.insertAuditEntry(auditEntry);

      return {
        ok: true,
        isTotalRefund: result.is_total_refund,
        newPaymentStatus: result.new_payment_status
      };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async getAuditLog(businessId: string, limit = 100): Promise<SubscriptionAuditEntry[]> {
    try {
      const { data, error } = await supabase
        .from("subscription_audit_log")
        .select("id, business_id, action, actor_type, actor_id, details, created_at")
        .eq("business_id", businessId)
        .order("created_at", { ascending: false })
        .limit(limit);

      if (error || !data) {
        return [];
      }

      return data.map((row: Record<string, unknown>) => ({
        id: row.id as string,
        businessId: row.business_id as string,
        action: row.action as string,
        actorType: row.actor_type as string,
        actorId: row.actor_id as string | null,
        details: row.details as Record<string, unknown>,
        createdAt: new Date(row.created_at as string)
      }));
    } catch {
      return [];
    }
  }

  async canStartTrial(businessId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc("can_start_trial", {
        p_business_id: businessId
      });

      if (error) {
        return false;
      }

      return data as boolean;
    } catch {
      return false;
    }
  }

  async canStartTrialForUser(userId: string): Promise<boolean> {
    try {
      const { data, error } = await supabase.rpc("has_user_used_trial", {
        p_user_id: userId
      });

      if (error) {
        return false;
      }

      return !(data as boolean);
    } catch {
      return false;
    }
  }

  async recordTrialUsage(userId: string, businessId: string): Promise<{ ok: boolean; error?: string }> {
    try {
      const { error } = await supabase.rpc("record_trial_usage", {
        p_user_id: userId,
        p_business_id: businessId
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      return { ok: true };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  async cancelSubscription(businessId: string, actorId?: string): Promise<{ ok: boolean; alreadyCancelled?: boolean; error?: string }> {
    try {
      const { data, error } = await supabase.rpc("cancel_subscription_server_side", {
        p_business_id: businessId
      });

      if (error) {
        return { ok: false, error: error.message };
      }

      const result = data as { ok: boolean; already_cancelled?: boolean; audit_id?: string };

      if (result.already_cancelled) {
        return { ok: true, alreadyCancelled: true };
      }

      const auditEntry = subscriptionEngine.createAuditEntry(
        businessId,
        "SUBSCRIPTION_CANCELLED",
        actorId ? "admin" : "user",
        actorId ?? null,
        {
          cancelledAt: new Date().toISOString()
        },
        new Date()
      );

      await this.insertAuditEntry(auditEntry);

      return { ok: true, alreadyCancelled: false };
    } catch (error) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async insertAuditEntry(entry: SubscriptionAuditEntry): Promise<void> {
    await supabase.from("subscription_audit_log").insert({
      id: entry.id,
      business_id: entry.businessId,
      action: entry.action,
      actor_type: entry.actorType,
      actor_id: entry.actorId,
      details: entry.details,
      created_at: entry.createdAt.toISOString()
    });
  }
}

export const subscriptionService = new SubscriptionService();
