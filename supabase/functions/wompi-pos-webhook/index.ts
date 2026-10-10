// ============================================================================
// wompi-pos-webhook (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — POS Colombia. Este es el ÚNICO lugar del sistema donde un pago
// POS externo (tarjeta/transferencia/QR vía Web Checkout de Wompi) se confirma
// de verdad. NUNCA se confía en lo que el navegador diga: la confirmación real
// llega por este webhook servidor-a-servidor, firmado por Wompi.
//
// SEGURIDAD:
//   - Wompi llama SIN el JWT de ningún usuario de VIMDY. Este endpoint se
//     despliega con verificación de JWT desactivada y confía ÚNICAMENTE en
//     WOMPI_EVENTS_SECRET (checksum de firma de eventos).
//   - El webhook:
//     1. Valida el checksum de Wompi (X-Event-Checksum header o signature.checksum)
//     2. Busca la payment_session por provider_reference (Wompi reference)
//     3. Delega en finalize_wompi_sale_payment_atomic (service_role ONLY RPC)
//        que valida TODO server-side: sale, tenant, amount, currency, method,
//        idempotency, state downgrade, y llama register_sale_payment_atomic.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_EVENTS_SECRET=events_secret_...
//
// Despliegue: supabase functions deploy wompi-pos-webhook
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { sentryCaptureException } from "../_shared/sentry.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

interface WompiTransaction {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  reference: string;
  payment_method_type?: string;
}

interface WompiWebhookPayload {
  event?: string;
  data?: { transaction?: WompiTransaction };
  sent_at?: string;
  timestamp?: number;
  signature?: { properties?: string[]; checksum?: string };
  environment?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_EVENTS_SECRET = Deno.env.get("WOMPI_EVENTS_SECRET");

async function sha256Hex(input: string): Promise<string> {
  const data = new TextEncoder().encode(input);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function readProperty(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, root);
}

async function validateChecksum(
  payload: WompiWebhookPayload,
  headerChecksum: string | null,
  secret: string
): Promise<boolean> {
  const properties = payload.signature?.properties;
  // Accept checksum from header OR from body signature
  const checksum = headerChecksum ?? payload.signature?.checksum;
  const timestamp = payload.timestamp;

  if (!properties?.length || !checksum || typeof timestamp !== "number") {
    return false;
  }

  const concatenatedValues = properties
    .map((path) => String(readProperty(payload.data, path) ?? ""))
    .join("");

  const expected = await sha256Hex(`${concatenatedValues}${timestamp}${secret}`);
  return expected.toUpperCase() === checksum.toUpperCase();
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

  if (!WOMPI_EVENTS_SECRET) {
    return json({ error: "WOMPI_EVENTS_CONFIG_MISSING: falta WOMPI_EVENTS_SECRET" }, 500);
  }

  let payload: WompiWebhookPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  // 1) Validar checksum de Wompi
  //    Acepta X-Event-Checksum header O signature.checksum del body
  const headerChecksum = req.headers.get("X-Event-Checksum");
  const isValid = await validateChecksum(payload, headerChecksum, WOMPI_EVENTS_SECRET);
  if (!isValid) {
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }

  const transaction = payload.data?.transaction;
  if (!transaction?.reference || !transaction.status) {
    return json({ ok: true, ignored: true });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const status = transaction.status.toUpperCase();

  try {
    // 2) Localizar la payment_session por provider_reference (Wompi reference)
    const { data: session, error: sessionError } = await admin
      .from("payment_sessions")
      .select("id, business_id, branch_id, sale_id, payment_method, amount, cash_amount, currency, status, idempotency_key, provider_reference, metadata")
      .eq("provider_reference", transaction.reference)
      .eq("provider", "wompi")
      .maybeSingle();

    if (sessionError) {
      return json({ error: "SESSION_LOOKUP_FAILED", detail: sessionError.message }, 500);
    }

    if (!session) {
      // Referencia que esta integración nunca generó — ignorar (200 para no reintentos)
      return json({ ok: true, ignored: true, reason: "UNKNOWN_REFERENCE" });
    }

    // 3) Estado terminal — no degradar
    if (session.status === "approved") {
      return json({ ok: true, alreadyProcessed: true, status: "approved" });
    }
    if (["declined", "cancelled", "error", "expired", "refunded", "partially_refunded"].includes(session.status)) {
      return json({ ok: true, alreadyProcessed: true, status: session.status });
    }

    // 4) Validar que NO sea DECLINED/ERROR/VOIDED → rechazar (no confirmar)
    if (["DECLINED", "ERROR", "VOIDED"].includes(status)) {
      // 5) Insertar payment_verifications como REJECTED + actualizar session
      const saleId = session.sale_id;
      if (!saleId) {
        return json({ error: "SESSION_HAS_NO_SALE_ID" }, 500);
      }

      const paymentId = `sale-payment-${saleId}`;

      await admin.from("payment_verifications").insert({
        business_id: session.business_id,
        branch_id: session.branch_id,
        sale_id: saleId,
        payment_id: paymentId,
        method: session.payment_method ?? "CARD",
        amount: Number(session.amount),
        provider: "wompi",
        provider_reference: transaction.reference,
        status: "REJECTED",
        metadata: {
          wompiTransactionId: transaction.id,
          wompiStatus: transaction.status,
          webhookEvent: payload.event,
        },
      }, { ignore: true });

      const targetStatus = status === "VOIDED" ? "cancelled" : "declined";
      await admin
        .from("payment_sessions")
        .update({ status: targetStatus, updated_at: new Date().toISOString() })
        .eq("id", session.id);

      return json({ ok: true, status: targetStatus, saleId });
    }

    // 5) Solo APPROVED pasa a finalize
    if (status !== "APPROVED") {
      // Estado desconocido — mantener pendiente
      return json({ ok: true, ignored: true, reason: `UNKNOWN_STATUS_${status}` });
    }

    // 6) Delegar en finalize_wompi_sale_payment_atomic (service_role ONLY)
    //    Esta RPC valida TODO server-side: tenant, sale, amount, currency,
    //    idempotency, estado, payment_verifications, y llama register_sale_payment_atomic.
    const { data: finalizeData, error: finalizeError } = await admin.rpc(
      "finalize_wompi_sale_payment_atomic",
      {
        p_session_id: session.id,
        p_wompi_transaction_id: transaction.id,
        p_wompi_reference: transaction.reference,
        p_amount_in_cents: transaction.amount_in_cents,
        p_currency: transaction.currency,
        p_payment_method: session.payment_method ?? "CARD",
      }
    );

    if (finalizeError) {
      sentryCaptureException(finalizeError, {
        context: "wompi-pos-webhook",
        reference: transaction.reference,
        sessionId: session.id,
      });

      return json(
        { error: "FINALIZE_FAILED", detail: finalizeError.message },
        500
      );
    }

    const finalizeResult = (finalizeData as any)?.[0];
    if (!finalizeResult?.success) {
      return json(
        { error: "FINALIZE_FAILED", detail: finalizeResult?.message ?? "Error desconocido" },
        500
      );
    }

    return json({
      ok: true,
      status: "approved",
      idempotent: finalizeResult.idempotent ?? false,
      saleId: finalizeResult.saleId,
    });
  } catch (error) {
    sentryCaptureException(error, {
      context: "wompi-pos-webhook",
      reference: transaction?.reference,
    });
    return json(
      { error: "WOMPI_POS_WEBHOOK_FAILED", detail: String(error) },
      500
    );
  }
});
