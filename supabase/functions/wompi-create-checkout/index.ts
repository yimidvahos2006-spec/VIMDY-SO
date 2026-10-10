// ============================================================================
// wompi-create-checkout (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Único lugar que conoce WOMPI_INTEGRITY_SECRET y el
// único que decide cuánto se cobra de verdad — nunca confía en un `amount`
// que venga del navegador (WompiProvider.ts en el cliente solo manda
// businessId + plan). Arma la firma de integridad exigida por el Web
// Checkout de Wompi y devuelve la URL ya firmada; la activación real del
// plan ocurre en wompi-webhook cuando Wompi confirme el cobro server-to-server.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_PUBLIC_KEY=pub_prod_...        (o pub_test_... en sandbox)
//   supabase secrets set WOMPI_INTEGRITY_SECRET=prod_integrity_...
//   supabase secrets set APP_BASE_URL=https://app.vimdy.co
//
// Despliegue (JWT verificado — lo llama un usuario logueado):
//   supabase functions deploy wompi-create-checkout
//
// LIMITACIÓN A PROPÓSITO: igual que mercadopago-checkout, VIMDY hoy solo
// tiene un precio verificado en COP (ver SUBSCRIPTION_PLANS en
// src/core/entities/SubscriptionTypes.ts). PLAN_PRICE_BY_CURRENCY abajo solo
// trae COP poblado — si un negocio en otro país intentara pagar con Wompi
// (poco probable, Wompi es Colombia), este endpoint responde
// PRICING_NOT_CONFIGURED en vez de cobrar un monto adivinado.
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
// y de COUNTRY_PRICE_MAP en mercadopago-checkout — misma fuente de verdad,
// una copia por Edge Function porque cada una corre aislada.
const PLAN_PRICE_BY_COUNTRY: Record<string, Record<Plan, number>> = {
  CO: { monthly: 59900, yearly: 718800 }
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_PUBLIC_KEY = Deno.env.get("WOMPI_PUBLIC_KEY");
const WOMPI_INTEGRITY_SECRET = Deno.env.get("WOMPI_INTEGRITY_SECRET");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.vimdy.co";

function resolveWompiCheckoutBase(): string {
  const isSandbox = WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ?? false;
  return isSandbox ? "https://checkout.wompi.co/p/" : "https://checkout.wompi.co/p/";
}

interface RequestBody {
  businessId?: string;
  plan?: Plan;
}

/**
 * Firma de integridad de Wompi: SHA256 hex de
 * `<reference><amount_in_cents><currency><integrity_secret>`, concatenados
 * SIN separadores, en ese orden exacto.
 * https://docs.wompi.co -> "Widget Checkout Web" -> "Firma de integridad".
 */
async function buildIntegritySignature(
  reference: string,
  amountInCents: number,
  currency: string,
  secret: string
): Promise<string> {
  const data = new TextEncoder().encode(`${reference}${amountInCents}${currency}${secret}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function buildCheckoutUrl(reference: string, amountInCents: number, currency: string, signature: string): string {
  const redirectUrl = `${APP_BASE_URL}/configuracion/suscripcion`;
  return (
    `${resolveWompiCheckoutBase()}?public-key=${encodeURIComponent(WOMPI_PUBLIC_KEY!)}` +
    `&currency=${encodeURIComponent(currency)}` +
    `&amount-in-cents=${amountInCents}` +
    `&reference=${encodeURIComponent(reference)}` +
    `&signature:integrity=${signature}` +
    `&redirect-url=${encodeURIComponent(redirectUrl)}`
  );
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

  if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    return json({ error: "WOMPI_CONFIG_MISSING: falta WOMPI_PUBLIC_KEY o WOMPI_INTEGRITY_SECRET" }, 500);
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

    if (business.country !== "CO") {
      return json({ error: "COUNTRY_NOT_SUPPORTED: Wompi solo está disponible para Colombia (CO)." }, 400);
    }

    const country = business.country;
    const pricing = PLAN_PRICE_BY_COUNTRY[country];

    // 2) Sin precio real verificado para ese país, se rechaza en vez de
    //    convertir a ciegas.
    if (!pricing) {
      return json(
        {
          error: "PRICING_NOT_CONFIGURED",
          detail: `No hay un precio de VIMDY verificado para ${country} todavía. Wompi solo opera en Colombia (COP).`
        },
        409
      );
    }

    const currency = (business.currency as string) ?? "COP";
    const amount = pricing[plan];
    const amountInCents = Math.round(amount * 100);
    const checkoutWindow = Math.floor(Date.now() / (5 * 60 * 1000));
    const reference = `wompi_${businessId}_${plan}_${checkoutWindow}`;
    const idempotencyKey = `${businessId}:${plan}:${checkoutWindow}`;

    // 3) Firma de integridad calculada antes de reutilizar un checkout pendiente
    //    para garantizar que la URL devuelta sea válida incluso al reintentar en
    //    dos pestañas o tras un refresh.
    const signature = await buildIntegritySignature(reference, amountInCents, currency, WOMPI_INTEGRITY_SECRET);

    // Referencia/clave/firma del intento que realmente se usará. Por defecto son
    // las deterministas de la ventana de 5 min; solo cambian si el intento
    // anterior de esa ventana ya fue rechazado (ver más abajo).
    let paymentReference = reference;
    let paymentIdempotencyKey = idempotencyKey;
    let paymentSignature = signature;

    // 4) La clave determinista permite reutilizar el mismo checkout en la misma
    //    ventana. Si dos peticiones concurrentes llegaran antes de que la primera
    //    inserción sea visible, la restricción única de la base de datos es la
    //    última defensa; el conflicto se resuelve recuperando la fila existente.
    const { data: existingPayment, error: existingPaymentError } = await admin
      .from("subscription_payments")
      .select("id, wompi_reference, status")
      .eq("wompi_reference", reference)
      .maybeSingle();

    if (existingPaymentError) {
      return json({ error: "PAYMENT_CHECK_FAILED", detail: existingPaymentError.message }, 500);
    }

    if (existingPayment) {
      if (existingPayment.status === "declined") {
        // Un intento rechazado ya está finalizado: reutilizar su referencia haría que
        // un pago aprobado posterior se ignorara por idempotencia en el webhook.
        // Se crea una referencia y una clave nuevas para este reintento.
        const retryId = Date.now().toString(36);
        paymentReference = `${reference}_r${retryId}`;
        paymentIdempotencyKey = `${idempotencyKey}:r${retryId}`;
        paymentSignature = await buildIntegritySignature(paymentReference, amountInCents, currency, WOMPI_INTEGRITY_SECRET);
      } else {
        const existingSignature = await buildIntegritySignature(
          existingPayment.wompi_reference,
          amountInCents,
          currency,
          WOMPI_INTEGRITY_SECRET
        );

        return json({
          ok: true,
          checkoutUrl: buildCheckoutUrl(existingPayment.wompi_reference, amountInCents, currency, existingSignature),
          reference: existingPayment.wompi_reference,
          existing: true
        });
      }
    }

    // 5) Se deja el intento en 'pending' ANTES de armar la URL de Wompi —
    //    mismo patrón que mercadopago-checkout — para que el webhook
    //    siempre tenga una fila esperándolo con el monto/moneda reales a
    //    comparar. La clave determinista y la restricción única evitan dobles
    //    intentos desde dos pestañas concurrentes.
    const { error: insertError } = await admin.from("subscription_payments").insert({
      business_id: businessId,
      plan,
      amount,
      currency,
      status: "pending",
      wompi_reference: paymentReference,
      idempotency_key: paymentIdempotencyKey
    });

    if (insertError) {
      const { data: conflictedPayment, error: conflictedPaymentError } = await admin
        .from("subscription_payments")
        .select("wompi_reference")
        .eq("wompi_reference", paymentReference)
        .maybeSingle();

      if (conflictedPaymentError) {
        return json({ error: "PAYMENT_RECORD_FAILED", detail: insertError.message }, 500);
      }

      if (!conflictedPayment) {
        return json({ error: "PAYMENT_RECORD_FAILED", detail: insertError.message }, 500);
      }

      const conflictedSignature = await buildIntegritySignature(
        conflictedPayment.wompi_reference,
        amountInCents,
        currency,
        WOMPI_INTEGRITY_SECRET
      );

      return json({
        ok: true,
        checkoutUrl: buildCheckoutUrl(conflictedPayment.wompi_reference, amountInCents, currency, conflictedSignature),
        reference: conflictedPayment.wompi_reference,
        existing: true
      });
    }

    // 6) Firmar la sesión del Web Checkout de Wompi. A diferencia de
    //    Mercado Pago/PayPal, Wompi no expone un endpoint de "crear sesión":
    //    el Web Checkout se arma como una URL con querystring firmada — Wompi
    //    valida esa firma al cargar la página, no hace falta llamar a su API
    //    acá.
    const checkoutUrl = buildCheckoutUrl(paymentReference, amountInCents, currency, paymentSignature);

    return json({ ok: true, checkoutUrl, reference: paymentReference });
  } catch (error) {
    return json({ error: "WOMPI_CHECKOUT_FAILED", detail: String(error) }, 500);
  }
});