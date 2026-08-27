// ============================================================================
// wompi-refund-transaction (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Único punto autorizado para REEMBOLSAR (total o
// parcialmente) una transacción de Wompi ya aprobada (POST
// /v1/transactions/:id/refund). Exige la llave PRIVADA del comercio
// (Authorization: Bearer <private_key>), así que jamás puede ejecutarse en
// el navegador — WompiProvider.refundPayment() delega acá justo por eso.
//
// CONTRATO:
//   El cliente llama a esta función con una sesión activa
//   (WompiProvider.ts -> refundPayment()). supabase-js adjunta el
//   Authorization: Bearer <token> automáticamente.
//
//   Body: { transactionId, amount?, reason? }
//   Respuesta: { ok: true, transaction }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - La transacción a reembolsar tiene que pertenecer a un
//     `wompi_reference` que exista en `subscription_payments` del
//     `business_id` al que pertenece el usuario que llama, y ese usuario
//     debe ser ADMIN — igual que wompi-void-transaction. Así se evita que
//     cualquier cuenta autenticada pueda reembolsar la transacción de OTRO
//     negocio con solo adivinar/probar un transactionId de Wompi.
//   - Solo se permite reembolsar un pago que ya esté 'approved' en nuestro
//     propio histórico — nunca uno 'pending' o 'declined': si Wompi nunca
//     confirmó el cobro, no hay nada real que reembolsar.
//   - `amount` es opcional y se interpreta en la MISMA unidad que
//     `subscription_payments.amount` (pesos, no centavos) — se convierte a
//     centavos acá antes de mandarlo a Wompi, igual que en
//     wompi-create-checkout. Si no se envía, se reembolsa el monto total
//     original de esa fila (nunca lo que el cliente diga que se cobró).
//   - WOMPI_PRIVATE_KEY solo vive como secret de esta función — nunca en
//     el navegador ni en ninguna tabla.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_PRIVATE_KEY=prv_prod_...
//   (la misma que ya configuraste para wompi-void-transaction)
//
// Despliegue:
//   supabase functions deploy wompi-refund-transaction
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
  transactionId?: string;
  amount?: number;
  reason?: string;
}

interface WompiTransactionApiData {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  created_at: string;
  reference: string;
}

interface WompiRefundApiResponse {
  data: WompiTransactionApiData;
  error?: { type?: string; reason?: string };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_PRIVATE_KEY = Deno.env.get("WOMPI_PRIVATE_KEY");

/** Wompi resuelve sandbox/producción por el prefijo de la llave privada, igual que en wompi-void-transaction. */
function resolveWompiApiBase(privateKey: string): string {
  const isSandbox = privateKey.startsWith("prv_test_");
  return isSandbox ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  if (!WOMPI_PRIVATE_KEY) {
    return json({ error: "WOMPI_CONFIG_MISSING: falta WOMPI_PRIVATE_KEY" }, 500);
  }

  // 1) Extraer y validar el JWT del usuario que llama. Igual que en
  //    wompi-void-transaction: NUNCA confiamos en nada del body sin antes
  //    comprobar quién es el usuario y a qué negocio pertenece.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
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

  const transactionId = payload.transactionId?.trim();
  if (!transactionId) {
    return json({ error: "Falta el campo: transactionId es obligatorio." }, 400);
  }

  if (payload.amount !== undefined && (typeof payload.amount !== "number" || payload.amount <= 0)) {
    return json({ error: "AMOUNT_INVALID: si se envía, amount debe ser un número mayor a 0." }, 400);
  }

  try {
    // 2) La transacción tiene que corresponder a un cobro que ESTA
    //    integración generó (existe en subscription_payments por
    //    wompi_reference o por id) — nunca se le pasa un transactionId
    //    crudo a Wompi sin antes saber a qué negocio pertenece.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, status, amount, currency")
      .or(`wompi_reference.eq.${transactionId},id.eq.${transactionId}`)
      .maybeSingle();

    if (paymentLookupError) {
      return json({ error: "PAYMENT_LOOKUP_FAILED", detail: paymentLookupError.message }, 500);
    }

    if (!paymentRow) {
      return json({ error: "TRANSACTION_NOT_FOUND: esta transacción no pertenece a VIMDY." }, 404);
    }

    // 3) El usuario debe pertenecer a ese negocio Y ser ADMIN.
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

    // 4) Solo se reembolsa un pago que de verdad se cobró. Si nunca quedó
    //    'approved' en nuestro histórico, no hay nada real que devolver.
    if (paymentRow.status !== "approved") {
      return json(
        { error: "PAYMENT_NOT_REFUNDABLE: solo se puede reembolsar un pago que esté 'approved'." },
        409
      );
    }

    // 5) El monto a reembolsar viene en pesos (misma unidad que
    //    subscription_payments.amount) — nunca en centavos desde el
    //    cliente. Si no se especifica, se reembolsa el monto total
    //    original de la fila, no lo que el cliente diga.
    const refundAmountInCents = Math.round((payload.amount ?? paymentRow.amount) * 100);
    const originalAmountInCents = Math.round(paymentRow.amount * 100);

    if (refundAmountInCents > originalAmountInCents) {
      return json({ error: "AMOUNT_EXCEEDS_ORIGINAL: el reembolso no puede superar lo pagado." }, 400);
    }

    // 6) Reembolsar en Wompi con la llave PRIVADA — esto es lo único que
    //    este endpoint le agrega a la operación (el navegador no puede
    //    hacerlo).
    const apiBase = resolveWompiApiBase(WOMPI_PRIVATE_KEY);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const wompiResponse = await fetch(`${apiBase}/transactions/${transactionId}/refund`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ amount_in_cents: refundAmountInCents }),
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const wompiBody = (await wompiResponse.json()) as WompiRefundApiResponse;

    if (!wompiResponse.ok || !wompiBody.data) {
      return json(
        {
          error: "WOMPI_REFUND_REJECTED",
          detail: wompiBody.error?.reason ?? `Wompi respondió HTTP ${wompiResponse.status}.`
        },
        409
      );
    }

    const transaction = wompiBody.data;

    // 7) Reflejar el resultado real en nuestro propio histórico usando la
    //    función SQL server-side. Esto registra auditoría, marca el pago como
    //    reembolsado y, si es total, actualiza el estado del negocio.
    const refundAmount = refundAmountInCents / 100;
    const { data: refundResult, error: refundError } = await admin.rpc(
      "refund_subscription_payment_server_side",
      {
        p_payment_id: paymentRow.id,
        p_refund_amount: refundAmount,
        p_provider_refund_id: transaction.id,
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

    return json({ ok: true, transaction, isTotalRefund: result.is_total_refund });
  } catch (error) {
    return json({ error: "WOMPI_REFUND_TRANSACTION_FAILED", detail: String(error) }, 500);
  }
});