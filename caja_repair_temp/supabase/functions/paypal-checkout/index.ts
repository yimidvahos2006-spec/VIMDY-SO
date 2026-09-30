// ============================================================================
// paypal-checkout (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Mismo patrón que wompi-create-checkout / mercadopago-checkout: único lugar
// que conoce PAYPAL_CLIENT_SECRET. Crea una orden real (PayPal Orders API v2,
// intent CAPTURE) y devuelve el link de aprobación. La activación real del
// plan ocurre en paypal-webhook cuando PayPal confirme la captura.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set PAYPAL_CLIENT_ID=...
//   supabase secrets set PAYPAL_CLIENT_SECRET=...
//   supabase secrets set PAYPAL_ENV=sandbox        (o "live" en producción)
//   supabase secrets set VIMDY_APP_URL=https://app.vimdy.co
//
// Despliegue:
//   supabase functions deploy paypal-checkout
//
// RECORDATORIO (ver mensaje del negocio): para que esto funcione de verdad
// hace falta una cuenta de negocio de PayPal ya verificada — ese trámite es
// aparte y toma unos días, no depende de este código.
//
// LIMITACIÓN A PROPÓSITO: igual que Mercado Pago, VIMDY hoy solo tiene un
// precio verificado en COP. PayPal siempre cobra en USD (o EUR para España)
// y no existe una tasa de cambio real definida en el código — en vez de
// inventarla, PLAN_PRICE_BY_CURRENCY abajo debe llenarse con el precio real
// en USD/EUR ya decidido por el negocio antes de habilitar PayPal.
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

type Plan = "monthly" | "yearly";

// Espejo server-side de SUBSCRIPTION_PLANS (src/core/entities/SubscriptionTypes.ts)
// Precios reales por país para los 10 países soportados.
const PLAN_PRICE_BY_COUNTRY: Record<string, Record<Plan, number>> = {
  CO: { monthly: 79000, yearly: 799000 },
  US: { monthly: 89, yearly: 899 },
  MX: { monthly: 1499, yearly: 14990 },
  PE: { monthly: 149, yearly: 1490 },
  CL: { monthly: 14990, yearly: 149900 },
  AR: { monthly: 89999, yearly: 899999 },
  EC: { monthly: 59, yearly: 599 },
  PA: { monthly: 69, yearly: 699 },
  VE: { monthly: 49, yearly: 499 },
  ES: { monthly: 69, yearly: 699 }
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = Deno.env.get("PAYPAL_ENV") ?? "sandbox";
const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL") ?? "https://app.vimdy.co";

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

  if (!response.ok) {
    throw new Error(`No se pudo autenticar con PayPal (HTTP ${response.status}).`);
  }

  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

interface RequestBody {
  businessId?: string;
  plan?: Plan;
}

interface PayPalOrderResponse {
  id: string;
  links?: { rel: string; href: string }[];
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

  let payload: RequestBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const businessId = payload.businessId;
  const plan = payload.plan;

  if (!businessId || (plan !== "monthly" && plan !== "yearly")) {
    return json({ error: "Faltan campos: businessId y plan ('monthly' | 'yearly') son obligatorios." }, 400);
  }

  // 🔒 VERIFICACIÓN DE SEGURIDAD: Verificar JWT y membresía
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

  // Verificar que el usuario es miembro del negocio
  const { data: membership, error: membershipError } = await admin
    .from("business_members")
    .select("role")
    .eq("user_id", authUser.id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (membershipError) {
    return json({ error: "MEMBERSHIP_CHECK_FAILED", detail: membershipError.message }, 500);
  }

  if (!membership) {
    return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
  }

  try {
    const { data: business, error: businessError } = await admin
      .from("businesses")
      .select("id, name, country, currency")
      .eq("id", businessId)
      .maybeSingle();

    if (businessError) {
      return json({ error: "BUSINESS_LOOKUP_FAILED", detail: businessError.message }, 500);
    }
    if (!business) {
      return json({ error: "BUSINESS_NOT_FOUND" }, 404);
    }

    const ALLOWED_PAYPAL_COUNTRIES = new Set(["CO", "MX", "PE", "CL", "AR", "ES", "EC", "PA", "US", "VE"]);
    if (!ALLOWED_PAYPAL_COUNTRIES.has(business.country)) {
      return json({ error: "COUNTRY_NOT_SUPPORTED: PayPal no está disponible para este país." }, 400);
    }

    const country = business.country;
    const pricing = PLAN_PRICE_BY_COUNTRY[country];

    if (!pricing) {
      return json(
        {
          error: "PRICING_NOT_CONFIGURED",
          detail: `No hay un precio de VIMDY verificado para ${country} todavía. Defínelo en PLAN_PRICE_BY_COUNTRY antes de habilitar PayPal.`
        },
        409
      );
    }

    const currency = business.currency;
    const amount = pricing[plan];
    const reference = `pp_${businessId.slice(0, 8)}_${Date.now()}`;
    const idempotencyKey = crypto.randomUUID();

    const fiveMinutesAgo = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    const { data: recentPending, error: recentPendingError } = await admin
      .from("subscription_payments")
      .select("id, paypal_order_id, created_at")
      .eq("business_id", businessId)
      .eq("plan", plan)
      .eq("status", "pending")
      .gte("created_at", fiveMinutesAgo)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (recentPendingError) {
      return json({ error: "PAYMENT_CHECK_FAILED", detail: recentPendingError.message }, 500);
    }

    if (recentPending) {
      // Si hay un pago pending reciente, devolverlo para evitar doble checkout
      return json({
        ok: true,
        approvalUrl: recentPending.paypal_order_id ? `${resolvePayPalApiBase()}/v2/checkout/orders/${recentPending.paypal_order_id}` : null,
        orderId: recentPending.paypal_order_id,
        existing: true
      });
    }

    const { error: insertError } = await admin.from("subscription_payments").insert({
      business_id: businessId,
      plan,
      amount,
      currency,
      status: "pending",
      paypal_order_id: null, // se completa abajo una vez PayPal confirme el id de la orden
      idempotency_key: idempotencyKey
    });

    if (insertError) {
      return json({ error: "PAYMENT_RECORD_FAILED", detail: insertError.message }, 500);
    }

    const accessToken = await getPayPalAccessToken();
    const planLabel = plan === "monthly" ? "Plan Mensual" : "Plan Anual";
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const orderResponse = await fetch(`${resolvePayPalApiBase()}/v2/checkout/orders`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        intent: "CAPTURE",
        purchase_units: [
          {
            custom_id: reference,
            description: `VIMDY — ${planLabel}`,
            amount: { currency_code: currency, value: amount.toFixed(2) }
          }
        ],
        application_context: {
          brand_name: "VIMDY",
          return_url: `${VIMDY_APP_URL}/configuracion/suscripcion?pago=exitoso`,
          cancel_url: `${VIMDY_APP_URL}/configuracion/suscripcion?pago=cancelado`,
          user_action: "PAY_NOW"
        }
      }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!orderResponse.ok) {
      const errorBody = await orderResponse.text();
      await admin
        .from("subscription_payments")
        .update({ status: "declined" })
        .eq("business_id", businessId)
        .is("paypal_order_id", null)
        .eq("status", "pending");
      return json({ error: "PAYPAL_API_ERROR", detail: errorBody }, 502);
    }

    const order = (await orderResponse.json()) as PayPalOrderResponse;

    // Guardar el id real de la orden de PayPal para que paypal-webhook
    // pueda conciliar la captura contra esta fila exacta.
    const { error: updateError } = await admin
      .from("subscription_payments")
      .update({ paypal_order_id: order.id })
      .eq("business_id", businessId)
      .eq("status", "pending")
      .is("paypal_order_id", null);

    if (updateError) {
      return json({ error: "PAYMENT_RECORD_UPDATE_FAILED", detail: updateError.message }, 500);
    }

    const approveLink = order.links?.find((link) => link.rel === "approve")?.href;
    if (!approveLink) {
      return json({ error: "PAYPAL_MISSING_APPROVE_LINK" }, 502);
    }

    return json({ ok: true, checkoutUrl: approveLink, reference: order.id });
  } catch (error) {
    return json({ error: "PAYPAL_CHECKOUT_FAILED", detail: String(error) }, 500);
  }
});