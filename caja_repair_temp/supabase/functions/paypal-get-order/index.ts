// ============================================================================
// paypal-get-order (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Consulta el estado REAL de una orden en PayPal (GET /v2/checkout/orders/
// :id). A diferencia de Wompi (GET /v1/transactions/:id es pública), la API
// de PayPal exige un access token OAuth que solo se puede obtener con
// PAYPAL_CLIENT_SECRET — por eso esto no puede llamarse directo desde el
// navegador y PayPalProvider.getPayment() delega acá.
//
// CONTRATO:
//   Body: { orderId }  (el `paypal_order_id` que ya conoce VIMDY)
//   Respuesta: { ok: true, order }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT.
//   - La orden consultada tiene que pertenecer a un `paypal_order_id` que
//     exista en `subscription_payments` del `business_id` al que pertenece
//     el usuario que llama — igual que en paypal-refund-transaction, para
//     que nadie pueda consultar la orden de otro negocio adivinando un id.
//
// CONFIGURACIÓN REQUERIDA (las mismas que ya usan paypal-checkout / paypal-webhook):
//   supabase secrets set PAYPAL_CLIENT_ID=...
//   supabase secrets set PAYPAL_CLIENT_SECRET=...
//   supabase secrets set PAYPAL_ENV=sandbox        (o "live")
//
// Despliegue:
//   supabase functions deploy paypal-get-order
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

interface RequestPayload {
  orderId?: string;
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

  const orderId = payload.orderId?.trim();
  if (!orderId) {
    return json({ error: "Falta el campo: orderId es obligatorio." }, 400);
  }

  try {
    // La orden tiene que pertenecer a un negocio del que el usuario que
    // llama sí sea miembro — evita que cualquier cuenta autenticada pueda
    // consultar la orden de OTRO negocio con solo adivinar un orderId.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("business_id")
      .eq("paypal_order_id", orderId)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }
    if (!paymentRow) {
      return json({ error: "PAYMENT_NOT_FOUND: esta orden no pertenece a VIMDY." }, 404);
    }

    const { data: membership } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("business_id", paymentRow.business_id)
      .maybeSingle();

    if (!membership) {
      return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
    }

    const accessToken = await getPayPalAccessToken();
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const orderResponse = await fetch(`${resolvePayPalApiBase()}/v2/checkout/orders/${orderId}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!orderResponse.ok) {
      return json(
        { error: "PAYPAL_ORDER_LOOKUP_FAILED", detail: `PayPal respondió HTTP ${orderResponse.status}.` },
        502
      );
    }

    const order = await orderResponse.json();
    return json({ ok: true, order });
  } catch (error) {
    return json({ error: "PAYPAL_GET_ORDER_FAILED", detail: String(error) }, 500);
  }
});