/* ===========================================================================
   subscriptionContext
   ---------------------------------------------------------------------------
   VIMDY — FASE 7, PASO 7. Misma idea que authBusinessContext.ts: funciones
   sueltas que hablan directo con Supabase, sin estado propio (el estado
   vive en subscriptionStore.ts). Se separa de authBusinessContext.ts para
   no mezclar "a qué negocio pertenezco" con "qué tan vigente está mi plan".

   MISIÓN 2 — Seguridad de suscripciones: `plan`, `trial_ends_at`,
   `payment_status`, `renewal_date` y `next_charge_at` en `businesses` NO
   se pueden escribir desde el cliente bajo ninguna circunstancia (ver
   supabase/schema.sql, sección 8: esas columnas ni siquiera tienen GRANT
   de UPDATE para el rol `authenticated`).

   MISIÓN 3 — este archivo ya NO expone ninguna función que active un plan
   directamente. La única vía de activación real es wompi-webhook (Edge
   Function servidor a servidor, firmada por Wompi con WOMPI_EVENTS_SECRET,
   ver supabase/functions/wompi-webhook/index.ts). Este módulo se queda
   estrictamente en LECTURA: leer el estado de la suscripción y su
   historial de pagos, nunca escribirlo.
=========================================================================== */

import { supabase } from "./supabaseClient";
import { Subscription, SubscriptionPayment, SubscriptionPlan } from "../../core/entities/SubscriptionTypes";

interface BusinessSubscriptionRow {
  plan: string;
  trial_ends_at: string | null;
  renewal_date: string | null;
  next_charge_at: string | null;
  payment_method: string | null;
  payment_status: string | null;
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
 *
 * Es una simple LECTURA (select) — no está sujeta a la Misión 2, que solo
 * restringe ESCRITURAS. La policy `businesses_member_access` ya garantiza
 * que un negocio solo puede leer su propia fila.
 */
export async function fetchSubscription(businessId: string): Promise<Subscription | null> {
  const { data, error } = await supabase
    .from("businesses")
    .select("plan, trial_ends_at, renewal_date, next_charge_at, payment_method, payment_status")
    .eq("id", businessId)
    .single();

  if (error || !data) return null;
  return toSubscription(businessId, data as BusinessSubscriptionRow);
}

/**
 * PASO 8 — Historial de pagos en Configuración > Suscripción. Vacío hasta
 * que exista al menos un cobro real por Wompi. También es solo lectura;
 * `subscription_payments` ya tiene `grant select` para `authenticated` y
 * ningún `grant insert/update` (ver subscriptions_migration.sql) — el
 * cliente nunca escribe su propio historial de pagos.
 */
export async function fetchSubscriptionPayments(businessId: string): Promise<SubscriptionPayment[]> {
  const { data, error } = await supabase
    .from("subscription_payments")
    .select(
      "id, plan, amount, currency, status, payment_method, wompi_reference, mercadopago_reference, paypal_order_id, paid_at"
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
    paidAt: new Date(row.paid_at as string)
  }));
}