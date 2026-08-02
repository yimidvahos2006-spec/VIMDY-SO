// ============================================================================
// paypal-webhook (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Mismo patrón que wompi-webhook / mercadopago-webhook. paypal-checkout crea
// la orden con intent CAPTURE pero PayPal NO cobra automáticamente cuando
// el comprador aprueba — hay que capturarla. Este endpoint escucha
// CHECKOUT.ORDER.APPROVED, captura la orden server-to-server, y activa el
// plan solo si la captura queda COMPLETED.
//
// SEGURIDAD:
//   - Se verifica la firma del webhook contra la API oficial de PayPal
//     (POST /v1/notifications/verify-webhook-signature) usando
//     PAYPAL_WEBHOOK_ID — nunca se confía en el body sin verificar primero.
//   - El monto/moneda de la orden se comparan contra lo que paypal-checkout
//     ya había guardado — si no coinciden, se rechaza.
//   - Idempotente: una fila ya 'approved'/'declined' no se reprocesa.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set PAYPAL_CLIENT_ID=...            (ya usado por paypal-checkout)
//   supabase secrets set PAYPAL_CLIENT_SECRET=...
//   supabase secrets set PAYPAL_ENV=sandbox               (o "live")
//   supabase secrets set PAYPAL_WEBHOOK_ID=...             (Developer Dashboard > Webhooks)
//
// Despliegue (SIN verificación de JWT — PayPal no manda uno):
//   supabase functions deploy paypal-webhook --no-verify-jwt
//
// Y en el Developer Dashboard de PayPal, la URL a registrar en el Webhook es:
//   https://<tu-proyecto>.supabase.co/functions/v1/paypal-webhook
// Eventos a suscribir: CHECKOUT.ORDER.APPROVED, PAYMENT.CAPTURE.DENIED
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

const PLAN_PERIOD_DAYS: Record<"monthly" | "yearly", number> = {
  monthly: 30,
  yearly: 365
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = Deno.env.get("PAYPAL_ENV") ?? "sandbox";
const PAYPAL_WEBHOOK_ID = Deno.env.get("PAYPAL_WEBHOOK_ID");

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

/**
 * Verificación oficial de firma de webhooks de PayPal: se le manda a PayPal
 * los headers de transmisión + el body + el PAYPAL_WEBHOOK_ID, y PayPal
 * mismo confirma si la firma es válida. Es más lento que validar el HMAC a
 * mano, pero es el método que PayPal documenta como confiable porque las
 * llaves de firma rotan sin aviso — nunca se hardcodea un certificado.
 */
async function verifyWebhookSignature(req: Request, rawBody: string, accessToken: string): Promise<boolean> {
  if (!PAYPAL_WEBHOOK_ID) return false;

  const verificationBody = {
    transmission_id: req.headers.get("paypal-transmission-id"),
    transmission_time: req.headers.get("paypal-transmission-time"),
    cert_url: req.headers.get("paypal-cert-url"),
    auth_algo: req.headers.get("paypal-auth-algo"),
    transmission_sig: req.headers.get("paypal-transmission-sig"),
    webhook_id: PAYPAL_WEBHOOK_ID,
    webhook_event: JSON.parse(rawBody)
  };

  if (
    !verificationBody.transmission_id ||
    !verificationBody.transmission_time ||
    !verificationBody.cert_url ||
    !verificationBody.auth_algo ||
    !verificationBody.transmission_sig
  ) {
    return false;
  }

  const response = await fetch(`${resolvePayPalApiBase()}/v1/notifications/verify-webhook-signature`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(verificationBody)
  });

  if (!response.ok) return false;
  const result = (await response.json()) as { verification_status?: string };
  return result.verification_status === "SUCCESS";
}

interface PayPalWebhookEvent {
  event_type?: string;
  resource?: {
    id?: string;
    custom_id?: string;
    purchase_units?: { custom_id?: string; amount?: { currency_code?: string; value?: string } }[];
  };
}

interface PayPalCaptureResponse {
  status: string;
  purchase_units?: { payments?: { captures?: { amount?: { currency_code?: string; value?: string } }[] } }[];
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
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET || !PAYPAL_WEBHOOK_ID) {
    return json({ error: "PAYPAL_CONFIG_MISSING: falta PAYPAL_CLIENT_ID, PAYPAL_CLIENT_SECRET o PAYPAL_WEBHOOK_ID" }, 500);
  }

  const rawBody = await req.text();
  let event: PayPalWebhookEvent;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    const accessToken = await getPayPalAccessToken();

    // 1) Sin firma válida, se descarta sin tocar nada.
    const isValid = await verifyWebhookSignature(req, rawBody, accessToken);
    if (!isValid) {
      return json({ error: "INVALID_SIGNATURE" }, 401);
    }

    const orderId = event.resource?.id;
    if (!orderId) {
      return json({ ok: true, ignored: true, reason: "NO_ORDER_ID" });
    }

    // 2) Buscar el intento que paypal-checkout ya había dejado en 'pending'.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, plan, amount, currency, status")
      .eq("paypal_order_id", orderId)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }
    if (!paymentRow) {
      return json({ ok: true, ignored: true, reason: "UNKNOWN_REFERENCE" });
    }

    // 3) Idempotencia. 'error' también cuenta como ya procesado: el dinero
    //    ya se capturó una vez y quedó marcado para revisión manual, así que
    //    un reintento del mismo webhook no debe intentar capturar de nuevo
    //    una orden que PayPal ya no dejaría capturar dos veces igual.
    if (paymentRow.status === "approved" || paymentRow.status === "declined" || paymentRow.status === "error") {
      return json({ ok: true, alreadyProcessed: true });
    }

    if (event.event_type === "PAYMENT.CAPTURE.DENIED") {
      await admin.from("subscription_payments").update({ status: "declined" }).eq("id", paymentRow.id);
      await admin.from("businesses").update({ payment_status: "declined" }).eq("id", paymentRow.business_id);
      return json({ ok: true, activated: false });
    }

    if (event.event_type !== "CHECKOUT.ORDER.APPROVED") {
      // Evento firmado correctamente pero no es el que dispara la captura
      // en este flujo — se ignora con 200 para que PayPal no reintente.
      return json({ ok: true, ignored: true, reason: "UNHANDLED_EVENT_TYPE" });
    }

    // 4) El comprador aprobó — hay que capturar el cobro server-to-server.
    //    PayPal jamás cobra solo porque el navegador dice "aprobado": esta
    //    llamada es la que de verdad mueve el dinero.
    const captureResponse = await fetch(`${resolvePayPalApiBase()}/v2/checkout/orders/${orderId}/capture`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json"
      }
    });

    if (!captureResponse.ok) {
      const detail = await captureResponse.text();
      await admin.from("subscription_payments").update({ status: "declined" }).eq("id", paymentRow.id);
      await admin.from("businesses").update({ payment_status: "declined" }).eq("id", paymentRow.business_id);
      return json({ error: "PAYPAL_CAPTURE_FAILED", detail }, 502);
    }

    const capture = (await captureResponse.json()) as PayPalCaptureResponse;
    if (capture.status !== "COMPLETED") {
      await admin.from("subscription_payments").update({ status: "declined" }).eq("id", paymentRow.id);
      await admin.from("businesses").update({ payment_status: "declined" }).eq("id", paymentRow.business_id);
      return json({ ok: true, activated: false });
    }

    // 5) El monto/moneda capturados deben coincidir con lo que
    //    paypal-checkout pidió cobrar.
    const capturedAmount = capture.purchase_units?.[0]?.payments?.captures?.[0]?.amount;
    const expectedAmount = Number(paymentRow.amount);
    if (
      !capturedAmount ||
      Math.abs(Number(capturedAmount.value) - expectedAmount) > 0.01 ||
      capturedAmount.currency_code !== paymentRow.currency
    ) {
      // El dinero SÍ se capturó en PayPal (capture.status === "COMPLETED"),
      // pero el monto no coincide con lo esperado. No se activa el plan
      // (evita activar de más o de menos), pero tampoco se deja la fila en
      // 'pending' para siempre: se marca 'error' para que quede visible que
      // hay un cobro real pendiente de revisar a mano, en vez de perderse.
      console.error("PAYPAL_AMOUNT_MISMATCH_AFTER_CAPTURE", JSON.stringify({
        paymentRowId: paymentRow.id,
        businessId: paymentRow.business_id,
        orderId,
        expectedAmount,
        expectedCurrency: paymentRow.currency,
        capturedAmount
      }));
      await admin
        .from("subscription_payments")
        .update({ status: "error" })
        .eq("id", paymentRow.id);
      return json({ error: "AMOUNT_MISMATCH", note: "Dinero capturado en PayPal, requiere revisión manual" }, 409);
    }

    const plan = paymentRow.plan as "monthly" | "yearly";
    const now = new Date();
    const renewalDate = new Date(now);
    renewalDate.setDate(renewalDate.getDate() + PLAN_PERIOD_DAYS[plan]);

    const { error: businessUpdateError } = await admin
      .from("businesses")
      .update({
        plan,
        renewal_date: renewalDate.toISOString(),
        next_charge_at: renewalDate.toISOString(),
        payment_method: "paypal",
        payment_status: "approved"
      })
      .eq("id", paymentRow.business_id);

    if (businessUpdateError) {
      return json({ error: "BUSINESS_UPDATE_FAILED", detail: businessUpdateError.message }, 500);
    }

    const { error: paymentUpdateError } = await admin
      .from("subscription_payments")
      .update({ status: "approved", payment_method: "paypal", paid_at: now.toISOString() })
      .eq("id", paymentRow.id);

    if (paymentUpdateError) {
      return json({ error: "PAYMENT_UPDATE_FAILED", detail: paymentUpdateError.message }, 500);
    }

    return json({ ok: true, activated: true });
  } catch (error) {
    return json({ error: "PAYPAL_WEBHOOK_FAILED", detail: String(error) }, 500);
  }
});