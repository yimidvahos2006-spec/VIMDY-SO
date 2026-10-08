// ============================================================================
// wompi-refund-transaction (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Único punto autorizado para reembolsar (total o
// parcialmente) una transacción de Wompi ya aprobada.
//
// CONTRATO DEL FRONTEND:
//   Body: { transactionId, amount?, reason? }
//   Respuesta: { ok: true, transaction, refund, isTotalRefund }
//
// SEGURIDAD:
//   - El usuario se identifica por su JWT, nunca por el body.
//   - El pago debe pertenecer a subscription_payments y a un negocio donde
//     el usuario sea ADMIN.
//   - La llave privada de Wompi vive solo en WOMPI_PRIVATE_KEY.
//   - Si se recibe el UUID interno de subscription_payments, se resuelve su
//     wompi_reference antes de llamar a Wompi.
//
// NOTA IMPORTANTE:
//   POST /v1/refunds devuelve el objeto del reembolso, no la transacción
//   completa. Para cumplir el contrato que consume WompiProvider.refundPayment,
//   después de un refund APPROVED consultamos GET /v1/transactions/{id} y
//   declaramos explícitamente `const transaction = ...`.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200): Response {
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

interface WompiTransaction {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  created_at: string;
  reference: string;
  [key: string]: unknown;
}

interface WompiTransactionResponse {
  data?: WompiTransaction;
  error?: {
    type?: string;
    reason?: string;
    messages?: Record<string, string[]>;
  };
}

interface WompiRefund {
  id: string | number;
  status: string;
  status_message?: string;
  amount_in_cents?: number;
  transaction_id?: string;
  v2_refund_id?: string;
  reference?: string;
  created_at?: string;
  [key: string]: unknown;
}

interface WompiRefundResponse {
  data?: WompiRefund;
  error?: {
    type?: string;
    reason?: string;
    messages?: Record<string, string[]>;
  };
}

interface RefundRpcResult {
  ok: boolean;
  is_total_refund: boolean;
  new_payment_status: string;
  audit_id?: string;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_PRIVATE_KEY = Deno.env.get("WOMPI_PRIVATE_KEY");

function resolveWompiApiBase(privateKey: string): string {
  return privateKey.startsWith("prv_test_")
    ? "https://sandbox.wompi.co/v1"
    : "https://production.wompi.co/v1";
}

async function readJson<T>(response: Response): Promise<T | null> {
  const text = await response.text();
  if (!text.trim()) return null;

  try {
    return JSON.parse(text) as T;
  } catch {
    return null;
  }
}

async function fetchWompi(
  url: string,
  init: RequestInit,
  timeoutMs = 15_000
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    return json(
      { error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" },
      500
    );
  }

  if (!WOMPI_PRIVATE_KEY) {
    return json({ error: "WOMPI_CONFIG_MISSING: falta WOMPI_PRIVATE_KEY" }, 500);
  }

  const authHeader =
    req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json(
      { error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." },
      401
    );
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json(
      { error: "SESSION_INVALID: tu sesión no es válida o expiró." },
      401
    );
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

  if (
    payload.amount !== undefined &&
    (typeof payload.amount !== "number" ||
      !Number.isFinite(payload.amount) ||
      payload.amount <= 0)
  ) {
    return json(
      { error: "AMOUNT_INVALID: si se envía, amount debe ser un número mayor a 0." },
      400
    );
  }

  try {
    // 1) Resolver el pago VIMDY sin interpolar el input del usuario dentro de
    //    un filtro .or(...). Primero buscamos por wompi_reference y luego por
    //    el UUID interno de subscription_payments.
    let paymentRow: {
      id: string;
      business_id: string;
      status: string;
      amount: number | string;
      currency: string;
      wompi_reference: string | null;
      paid_at: string;
      created_at: string;
    } | null = null;

    const byWompiReference = await admin
      .from("subscription_payments")
      .select("id, business_id, status, amount, currency, wompi_reference, paid_at, created_at")
      .eq("wompi_reference", transactionId)
      .maybeSingle();

    if (byWompiReference.error) {
      return json(
        { error: "PAYMENT_LOOKUP_FAILED", detail: byWompiReference.error.message },
        500
      );
    }

    paymentRow = byWompiReference.data;

    if (!paymentRow) {
      const byPaymentId = await admin
        .from("subscription_payments")
        .select("id, business_id, status, amount, currency, wompi_reference, paid_at, created_at")
        .eq("id", transactionId)
        .maybeSingle();

      if (byPaymentId.error) {
        return json(
          { error: "PAYMENT_LOOKUP_FAILED", detail: byPaymentId.error.message },
          500
        );
      }

      paymentRow = byPaymentId.data;
    }

    if (!paymentRow) {
      return json(
        { error: "TRANSACTION_NOT_FOUND: esta transacción no pertenece a VIMDY." },
        404
      );
    }

    const wompiTransactionId = paymentRow.wompi_reference?.trim() || transactionId;

    if (!wompiTransactionId) {
      return json(
        { error: "WOMPI_REFERENCE_MISSING: el pago no tiene wompi_reference." },
        409
      );
    }

    // 2) El usuario debe pertenecer al negocio Y ser ADMIN.
    const { data: membership, error: membershipError } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", authUser.id)
      .eq("business_id", paymentRow.business_id)
      .maybeSingle();

    if (membershipError) {
      return json(
        { error: "MEMBERSHIP_CHECK_FAILED", detail: membershipError.message },
        500
      );
    }

    if (!membership) {
      return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
    }

    if (membership.role !== "ADMIN") {
      return json(
        { error: "FORBIDDEN: solo un administrador puede reembolsar un pago." },
        403
      );
    }

    // 3) Solo se reembolsa un pago aprobado localmente.
    if (paymentRow.status !== "approved") {
      return json(
        {
          error:
            "PAYMENT_NOT_REFUNDABLE: solo se puede reembolsar un pago que esté 'approved'."
        },
        409
      );
    }

    const paymentAmount = Number(paymentRow.amount);
    if (!Number.isFinite(paymentAmount) || paymentAmount <= 0) {
      return json(
        { error: "PAYMENT_AMOUNT_INVALID: el monto original del pago no es válido." },
        409
      );
    }

    // 4) subscription_payments.amount está en pesos COP; Wompi espera centavos.
    const refundAmountInCents = Math.round(
      (payload.amount ?? paymentAmount) * 100
    );
    const originalAmountInCents = Math.round(paymentAmount * 100);

    if (refundAmountInCents <= 0) {
      return json({ error: "AMOUNT_INVALID: el monto debe ser mayor a 0." }, 400);
    }

    if (refundAmountInCents > originalAmountInCents) {
      return json(
        { error: "AMOUNT_EXCEEDS_ORIGINAL: el reembolso no puede superar lo pagado." },
        400
      );
    }

    const apiBase = resolveWompiApiBase(WOMPI_PRIVATE_KEY);
    const refundReference = `VIMDY-REFUND-${paymentRow.id}`;

    // 5) Crear reembolso con Wompi Refunds V2.
    const wompiResponse = await fetchWompi(`${apiBase}/refunds`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        transaction_id: wompiTransactionId,
        amount_in_cents: refundAmountInCents,
        reason:
          payload.reason?.trim() ||
          `Reembolso suscripción ${paymentRow.id.slice(0, 8)}`,
        reference: refundReference
      })
    });

    const wompiBody =
      (await readJson<WompiRefundResponse>(wompiResponse)) ?? {};

    if (!wompiResponse.ok || !wompiBody.data) {
      return json(
        {
          error: "WOMPI_REFUND_REJECTED",
          detail:
            wompiBody.error?.reason ??
            `Wompi respondió HTTP ${wompiResponse.status}.`
        },
        409
      );
    }

    const wompiRefund = wompiBody.data;
    const providerRefundId = String(
      wompiRefund.v2_refund_id ?? wompiRefund.id
    );
    const providerStatus = (wompiRefund.status ?? "").toUpperCase();

    // Wompi V2 puede devolver HTTP 201 para escenarios no aprobados. No
    // debemos marcar VIMDY como reembolsado salvo que el refund sea APPROVED.
    if (providerStatus !== "APPROVED") {
      return json(
        {
          error: "WOMPI_REFUND_NOT_APPROVED",
          detail:
            wompiRefund.status_message ??
            `Wompi devolvió estado ${providerStatus || "DESCONOCIDO"}.`,
          refund: wompiRefund
        },
        409
      );
    }

    // 6) CORRECCIÓN DEL BUG ORIGINAL.
    //    El código anterior retornaba `transaction` sin declararla.
    //    Refunds V2 solo devuelve el reembolso; por eso consultamos la
    //    transacción real después del refund aprobado.
    const transactionResponse = await fetchWompi(
      `${apiBase}/transactions/${encodeURIComponent(wompiTransactionId)}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
          Accept: "application/json"
        }
      }
    );

    const transactionBody =
      (await readJson<WompiTransactionResponse>(transactionResponse)) ?? {};

    let transaction: WompiTransaction;

    if (transactionResponse.ok && transactionBody.data) {
      // Declaración explícita: esta es la variable que faltaba.
      transaction = transactionBody.data;
    } else {
      // El reembolso externo ya fue APPROVED. Si la consulta inmediata de la
      // transacción falla, usamos un fallback consistente con los datos del
      // pago que ya teníamos, evitando volver a ejecutar otro refund.
      transaction = {
        id: wompiTransactionId,
        status: "APPROVED",
        amount_in_cents: originalAmountInCents,
        currency: paymentRow.currency,
        created_at: paymentRow.paid_at || paymentRow.created_at,
        reference: wompiTransactionId,
        refundLookupWarning:
          transactionBody.error?.reason ??
          `No se pudo consultar la transacción en Wompi (HTTP ${transactionResponse.status}).`
      };
    }

    // 7) Reflejar el refund aprobado en el histórico VIMDY.
    const refundAmount = refundAmountInCents / 100;

    const { data: refundResult, error: refundError } = await admin.rpc(
      "refund_subscription_payment_server_side",
      {
        p_payment_id: paymentRow.id,
        p_refund_amount: refundAmount,
        p_provider_refund_id: providerRefundId,
        p_now: new Date().toISOString()
      }
    );

    if (refundError) {
      return json(
        {
          error: "REFUND_UPDATE_FAILED",
          detail: refundError.message,
          refund: wompiRefund,
          transaction
        },
        500
      );
    }

    const result = (refundResult ?? {}) as RefundRpcResult;

    if (!result.ok) {
      return json(
        {
          error: "REFUND_UPDATE_FAILED",
          detail: "El RPC de VIMDY no confirmó el reembolso local.",
          refund: wompiRefund,
          transaction
        },
        500
      );
    }

    // 8) Contrato que espera WompiProvider.refundPayment().
    return json({
      ok: true,
      transaction,
      refund: wompiRefund,
      isTotalRefund: Boolean(result.is_total_refund)
    });
  } catch (error) {
    const detail =
      error instanceof DOMException && error.name === "AbortError"
        ? "La solicitud a Wompi superó el tiempo límite de 15 segundos."
        : String(error);

    return json(
      {
        error: "WOMPI_REFUND_TRANSACTION_FAILED",
        detail
      },
      500
    );
  }
});
