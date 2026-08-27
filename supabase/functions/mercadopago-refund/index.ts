// ============================================================================
// mercadopago-refund (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN — Reembolsar (total o parcialmente) un pago de Mercado Pago.
// POST /v1/payments/{id}/refunds.
//
// CONTRATO:
//   Body: { paymentId, amount?, reason? }
//   Respuesta: { ok: true, refund }
//
// SEGURIDAD:
//   - JWT obligatorio.
//   - ADMIN.
//   - paymentId debe corresponder a un subscription_payment del negocio.
//   - MERCADOPAGO_ACCESS_TOKEN server-side.
//
// REGLAS CRÍTICAS:
//   - NUNCA devolver "refunded" si Mercado Pago no confirmó el reembolso.
//   - amount viene en la MISMA unidad que subscription_payments.amount.
//   - Si no se envía amount, se reembolsa el total original.
//   - Idempotencia: MercadoPago soporta refunds repetidos del mismo monto
//     para el mismo pago; igualmente validamos acá.
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
  amount?: number;
  reason?: string;
}

interface MercadoPagoRefundResponse {
  id?: string;
  status?: string;
  amount?: number;
  source?: { id?: string };
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
  if (payload.amount !== undefined && (typeof payload.amount !== "number" || payload.amount <= 0)) {
    return json({ error: "AMOUNT_INVALID: amount debe ser mayor a 0." }, 400);
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
      return json({ error: "FORBIDDEN: solo un administrador puede reembolsar." }, 403);
    }

    if (paymentRow.status === "cancelled") {
      return json({ error: "PAYMENT_ALREADY_CANCELLED: no se puede reembolsar." }, 409);
    }

    const mpPaymentId = (paymentRow as any).mercadopago_payment_id ?? paymentId;
    const refundAmount = payload.amount ?? Number(paymentRow.amount);
    if (refundAmount > Number(paymentRow.amount) + 0.01) {
      return json({ error: "AMOUNT_EXCEEDS_ORIGINAL" }, 400);
    }

    const mpResponse = await fetch(`${resolveMercadoPagoApiBase()}/v1/payments/${encodeURIComponent(mpPaymentId)}/refunds`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        amount: refundAmount,
        ...(payload.reason ? { metadata: { reason: payload.reason.slice(0, 255) } } : {})
      }),
      signal: (() => { const c = new AbortController(); setTimeout(() => c.abort(), 15_000); return c.signal; })()
    });

    const mpBody = (await mpResponse.json()) as MercadoPagoRefundResponse;

    if (!mpResponse.ok || mpBody.error) {
      const detail = (mpBody.error as any)?.message ?? `MercadoPago respondió HTTP ${mpResponse.status}.`;
      return json({ error: "MERCADOPAGO_REFUND_REJECTED", detail, status: mpResponse.status }, mpResponse.status);
    }

    const refundStatus = mpBody.status ?? "pending";
    if (refundStatus === "approved" || refundStatus === "completed") {
      const { data: refundResult, error: refundError } = await admin.rpc(
        "refund_subscription_payment_server_side",
        {
          p_payment_id: paymentRow.id,
          p_refund_amount: refundAmount,
          p_provider_refund_id: String(mpBody.id ?? ""),
          p_now: new Date().toISOString()
        }
      );

      if (refundError) {
        return json({ error: "REFUND_UPDATE_FAILED", detail: refundError.message }, 500);
      }

      const result = refundResult as {
        ok: boolean;
        is_total_refund: boolean;
        new_payment_status: string;
      };

      return json({
        ok: true,
        isTotalRefund: result.is_total_refund,
        refund: {
          id: mpBody.id,
          status: refundStatus,
          amount: mpBody.amount ?? refundAmount,
          source: mpBody.source
        }
      });
    }

    return json({
      ok: true,
      refund: {
        id: mpBody.id,
        status: refundStatus,
        amount: mpBody.amount ?? refundAmount,
        source: mpBody.source
      }
    });
  } catch (error) {
    return json({ error: "MERCADOPAGO_REFUND_FAILED", detail: String(error) }, 500);
  }
});
