// ============================================================================
// mercadopago-webhook (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Mismo patrón que wompi-webhook: único lugar donde un plan pagado con
// Mercado Pago se activa de verdad. mercadopago-checkout solo abre la
// preferencia; la confirmación real llega acá, firmada por Mercado Pago.
//
// SEGURIDAD:
//   - Mercado Pago llama sin JWT de VIMDY -> se despliega con verificación
//     de JWT desactivada, y se confía solo en la firma x-signature (HMAC-SHA256
//     con MERCADOPAGO_WEBHOOK_SECRET). Sin firma válida, se rechaza sin
//     tocar nada.
//   - El monto/moneda que Mercado Pago reporta se comparan contra lo que
//     mercadopago-checkout ya había guardado en subscription_payments — si
//     no coinciden, se rechaza.
//   - Idempotente: una fila ya 'approved'/'declined' no se vuelve a procesar,
//     aunque Mercado Pago reintente la notificación.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set MERCADOPAGO_ACCESS_TOKEN=APP_USR-...   (ya usado por mercadopago-checkout)
//   supabase secrets set MERCADOPAGO_WEBHOOK_SECRET=...          (Tus integraciones > Webhooks > Firma secreta)
//
// Despliegue (SIN verificación de JWT — Mercado Pago no manda uno):
//   supabase functions deploy mercadopago-webhook --no-verify-jwt
//
// Y en el panel de Mercado Pago (Tus integraciones > Webhooks), la URL a
// registrar es:
//   https://<tu-proyecto>.supabase.co/functions/v1/mercadopago-webhook
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

// Mercado Pago manda el método real como "account_money" | "credit_card" |
// "debit_card" | "bank_transfer" | ... Se mapea a lo que ya usa VIMDY.
const PAYMENT_METHOD_MAP: Record<string, string> = {
  account_money: "mercadopago_wallet",
  credit_card: "mercadopago_card",
  debit_card: "mercadopago_card",
  bank_transfer: "mercadopago_bank_transfer",
  ticket: "mercadopago_bank_transfer"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const MERCADOPAGO_WEBHOOK_SECRET = Deno.env.get("MERCADOPAGO_WEBHOOK_SECRET");

async function hmacSha256Hex(secret: string, message: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Verificación de firma de Mercado Pago:
 * header `x-signature: ts=<ts>,v1=<hash>` + header `x-request-id` + el
 * `data.id` del query string forman el "manifest": `id:{id};request-id:{req};ts:{ts};`
 * HMAC-SHA256(manifest, secret) debe coincidir con v1.
 * https://www.mercadopago.com.mx/developers -> "Configurar notificaciones" -> "Firma secreta".
 */
async function validateSignature(req: Request, dataId: string, secret: string): Promise<boolean> {
  const signatureHeader = req.headers.get("x-signature");
  const requestId = req.headers.get("x-request-id");
  if (!signatureHeader || !requestId || !dataId) return false;

  const parts = Object.fromEntries(
    signatureHeader.split(",").map((part) => {
      const [key, value] = part.split("=");
      return [key?.trim(), value?.trim()];
    })
  );
  const ts = parts["ts"];
  const v1 = parts["v1"];
  if (!ts || !v1) return false;

  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${ts};`;
  const expected = await hmacSha256Hex(secret, manifest);
  return expected === v1;
}

interface MercadoPagoPayment {
  id: number;
  status: string;
  transaction_amount: number;
  currency_id: string;
  external_reference?: string;
  payment_type_id?: string;
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
  if (!MERCADOPAGO_ACCESS_TOKEN || !MERCADOPAGO_WEBHOOK_SECRET) {
    return json({ error: "MERCADOPAGO_CONFIG_MISSING: falta MERCADOPAGO_ACCESS_TOKEN o MERCADOPAGO_WEBHOOK_SECRET" }, 500);
  }

  const url = new URL(req.url);
  const dataId = url.searchParams.get("data.id") ?? url.searchParams.get("id") ?? "";

  // Mercado Pago también manda un body JSON, pero el `data.id` autoritativo
  // para la firma es el del query string — no el del body, que puede diferir
  // según el tipo de notificación.
  try {
    await req.text();
  } catch {
    // El body no siempre es necesario; no rechazamos solo por esto.
  }

  // 1) Sin firma válida, se descarta sin tocar nada.
  const isValid = await validateSignature(req, dataId, MERCADOPAGO_WEBHOOK_SECRET);
  if (!isValid) {
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }

  if (!dataId) {
    return json({ ok: true, ignored: true, reason: "NO_DATA_ID" });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 2) Con la firma ya validada, se consulta el pago REAL en Mercado
    //    Pago (nunca se confía en lo que traiga el body de la notificación).
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const paymentResponse = await fetch(`https://api.mercadopago.com/v1/payments/${dataId}`, {
      headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    if (!paymentResponse.ok) {
      // Puede ser una notificación de un tipo de recurso que no es "payment"
      // (ej. merchant_order). Se responde 200 para que no reintente algo
      // que esta integración nunca va a procesar.
      return json({ ok: true, ignored: true, reason: "NOT_A_PAYMENT_RESOURCE" });
    }

    const payment = (await paymentResponse.json()) as MercadoPagoPayment;
    const reference = payment.external_reference;

    if (!reference) {
      return json({ ok: true, ignored: true, reason: "NO_EXTERNAL_REFERENCE" });
    }

    // 3) Buscar el intento que mercadopago-checkout ya había dejado en
    //    'pending' — nunca se confía en un businessId que venga del payload.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, plan, amount, currency, status")
      .eq("mercadopago_reference", reference)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }
    if (!paymentRow) {
      return json({ ok: true, ignored: true, reason: "UNKNOWN_REFERENCE" });
    }

    // 4) Idempotencia.
    if (paymentRow.status === "approved" || paymentRow.status === "declined") {
      return json({ ok: true, alreadyProcessed: true });
    }

    // 5) El monto/moneda reportados deben coincidir con lo que
    //    mercadopago-checkout pidió cobrar.
    const expectedAmount = Number(paymentRow.amount);
    if (
      Math.abs(payment.transaction_amount - expectedAmount) > 0.01 ||
      payment.currency_id !== paymentRow.currency
    ) {
      return json({ error: "AMOUNT_MISMATCH" }, 409);
    }

    const paymentMethod = PAYMENT_METHOD_MAP[payment.payment_type_id ?? ""] ?? "mercadopago_wallet";
    const now = new Date();

    if (payment.status === "approved") {
      const plan = paymentRow.plan as "monthly" | "yearly";

      // 6) Activar/renovar el plan usando la función SQL server-side.
      const { data: activationResult, error: activationError } = await admin.rpc(
        "activate_subscription_server_side",
        {
          p_business_id: paymentRow.business_id,
          p_plan: plan,
          p_payment_id: paymentRow.id,
          p_now: new Date().toISOString()
        }
      );

      if (activationError) {
        return json({ error: "ACTIVATION_FAILED", detail: activationError.message }, 500);
      }

      const result = activationResult as {
        ok: boolean;
        alreadyActivated: boolean;
        renewalNumber: number;
        renewal_date?: string;
      };

      const { error: paymentUpdateError } = await admin
        .from("subscription_payments")
        .update({ payment_method: paymentMethod, paid_at: new Date().toISOString() })
        .eq("id", paymentRow.id);

      if (paymentUpdateError) {
        return json({ error: "PAYMENT_UPDATE_FAILED", detail: paymentUpdateError.message }, 500);
      }

      return json({
        ok: true,
        activated: !result.alreadyActivated,
        renewalNumber: result.renewalNumber,
        renewalDate: result.renewal_date
      });
    }

    if (payment.status === "rejected" || payment.status === "cancelled") {
      const { error: declineUpdateError } = await admin
        .from("subscription_payments")
        .update({ status: "declined", payment_method: paymentMethod })
        .eq("id", paymentRow.id);

      if (declineUpdateError) {
        return json({ error: "PAYMENT_UPDATE_FAILED", detail: declineUpdateError.message }, 500);
      }

      await admin.rpc(
        "expire_subscription_server_side",
        { p_business_id: paymentRow.business_id, p_now: new Date().toISOString() }
      );
      return json({ ok: true, activated: false });
    }

    // Estados intermedios (pending, in_process, in_mediation): no se toca
    // nada todavía, se espera la próxima notificación.
    return json({ ok: true, waiting: payment.status });
  } catch (error) {
    return json({ error: "MERCADOPAGO_WEBHOOK_FAILED", detail: String(error) }, 500);
  }
});