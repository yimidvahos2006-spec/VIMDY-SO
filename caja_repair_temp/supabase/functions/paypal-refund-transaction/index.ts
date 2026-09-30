// ============================================================================
// paypal-refund-transaction (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Único punto autorizado para REEMBOLSAR (total o parcialmente) un pago de
// PayPal ya capturado (POST /v2/payments/captures/:capture_id/refund). Exige
// PAYPAL_CLIENT_SECRET, así que jamás puede ejecutarse en el navegador —
// PayPalProvider.refundPayment() delega acá por eso, mismo patrón que
// wompi-refund-transaction.
//
// CONTRATO:
//   El cliente llama a esta función con una sesión activa
//   (PayPalProvider.ts -> refundPayment()). supabase-js adjunta el
//   Authorization: Bearer <token> automáticamente.
//
//   Body: { paymentId, amount?, reason? }
//   `paymentId` es el id que VIMDY conoce (el `id` de subscription_payments
//   o el `paypal_order_id`) — nunca el capture id directo, para no exponer
//   el id interno de PayPal como algo que el cliente pueda inventar.
//   Respuesta: { ok: true, refund }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - El pago a reembolsar tiene que pertenecer a un `paypal_order_id` (o
//     id propio) que exista en `subscription_payments` del `business_id`
//     al que pertenece el usuario que llama, y ese usuario debe ser ADMIN
//     — igual que wompi-refund-transaction.
//   - Solo se permite reembolsar un pago que ya esté 'approved' en nuestro
//     propio histórico Y que tenga un `paypal_capture_id` guardado (lo
//     guarda paypal-webhook en el momento de la captura real). Sin capture
//     id no hay nada que reembolsar en la API de PayPal.
//   - `amount` es opcional y viaja en la MISMA unidad que
//     `subscription_payments.amount` (no en centavos). Si no se envía, se
//     reembolsa el monto total original de esa fila, nunca lo que el
//     cliente diga que se cobró.
//   - PAYPAL_CLIENT_SECRET solo vive como secret de esta función.
//
// CONFIGURACIÓN REQUERIDA (las mismas que ya usan paypal-checkout / paypal-webhook):
//   supabase secrets set PAYPAL_CLIENT_ID=...
//   supabase secrets set PAYPAL_CLIENT_SECRET=...
//   supabase secrets set PAYPAL_ENV=sandbox        (o "live")
//
// Despliegue:
//   supabase functions deploy paypal-refund-transaction
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

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

interface PayPalRefundApiResponse {
  id?: string;
  status?: string;
  amount?: { currency_code?: string; value?: string };
  name?: string;
  message?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = Deno.env.get("PAYPAL_ENV") ?? "sandbox";

function resolvePayPalApiBase(): string {
  return PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(): Promise<string> {
  const credentials = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${resolvePayPalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded"
    },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`No se pudo autenticar con PayPal (HTTP ${response.status}).`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
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
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    return json({ error: "PAYPAL_CONFIG_MISSING: falta PAYPAL_CLIENT_ID o PAYPAL_CLIENT_SECRET" }, 500);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessTokenHeader = authHeader?.replace(/^Bearer\s+/i, "").trim();
  if (!accessTokenHeader) {
    return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessTokenHeader);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID: tu sesión no es válida o expiró." }, 401);
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
    return json({ error: "Falta el campo: paymentId es obligatorio." }, 400);
  }
  if (payload.amount !== undefined && (typeof payload.amount !== "number" || payload.amount <= 0)) {
    return json({ error: "AMOUNT_INVALID: si se envía, amount debe ser un número mayor a 0." }, 400);
  }

  try {
    // 1) El pago tiene que corresponder a un cobro que ESTA integración
    //    generó — nunca se le pasa un id crudo a PayPal sin antes saber a
    //    qué negocio pertenece.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, status, amount, currency, paypal_capture_id")
      .or(`id.eq.${paymentId},paypal_order_id.eq.${paymentId}`)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }
    if (!paymentRow) {
      return json({ error: "PAYMENT_NOT_FOUND: este pago no pertenece a VIMDY." }, 404);
    }

    // 2) El usuario debe pertenecer a ese negocio Y ser ADMIN.
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
      return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
    }
    if (membership.role !== "ADMIN") {
      return json({ error: "FORBIDDEN: solo un administrador puede reembolsar un pago." }, 403);
    }

    // 3) Solo se reembolsa un pago que de verdad se capturó.
    if (paymentRow.status !== "approved") {
      return json(
        { error: "PAYMENT_NOT_REFUNDABLE: solo se puede reembolsar un pago que esté 'approved'." },
        409
      );
    }
    if (!paymentRow.paypal_capture_id) {
      return json(
        {
          error: "NO_CAPTURE_ID: este pago no tiene un capture id de PayPal guardado, no se puede reembolsar automáticamente."
        },
        409
      );
    }

    // 4) El monto a reembolsar viene en la MISMA unidad que
    //    subscription_payments.amount. Si no se especifica, se reembolsa
    //    el monto total original de la fila, no lo que el cliente diga.
    const refundAmount = payload.amount ?? Number(paymentRow.amount);
    if (refundAmount > Number(paymentRow.amount) + 0.01) {
      return json({ error: "AMOUNT_EXCEEDS_ORIGINAL: el reembolso no puede superar lo pagado." }, 400);
    }

    // 5) Reembolsar en PayPal con el client secret — esto es lo único que
    //    este endpoint le agrega a la operación (el navegador no puede
    //    hacerlo).
    const accessToken = await getPayPalAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const paypalResponse = await fetch(
      `${resolvePayPalApiBase()}/v2/payments/captures/${paymentRow.paypal_capture_id}/refund`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
          "PayPal-Request-Id": `refund-${paymentRow.id}`
        },
        body: JSON.stringify({
          amount: { value: refundAmount.toFixed(2), currency_code: paymentRow.currency },
          note_to_payer: payload.reason?.slice(0, 255)
        }),
        signal: controller.signal
      }
    );
    clearTimeout(timeoutId);

    const refundBody = (await paypalResponse.json()) as PayPalRefundApiResponse;

    if (!paypalResponse.ok) {
      return json(
        { error: "PAYPAL_REFUND_REJECTED", detail: refundBody.message ?? `PayPal respondió HTTP ${paypalResponse.status}.` },
        502
      );
    }

    // 6) El reembolso en PayPal quedó "COMPLETED" o "PENDING" (revisión de
    //    PayPal, poco común). En ambos casos ya se movió/se moverá dinero
    //    de verdad, así que se refleja en nuestro histórico usando la función
    //    SQL server-side.
    const { data: refundResult, error: refundError } = await admin.rpc(
      "refund_subscription_payment_server_side",
      {
        p_payment_id: paymentRow.id,
        p_refund_amount: refundAmount,
        p_provider_refund_id: refundBody.id ?? "",
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

    return json({ ok: true, refund: refundBody, isTotalRefund: result.is_total_refund });
  } catch (error) {
    return json({ error: "PAYPAL_REFUND_FAILED", detail: String(error) }, 500);
  }
});