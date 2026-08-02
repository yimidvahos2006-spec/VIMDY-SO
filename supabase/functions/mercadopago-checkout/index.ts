// ============================================================================
// mercadopago-checkout (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Mismo patrón que wompi-create-checkout: este endpoint es el ÚNICO lugar
// que sabe la llave privada de Mercado Pago (MERCADOPAGO_ACCESS_TOKEN) y el
// ÚNICO que decide cuánto se cobra de verdad — nunca confía en un `amount`
// que venga del navegador. Solo abre la sesión de pago (preferencia); la
// activación real del plan ocurre en mercadopago-webhook cuando Mercado
// Pago confirme el cobro server-to-server.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set MERCADOPAGO_ACCESS_TOKEN=APP_USR-...   (o TEST-... en sandbox)
//   supabase secrets set VIMDY_APP_URL=https://app.vimdy.co     (para back_urls)
//
// Despliegue:
//   supabase functions deploy mercadopago-checkout
//
// LIMITACIÓN A PROPÓSITO: Mercado Pago cobra en la moneda LOCAL de cada país
// (MXN en México, ARS en Argentina, etc.) — nunca en COP. Los planes de
// VIMDY hoy solo tienen un precio verificado en COP (SUBSCRIPTION_PLANS).
// En vez de inventar una tasa de cambio, PLAN_PRICE_BY_CURRENCY abajo solo
// trae COP poblado — si un negocio en un país de Mercado Pago intenta
// pagar, este endpoint responde PRICING_NOT_CONFIGURED en vez de cobrarle
// un monto adivinado. Para habilitar un país de verdad: agregar su moneda
// acá con el precio real ya decidido (ej. "MXN": { monthly: 349, yearly: 3490 }).
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

// Única fuente de verdad server-side de cuánto vale cada plan, por moneda.
// Espejo de SUBSCRIPTION_PLANS en src/core/entities/SubscriptionTypes.ts
// para COP — agregar acá cualquier moneda nueva antes de habilitar ese país.
const PLAN_PRICE_BY_CURRENCY: Record<string, Record<Plan, number>> = {
  COP: { monthly: 79000, yearly: 790000 }
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL") ?? "https://app.vimdy.co";

function resolveMercadoPagoApiBase(): string {
  return "https://api.mercadopago.com";
}

function isSandboxToken(): boolean {
  return MERCADOPAGO_ACCESS_TOKEN?.startsWith("TEST-") ?? false;
}

interface RequestBody {
  businessId?: string;
  plan?: Plan;
}

interface MercadoPagoPreferenceResponse {
  id: string;
  init_point?: string;
  sandbox_init_point?: string;
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

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 1) El negocio y su país/moneda salen de la base de datos, nunca del
    //    body — así el cliente no puede pedir que le cobren en una moneda
    //    ajena a la suya.
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

    const currency = (business.currency as string) ?? "COP";
    const pricing = PLAN_PRICE_BY_CURRENCY[currency];

    // 2) Sin precio real verificado para esa moneda, se rechaza en vez de
    //    convertir a ciegas desde COP con una tasa de cambio inventada.
    if (!pricing) {
      return json(
        {
          error: "PRICING_NOT_CONFIGURED",
          detail: `No hay un precio de VIMDY verificado en ${currency} todavía. Defínelo en PLAN_PRICE_BY_CURRENCY antes de habilitar Mercado Pago para este país.`
        },
        409
      );
    }

    const amount = pricing[plan];
    const reference = `mp_${businessId.slice(0, 8)}_${Date.now()}`;

    // 3) Se deja el intento en 'pending' ANTES de llamar a Mercado Pago —
    //    igual que wompi-create-checkout — para que el webhook siempre
    //    tenga una fila esperándolo con el monto/moneda reales a comparar.
    const { error: insertError } = await admin.from("subscription_payments").insert({
      business_id: businessId,
      plan,
      amount,
      currency,
      status: "pending",
      mercadopago_reference: reference
    });

    if (insertError) {
      return json({ error: "PAYMENT_RECORD_FAILED", detail: insertError.message }, 500);
    }

    // 4) Crear la preferencia real en Mercado Pago (Checkout Pro).
    const planLabel = plan === "monthly" ? "Plan Mensual" : "Plan Anual";
    const response = await fetch(`${resolveMercadoPagoApiBase()}/checkout/preferences`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        items: [
          {
            title: `VIMDY — ${planLabel}`,
            quantity: 1,
            currency_id: currency,
            unit_price: amount
          }
        ],
        external_reference: reference,
        back_urls: {
          success: `${VIMDY_APP_URL}/configuracion/suscripcion?pago=exitoso`,
          failure: `${VIMDY_APP_URL}/configuracion/suscripcion?pago=fallido`,
          pending: `${VIMDY_APP_URL}/configuracion/suscripcion?pago=pendiente`
        },
        auto_return: "approved",
        notification_url: `${SUPABASE_URL}/functions/v1/mercadopago-webhook`
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      await admin.from("subscription_payments").update({ status: "declined" }).eq("mercadopago_reference", reference);
      return json({ error: "MERCADOPAGO_API_ERROR", detail: errorBody }, 502);
    }

    const preference = (await response.json()) as MercadoPagoPreferenceResponse;
    const checkoutUrl = isSandboxToken() ? preference.sandbox_init_point : preference.init_point;

    if (!checkoutUrl) {
      return json({ error: "MERCADOPAGO_MISSING_INIT_POINT" }, 502);
    }

    return json({ ok: true, checkoutUrl, reference });
  } catch (error) {
    return json({ error: "MERCADOPAGO_CHECKOUT_FAILED", detail: String(error) }, 500);
  }
});