// ============================================================================
// mercadopago-cancel (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN — Cancelar una transacción de Mercado Pago.
// PUT /v1/payments/{id} con status: "cancelled".
//
// CONTRATO:
//   Body: { paymentId }
//   Respuesta: { ok: true, payment }
//
// SEGURIDAD:
//   - JWT obligatorio.
//   - ADMIN.
//   - paymentId debe corresponder a un subscription_payment del negocio.
//   - MERCADOPAGO_ACCESS_TOKEN server-side.
//
// NOTA:
//   Mercado Pago solo permite cancelar pagos pendientes/en proceso.
//   Si ya fue capturado, se debe usar reembolso (refund).
//   NUNCA se simula una cancelación; si Mercado Pago rechaza, se devuelve error.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const corsHeaders = (() => {
  const origin = Deno.env.get("VIMDY_APP_URL") ?? SUPABASE_URL ?? "*";
  return {
    "Access-Control-Allow-Origin": origin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, OPTIONS"
  };
})();

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface RequestPayload {
  paymentId?: string;
}

interface MercadoPagoPaymentResponse {
  id?: string;
  status?: string;
  status_detail?: string;
  transaction_amount?: number;
  currency_id?: string;
  date_created?: string;
  date_approved?: string;
  reference_id?: string;
  error?: unknown;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const MERCADOPAGO_ENV = (Deno.env.get("MERCADOPAGO_ENV") ?? "sandbox") as "sandbox" | "live";

function resolveMercadoPagoApiBase(): string {
  return MERCADOPAGO_ENV === "live"
    ? "https://api.mercadopago.com"
    : "https://api.mercadopago.com";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }
  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }
  if (!MERCADOPAGO_ACCESS_TOKEN) {
    return json({ error: "MERCADOPAGO_CONFIG_MISSING: falta MERCADOPAGO_ACCESS_TOKEN" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }
  const authUser = userData.user;

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const paymentId = payload.paymentId?.trim();
  if (!paymentId) {
    return json({ error: "Falta el campo: paymentId." }, 400);
  }

  try {
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, status, amount, currency, mercadopago_payment_id")
      .or(`mercadopago_payment_id.eq.${paymentId},id.eq.${paymentId}`)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }
    if (!paymentRow) {
      return json({ error: "TRANSACTION_NOT_FOUND: esta transacción no pertenece a VIMDY." }, 404);
    }

    const { data: membership, error: membershipError } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("business_id", paymentRow.business_id)
      .maybeSingle();

    if (membershipError) {
      return json({ error: "MEMBERSHIP_CHECK_FAILED", detail: membershipError.message }, 500);
    }
    if (!membership) {
      return json({ error: "NOT_A_MEMBER" }, 403);
    }
    if (membership.role !== "ADMIN") {
      return json({ error: "FORBIDDEN: solo un administrador puede cancelar esta transacción." }, 403);
    }

    if (paymentRow.status === "cancelled" || paymentRow.status === "refunded") {
      return json({ error: `PAYMENT_ALREADY_${paymentRow.status.toUpperCase()}: no se puede cancelar.` }, 409);
    }

    const mpPaymentId = (paymentRow as any).mercadopago_payment_id ?? paymentId;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const mpResponse = await fetch(`${resolveMercadoPagoApiBase()}/v1/payments/${encodeURIComponent(mpPaymentId)}`, {
      method: "PUT",
      headers: {
        "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ status: "cancelled" }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const mpBody = (await mpResponse.json()) as MercadoPagoPaymentResponse;

    if (!mpResponse.ok || mpBody.error) {
      const detail = (mpBody.error as any)?.message ?? `MercadoPago respondió HTTP ${mpResponse.status}.`;
      return json({ error: "MERCADOPAGO_CANCEL_REJECTED", detail, status: mpResponse.status }, mpResponse.status);
    }

    const { error: updateError } = await admin
      .from("subscription_payments")
      .update({ status: "cancelled" })
      .eq("id", paymentRow.id);

    if (updateError) {
      return json({ error: "PAYMENT_UPDATE_FAILED", detail: updateError.message }, 500);
    }

    return json({ ok: true, payment: mpBody });
  } catch (error) {
    return json({ error: "MERCADOPAGO_CANCEL_FAILED", detail: String(error) }, 500);
  }
});
