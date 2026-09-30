// ============================================================================
// wompi-webhook (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Este es el ÚNICO lugar del sistema donde un plan
// pagado se activa de verdad. wompi-create-checkout solo abre la sesión de
// pago; el redirect-url solo es cosmético para el usuario. La confirmación
// real y autoritativa siempre llega por este webhook, servidor a servidor,
// firmado por Wompi — nunca por lo que el navegador diga que pasó.
//
// SEGURIDAD:
//   - Wompi llama a este endpoint SIN el JWT de ningún usuario de VIMDY (no
//     tiene forma de tenerlo). Por eso este endpoint se despliega con
//     verificación de JWT desactivada, y en cambio confía ÚNICAMENTE en el
//     checksum firmado con WOMPI_EVENTS_SECRET (ver validateChecksum abajo).
//     Sin un checksum válido, el evento se rechaza sin tocar nada.
//   - El monto y la moneda del evento se comparan contra lo que
//     wompi-create-checkout guardó en `subscription_payments` al crear la
//     sesión — si no coinciden, se rechaza (evita que alguien reporte un
//     pago aprobado por un monto distinto al que realmente se cobró).
//   - Idempotente: si esa fila ya estaba en 'approved' o 'declined', el
//     evento se reconoce con 200 pero no se vuelve a procesar. Wompi
//     reintenta webhooks; sin esto se podría duplicar la extensión del
//     plan cada vez que reintenta.
//   - Activación server-side: usa la función SQL `activate_subscription_server_side`
//     para calcular fechas (12+2 meses para anual) y registrar auditoría.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";
import { sentryCaptureException } from "../_shared/sentry.ts";

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

// Wompi manda el método real de pago como "CARD" | "PSE" | "NEQUI" | "BANCOLOMBIA_TRANSFER" | ...
// Se mapea a los valores que ya usa el resto de VIMDY (businesses.payment_method).
const PAYMENT_METHOD_MAP: Record<string, string> = {
  CARD: "wompi_card",
  PSE: "wompi_pse",
  NEQUI: "wompi_nequi"
};

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

/** Lee una propiedad anidada tipo "transaction.status" a partir de payload.data. */
function readProperty(root: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object" && key in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, root);
}

/**
 * Checksum de eventos de Wompi: SHA256 de la concatenación, EN ORDEN, de
 * los valores de `signature.properties` (leídos desde `payload.data`),
 * seguidos del `timestamp` del evento y del secret de eventos.
 * https://docs.wompi.co -> "Eventos" -> "Verificación de eventos".
 */
async function validateChecksum(payload: WompiWebhookPayload, secret: string): Promise<boolean> {
  const properties = payload.signature?.properties;
  const checksum = payload.signature?.checksum;
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

  // 1) Sin checksum válido, el evento se descarta sin tocar absolutamente
  //    nada — este es el único guardián de este endpoint (no hay JWT).
  const isValid = await validateChecksum(payload, WOMPI_EVENTS_SECRET);
  if (!isValid) {
    return json({ error: "INVALID_SIGNATURE" }, 401);
  }

  const transaction = payload.data?.transaction;
  if (!transaction?.reference || !transaction.status) {
    // Evento firmado correctamente pero sin una transacción reconocible
    // (p. ej. un evento de otro tipo que no maneje esta integración).
    // Se responde 200 para que Wompi no reintente algo que nunca vamos a procesar.
    return json({ ok: true, ignored: true });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  try {
    // 2) Buscar el intento de cobro que wompi-create-checkout ya había
    //    dejado en 'pending' — nunca confiamos en un businessId/plan que
    //    pudiera venir del propio payload del webhook.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, plan, amount, currency, status")
      .eq("wompi_reference", transaction.reference)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }

    if (!paymentRow) {
      // Referencia que esta integración nunca generó — se ignora (200 para
      // no generar reintentos infinitos) en vez de tocar nada a ciegas.
      return json({ ok: true, ignored: true, reason: "UNKNOWN_REFERENCE" });
    }

    // 3) Idempotencia: si ya se procesó (approved/declined), no se repite
    //    el trabajo aunque Wompi reintente el mismo evento.
    if (paymentRow.status === "approved" || paymentRow.status === "declined") {
      return json({ ok: true, alreadyProcessed: true });
    }

    // 4) El monto/moneda que Wompi dice haber cobrado tiene que coincidir
    //    con lo que wompi-create-checkout pidió cobrar. Si no coincide, se
    //    rechaza en vez de activar un plan que no corresponde a lo pagado.
    const expectedAmountInCents = Math.round(paymentRow.amount * 100);
    if (
      transaction.amount_in_cents !== expectedAmountInCents ||
      transaction.currency !== paymentRow.currency
    ) {
      return json({ error: "AMOUNT_MISMATCH" }, 409);
    }

    const status = transaction.status.toUpperCase();
    const paymentMethod = PAYMENT_METHOD_MAP[transaction.payment_method_type ?? ""] ?? null;

    if (status === "APPROVED") {
      const plan = paymentRow.plan as "monthly" | "yearly";

      // 5) Activar/renovar el plan usando la función SQL server-side.
      //    Esta función calcula las fechas correctamente (14 meses para anual),
      //    marca trial como usado, y registra auditoría.
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

      // 6) Actualizar el método de pago en el pago (lo demás lo hace la función SQL)
      const { error: paymentUpdateError } = await admin
        .from("subscription_payments")
        .update({ payment_method: paymentMethod })
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

    // 7) Cualquier estado que no sea APPROVED (DECLINED, VOIDED, ERROR) se
    //    registra como declinado. El plan/fechas actuales del negocio NO
    //    se tocan — solo se refleja el intento fallido para que la UI
    //    pueda avisarle al usuario y ofrecerle reintentar.
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
  } catch (error) {
    sentryCaptureException(error, { context: "wompi-webhook", reference: transaction?.reference });
    return json({ error: "WOMPI_WEBHOOK_FAILED", detail: String(error) }, 500);
  }
});