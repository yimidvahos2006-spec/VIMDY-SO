/* ===========================================================================
   subscriptionContext
   ---------------------------------------------------------------------------
   VIMDY — FASE 7.1. Funciones sueltas que hablan directo con Supabase,
   sin estado propio (el estado vive en subscriptionStore.ts).

   MISIÓN 2 — Seguridad de suscripciones: `plan`, `trial_ends_at`,
   `payment_status`, `renewal_date` y `next_charge_at` en `businesses` NO
   se pueden escribir desde el cliente bajo ninguna circunstancia (ver
   supabase/schema.sql, sección 8: esas columnas ni siquiera tienen GRANT
   de UPDATE para el rol `authenticated`).

   MISIÓN 3 — este archivo expone funciones de LECTURA y funciones que
   delegan en funciones SQL server-side. La única vía de activación real
   es wompi-webhook / paypal-webhook / mercadopago-webhook (Edge
   Functions servidor a servidor, firmadas por el proveedor).
   =========================================================================== */

import { supabase } from "./supabaseClient";
import { Subscription, SubscriptionPayment, SubscriptionPlan, SubscriptionAuditEntry } from "../../core/entities/SubscriptionTypes";

interface BusinessSubscriptionRow {
  plan: string;
  trial_ends_at: string | null;
  trial_used_at: string | null;
  renewal_date: string | null;
  next_charge_at: string | null;
  payment_method: string | null;
  payment_status: string | null;
  subscription_status: string | null;
}

function toDate(value: string | null): Date | null {
  return value ? new Date(value) : null;
}

function toSubscription(businessId: string, row: BusinessSubscriptionRow): Subscription {
  return {
    businessId,
    plan: (row.plan as SubscriptionPlan) ?? "trial",
    trialEndsAt: toDate(row.trial_ends_at),
    renewalDate: toDate(row.renewal_date),
    nextChargeAt: toDate(row.next_charge_at),
    paymentMethod: (row.payment_method as Subscription["paymentMethod"]) ?? null,
    paymentStatus: (row.payment_status as Subscription["paymentStatus"]) ?? "none"
  };
}

/**
 * Lee el estado de suscripción del negocio activo. Se llama junto con
 * resolveBusinessSession() en AuthContext.tsx (login, registro y
 * restauración de sesión) para hidratar subscriptionStore.
 */
export async function fetchSubscription(businessId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("businesses")
    .select("plan, trial_ends_at, trial_used_at, renewal_date, next_charge_at, payment_method, payment_status, subscription_status")
    .eq("id", businessId)
    .single();

  if (error || !data) return null;
  return toSubscription(businessId, data as BusinessSubscriptionRow);
}

/**
 * PASO 8 — Historial de pagos en Configuración > Suscripción.
 */
export async function fetchSubscriptionPayments(businessId: string): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, plan, amount, currency, status, payment_method, wompi_reference, mercadopago_reference, paypal_order_id, paid_at, renewal_number, provider_refund_id, refunded_at"
    )
    .eq("business_id", businessId)
    .order("paid_at", { ascending: false });

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    plan: row.plan as SubscriptionPlan,
    amount: row.amount as number,
    currency: row.currency as string,
    status: row.status as SubscriptionPayment["status"],
    paymentMethod: row.payment_method as SubscriptionPayment["paymentMethod"],
    wompiReference: (row.wompi_reference as string | null) ?? null,
    mercadopagoReference: (row.mercadopago_reference as string | null) ?? null,
    paypalOrderId: (row.paypal_order_id as string | null) ?? null,
    paidAt: new Date(row.paid_at as string),
    renewalNumber: (row.renewal_number as number | null) ?? 0,
    providerRefundId: (row.provider_refund_id as string | null) ?? null,
    refundedAt: row.refunded_at ? new Date(row.refunded_at as string) : null
  }));
}

/**
 * Verifica si un negocio puede iniciar trial (no lo ha usado antes).
 */
export async function canStartTrial(businessId: string): Promise<boolean> {
  const { data, error } = await supabase.rpc("can_start_trial", {
    p_business_id: businessId
  });

  if (error) {
    return false;
  }

  return data as boolean;
}

/**
 * Obtiene el historial de auditoría de suscripciones de un negocio.
 */
export async function fetchSubscriptionAuditLog(businessId: string, limit = 100): Promise<SubscriptionAuditEntry[]> {
  const { data, error } = await supabase
    .from("subscription_audit_log")
    .select("id, business_id, action, actor_type, actor_id, details, created_at")
    .eq("business_id", businessId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error || !data) return [];

  return data.map((row) => ({
    id: row.id as string,
    businessId: row.business_id as string,
    action: row.action as string,
    actorType: row.actor_type as string,
    actorId: row.actor_id as string | null,
    details: row.details as Record<string, unknown>,
    createdAt: new Date(row.created_at as string)
  }));
}