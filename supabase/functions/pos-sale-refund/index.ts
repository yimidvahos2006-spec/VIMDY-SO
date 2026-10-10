// ============================================================================
// VIMDY — pos-sale-refund
// ----------------------------------------------------------------------------
// Reembolso server-side de una venta POS pagada mediante proveedor externo.
//
// Wompi:
//   1. request_pos_sale_refund_atomic crea payment_refunds(PENDING).
//   2. El transaction_id REAL se obtiene exclusivamente de
//      payment_verifications.metadata.wompiTransactionId (o de una copia
//      server-side previamente persistida en payment_sessions.metadata).
//   3. Se consulta GET /v1/transactions/{transaction_id} con PRIVADA.
//   4. Se valida amount/currency/status.
//   5. POST /v1/refunds usando ese mismo transaction_id.
//   6. Si APPROVED, se guarda providerTransactionId/providerRefundId en
//      payment_refunds y se pasa a CONFIRMED. Un trigger SQL hace el settlement
//      financiero idempotente.
//
// NUNCA se usa payment_sessions.provider_reference como transaction_id.
// Esa referencia es la referencia comercial de VIMDY/Wompi, no el ID real
// de la transacción.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const WOMPI_PRIVATE_KEY = Deno.env.get("WOMPI_PRIVATE_KEY");
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = (Deno.env.get("PAYPAL_ENV") ?? "live").toLowerCase();
const HTTP_TIMEOUT_MS = 15000;
const MAX_MONEY_DELTA = 0.005;

type RefundProvider = "wompi" | "mercadopago" | "paypal";

type RequestPayload = {
  sessionId: string;
  amount: number;
  reason?: string;
  idempotencyKey: string;
};

type WompiTransaction = {
  id: string;
  reference: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  created_at: string;
  [key: string]: unknown;
};

type WompiTransactionResponse = {
  data?: WompiTransaction;
  error?: {
    type?: string;
    reason?: string;
    messages?: Record<string, string[]>;
  };
};

type WompiRefund = {
  id: string | number;
  status: string;
  status_message?: string;
  amount_in_cents?: number;
  transaction_id?: string;
  v2_refund_id?: string;
  reference?: string;
  created_at?: string;
  [key: string]: unknown;
};

type WompiRefundResponse = {
  data?: WompiRefund;
  error?: {
    type?: string;
    reason?: string;
    messages?: Record<string, string[]>;
  };
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function normalizeMoney(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function isPositiveMoney(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

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

async function fetchWithTimeout(
  url: string,
  init: RequestInit,
  timeoutMs = HTTP_TIMEOUT_MS
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(url, {
      ...init,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeout);
  }
}

function getWompiError(body: WompiTransactionResponse | WompiRefundResponse | null): string {
  if (!body?.error) return "";
  return (
    body.error.reason ||
    Object.values(body.error.messages ?? {})
      .flat()
      .filter(Boolean)
      .join(" | ") ||
    body.error.type ||
    "WOMPI_API_ERROR"
  );
}

async function loadUserId(
  admin: ReturnType<typeof createClient>,
  accessToken: string
): Promise<string> {
  const { data, error } = await admin.auth.getUser(accessToken);

  if (error || !data.user) {
    throw new Error("SESSION_INVALID");
  }

  return data.user.id;
}

function createAuthedClient(accessToken: string) {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
    throw new Error("SUPABASE_ANON_KEY_MISSING");
  }

  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}

async function getWompiTransaction(
  transactionId: string
): Promise<WompiTransaction> {
  if (!WOMPI_PRIVATE_KEY) {
    throw new Error("WOMPI_PRIVATE_KEY_NOT_CONFIGURED");
  }

  const normalizedId = transactionId.trim();
  if (!normalizedId) {
    throw new Error("WOMPI_TRANSACTION_ID_REQUIRED");
  }

  const response = await fetchWithTimeout(
    `${resolveWompiApiBase(WOMPI_PRIVATE_KEY)}/transactions/${encodeURIComponent(normalizedId)}`,
    {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
      },
    }
  );

  const body = await readJson<WompiTransactionResponse>(response);

  if (!response.ok || !body?.data) {
    throw new Error(
      `WOMPI_TRANSACTION_LOOKUP_FAILED: ${getWompiError(body) || `HTTP ${response.status}`}`
    );
  }

  return body.data;
}

async function resolveWompiTransactionId(
  admin: ReturnType<typeof createClient>,
  saleId: string,
  sessionId: string,
  businessId: string
): Promise<string> {
  const { data, error } = await admin
    .from("payment_verifications")
    .select("metadata")
    .eq("business_id", businessId)
    .eq("sale_id", saleId)
    .eq("provider", "wompi")
    .eq("status", "CONFIRMED")
    .order("verified_at", { ascending: false })
    .limit(10);

  if (error) {
    throw new Error(`WOMPI_TRANSACTION_ID_LOOKUP_FAILED: ${error.message}`);
  }

  for (const row of data ?? []) {
    const metadata =
      row.metadata && typeof row.metadata === "object"
        ? (row.metadata as Record<string, unknown>)
        : {};

    const candidate =
      typeof metadata.wompiTransactionId === "string"
        ? metadata.wompiTransactionId.trim()
        : typeof metadata.transactionId === "string"
          ? metadata.transactionId.trim()
          : "";

    if (candidate) return candidate;
  }

  const { data: session, error: sessionError } = await admin
    .from("payment_sessions")
    .select("metadata")
    .eq("id", sessionId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (sessionError) {
    throw new Error(
      `WOMPI_SESSION_METADATA_LOOKUP_FAILED: ${sessionError.message}`
    );
  }

  const metadata =
    session?.metadata && typeof session.metadata === "object"
      ? (session.metadata as Record<string, unknown>)
      : {};

  const candidate =
    typeof metadata.wompiTransactionId === "string"
      ? metadata.wompiTransactionId.trim()
      : typeof metadata.transactionId === "string"
        ? metadata.transactionId.trim()
        : "";

  if (candidate) return candidate;

  throw new Error(
    "WOMPI_TRANSACTION_ID_NOT_FOUND: el servidor no tiene el ID real de la transacción Wompi; no se utilizará provider_reference como sustituto."
  );
}

async function requestWompiRefund(
  transactionId: string,
  amountInCents: number,
  reason: string,
  refundReference: string
): Promise<{ refund: WompiRefund; transactionId: string }> {
  if (!WOMPI_PRIVATE_KEY) {
    throw new Error("WOMPI_PRIVATE_KEY_NOT_CONFIGURED");
  }

  const response = await fetchWithTimeout(
    `${resolveWompiApiBase(WOMPI_PRIVATE_KEY)}/refunds`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        transaction_id: transactionId,
        amount_in_cents: amountInCents,
        reason,
        reference: refundReference,
      }),
    }
  );

  const body = await readJson<WompiRefundResponse>(response);

  if (!body?.data) {
    throw new Error(
      `WOMPI_REFUND_REQUEST_FAILED: ${getWompiError(body) || `HTTP ${response.status}`}`
    );
  }

  if (!response.ok) {
    throw new Error(
      `WOMPI_REFUND_REQUEST_FAILED: ${getWompiError(body) || `HTTP ${response.status}`}`
    );
  }

  const refund = body.data;
  const providerTransactionId = String(
    refund.transaction_id ?? transactionId
  ).trim();

  if (providerTransactionId !== transactionId) {
    throw new Error(
      "WOMPI_TRANSACTION_ID_MISMATCH: el refund devolvió un transaction_id diferente al que fue validado."
    );
  }

  return {
    refund,
    transactionId: providerTransactionId,
  };
}

async function resolvePayPalAccessToken(): Promise<string> {
  if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
    throw new Error("PAYPAL_CREDENTIALS_NOT_CONFIGURED");
  }

  const base =
    PAYPAL_ENV === "sandbox"
      ? "https://api-m.sandbox.paypal.com"
      : "https://api-m.paypal.com";

  const response = await fetchWithTimeout(`${base}/v1/oauth2/token`, {
    method: "POST",
    headers: {
      Authorization: `Basic ${btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`)}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });

  const body = await readJson<{ access_token?: string }>(response);

  if (!response.ok || !body?.access_token) {
    throw new Error(`PAYPAL_TOKEN_RESOLUTION_FAILED: HTTP ${response.status}`);
  }

  return body.access_token;
}

async function settleLegacyProvider(
  admin: ReturnType<typeof createClient>,
  refundId: string,
  status: "confirmed" | "failed" | "pending",
  providerReference: string | null
) {
  const { data, error } = await admin.rpc(
    "settle_pos_sale_refund_atomic",
    {
      p_refund_id: refundId,
      p_status: status,
      p_provider_reference: providerReference,
    }
  );

  if (error) {
    throw new Error(`REFUND_SETTLE_FAILED: ${error.message}`);
  }

  return Array.isArray(data) ? data[0] : data;
}

async function reconcileWompiApprovedRefund(
  admin: ReturnType<typeof createClient>,
  refundId: string,
  transactionId: string,
  wompiRefund: WompiRefund,
  rawTransaction: WompiTransaction
) {
  const providerRefundId = String(
    wompiRefund.v2_refund_id ?? wompiRefund.id
  ).trim();

  if (!providerRefundId) {
    throw new Error("WOMPI_REFUND_ID_MISSING");
  }

  if (String(wompiRefund.transaction_id ?? transactionId).trim() !== transactionId) {
    throw new Error("WOMPI_TRANSACTION_ID_MISMATCH");
  }

  const amountInCents = Number(wompiRefund.amount_in_cents);
  if (!Number.isInteger(amountInCents) || amountInCents <= 0) {
    throw new Error("WOMPI_REFUND_AMOUNT_INVALID");
  }

  if (rawTransaction.currency.toUpperCase() !== "COP") {
    throw new Error("WOMPI_TRANSACTION_CURRENCY_MISMATCH");
  }

  if (amountInCents > rawTransaction.amount_in_cents) {
    throw new Error("WOMPI_REFUND_AMOUNT_EXCEEDS_TRANSACTION");
  }

  const metadata = {
    providerTransactionId: transactionId,
    providerRefundId,
    providerStatus: String(wompiRefund.status ?? "").toUpperCase(),
    providerReference: wompiRefund.reference ?? null,
    providerResponse: wompiRefund,
    verifiedTransaction: {
      id: rawTransaction.id,
      reference: rawTransaction.reference,
      status: rawTransaction.status,
      amount_in_cents: rawTransaction.amount_in_cents,
      currency: rawTransaction.currency,
      checkedAt: new Date().toISOString(),
    },
  };

  // Toda la transición financiera local se hace dentro de PostgreSQL.
  // La función SQL bloquea el refund, actualiza session/sale y crea el
  // cash_movement OUT con cashAmount=0 de forma idempotente mediante el
  // trigger de reconciliación.
  const { data, error } = await admin.rpc(
    "reconcile_wompi_refund_atomic",
    {
      p_refund_id: refundId,
      p_provider_transaction_id: transactionId,
      p_provider_refund_id: providerRefundId,
      p_provider_metadata: metadata,
      p_now: new Date().toISOString(),
    }
  );

  if (error) {
    throw new Error(
      `WOMPI_REFUND_RECONCILIATION_FAILED: ${error.message}`
    );
  }

  const result = Array.isArray(data) ? data[0] : data;

  if (!result || result.success !== true) {
    throw new Error(
      "WOMPI_REFUND_RECONCILIATION_FAILED: PostgreSQL no confirmó la conciliación."
    );
  }

  return result;
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

  const authorization = req.headers.get("Authorization");
  const accessToken = authorization
    ?.replace(/^Bearer\s+/i, "")
    .trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  let payload: RequestPayload;

  try {
    payload = (await req.json()) as RequestPayload;
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  if (
    typeof payload.sessionId !== "string" ||
    !payload.sessionId.trim() ||
    typeof payload.idempotencyKey !== "string" ||
    !payload.idempotencyKey.trim() ||
    !isPositiveMoney(payload.amount)
  ) {
    return json(
      {
        error:
          "REFUND_ARGUMENTS_INVALID: sessionId, amount e idempotencyKey son obligatorios.",
      },
      400
    );
  }

  try {
    const actorId = await loadUserId(admin, accessToken);
    const userClient = createAuthedClient(accessToken);

    const { data: requestResult, error: requestError } =
      await userClient.rpc("request_pos_sale_refund_atomic", {
        p_session_id: payload.sessionId.trim(),
        p_amount: normalizeMoney(payload.amount),
        p_idempotency_key: payload.idempotencyKey.trim(),
        p_reason: payload.reason?.trim() || null,
      });

    if (requestError) {
      return json(
        {
          error: "REFUND_REQUEST_FAILED",
          detail: requestError.message,
        },
        400
      );
    }

    const requestData = Array.isArray(requestResult)
      ? requestResult[0]
      : requestResult;

    if (!requestData?.success || !requestData.refund) {
      return json(
        {
          error:
            requestData?.error ?? "REFUND_REQUEST_FAILED",
          detail:
            requestData?.message ??
            "No se pudo iniciar el reembolso.",
        },
        400
      );
    }

    const refund = requestData.refund as Record<string, unknown>;
    const provider = String(requestData.provider ?? refund.provider ?? "").toLowerCase() as RefundProvider;
    const refundId = String(refund.id ?? "").trim();
    const saleId = String(refund.sale_id ?? "").trim();
    const businessId = String(refund.business_id ?? "").trim();
    const sessionId = String(refund.session_id ?? payload.sessionId).trim();
    const refundAmount = normalizeMoney(Number(refund.amount));
    const currency = String(refund.currency ?? "COP").toUpperCase();

    if (!refundId || !saleId || !businessId || !isPositiveMoney(refundAmount)) {
      throw new Error("REFUND_RECORD_INVALID");
    }

    if (requestData.idempotent) {
      if (String(refund.status).toLowerCase() === "confirmed") {
        return json({
          ok: true,
          idempotent: true,
          refund,
          provider,
          status: "confirmed",
          providerReference: refund.provider_reference ?? null,
        });
      }
    }

    if (provider === "wompi") {
      if (currency !== "COP") {
        throw new Error("WOMPI_CURRENCY_INVALID");
      }

      const transactionId = await resolveWompiTransactionId(
        admin,
        saleId,
        sessionId,
        businessId
      );

      const transaction = await getWompiTransaction(transactionId);
      const expectedCents = Math.round(refundAmount * 100);

      if (transaction.status.toUpperCase() !== "APPROVED") {
        throw new Error(
          `WOMPI_TRANSACTION_NOT_APPROVED: ${transaction.status}`
        );
      }

      if (transaction.currency.toUpperCase() !== "COP") {
        throw new Error(
          `WOMPI_TRANSACTION_CURRENCY_MISMATCH: ${transaction.currency}`
        );
      }

      const { data: sessionRow, error: sessionError } = await admin
        .from("payment_sessions")
        .select("amount,currency,status,provider,provider_reference")
        .eq("id", sessionId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (sessionError) {
        throw new Error(
          `WOMPI_SESSION_LOOKUP_FAILED: ${sessionError.message}`
        );
      }

      if (!sessionRow) {
        throw new Error("WOMPI_SESSION_NOT_FOUND");
      }

      if (String(sessionRow.provider).toLowerCase() !== "wompi") {
        throw new Error("WOMPI_SESSION_PROVIDER_MISMATCH");
      }

      if (String(sessionRow.status).toLowerCase() !== "approved") {
        throw new Error("WOMPI_SESSION_NOT_APPROVED");
      }

      if (String(sessionRow.currency).toUpperCase() !== "COP") {
        throw new Error("WOMPI_SESSION_CURRENCY_INVALID");
      }

      const expectedSessionCents = Math.round(
        Number(sessionRow.amount) * 100
      );

      if (
        !Number.isInteger(expectedSessionCents) ||
        expectedSessionCents <= 0 ||
        transaction.amount_in_cents !== expectedSessionCents
      ) {
        throw new Error(
          `WOMPI_TRANSACTION_AMOUNT_MISMATCH: transacción=${transaction.amount_in_cents}, sesión=${expectedSessionCents}`
        );
      }

      if (expectedCents > transaction.amount_in_cents) {
        throw new Error(
          "WOMPI_REFUND_AMOUNT_EXCEEDS_TRANSACTION"
        );
      }

      const refundReference = `VIMDY-REFUND-${refundId}`;
      const wompiResult = await requestWompiRefund(
        transaction.id,
        expectedCents,
        payload.reason?.trim() || `Reembolso venta POS ${saleId.slice(0, 8)}`,
        refundReference
      );

      const providerStatus = String(
        wompiResult.refund.status ?? ""
      ).toUpperCase();

      if (providerStatus !== "APPROVED") {
        const failedStatus = ["DECLINED", "ERROR", "CANCELLED"].includes(
          providerStatus
        )
          ? "failed"
          : "pending";

        const providerRefundId = String(
          wompiResult.refund.v2_refund_id ?? wompiResult.refund.id ?? ""
        ).trim();

        const { data: pendingUpdate, error: pendingUpdateError } =
          await admin
            .from("payment_refunds")
            .update({
              status: failedStatus,
              provider_reference: providerRefundId || null,
              metadata: {
                providerTransactionId: transaction.id,
                providerRefundId: providerRefundId || null,
                providerStatus,
                providerResponse: wompiResult.refund,
                verifiedTransaction: transaction,
              },
              updated_at: new Date().toISOString(),
            })
            .eq("id", refundId)
            .eq("status", "pending")
            .select("*")
            .maybeSingle();

        if (pendingUpdateError) {
          throw new Error(
            `WOMPI_REFUND_STATUS_PERSIST_FAILED: ${pendingUpdateError.message}`
          );
        }

        return json({
          ok: failedStatus === "pending",
          idempotent: false,
          refund: pendingUpdate ?? refund,
          provider,
          status: failedStatus,
          providerReference: providerRefundId || null,
          providerStatus,
        });
      }

      const reconciled = await reconcileWompiApprovedRefund(
        admin,
        refundId,
        transaction.id,
        wompiResult.refund,
        transaction
      );

      const { data: finalRefund, error: finalRefundError } = await admin
        .from("payment_refunds")
        .select("*")
        .eq("id", refundId)
        .single();

      if (finalRefundError || !finalRefund) {
        throw new Error(
          `WOMPI_REFUND_FINAL_LOOKUP_FAILED: ${finalRefundError?.message ?? "refund no encontrado"}`
        );
      }

      return json({
        ok: true,
        idempotent: false,
        refund: finalRefund ?? reconciled,
        provider,
        status: "confirmed",
        providerReference:
          finalRefund.provider_reference ??
          String(wompiResult.refund.v2_refund_id ?? wompiResult.refund.id),
        providerTransactionId: transaction.id,
        providerStatus: "APPROVED",
      });
    }

    // -----------------------------------------------------------------------
    // MercadoPago / PayPal: mantienen el settlement existente de VIMDY.
    // -----------------------------------------------------------------------
    const providerReference = String(
      requestData.provider_reference ?? ""
    ).trim();

    if (provider === "mercadopago") {
      if (!MERCADOPAGO_ACCESS_TOKEN) {
        throw new Error("MERCADOPAGO_ACCESS_TOKEN_NOT_CONFIGURED");
      }

      if (!providerReference) {
        throw new Error("MERCADOPAGO_TRANSACTION_ID_NOT_FOUND");
      }

      const response = await fetchWithTimeout(
        `https://api.mercadopago.com/v1/payments/${encodeURIComponent(providerReference)}/refunds`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ amount: refundAmount }),
        }
      );

      const body = await readJson<Record<string, unknown>>(response);

      if (!response.ok) {
        throw new Error(
          `MERCADOPAGO_REFUND_FAILED: ${String(body?.message ?? `HTTP ${response.status}`)}`
        );
      }

      const refundReference = String(body?.id ?? providerReference);
      const settled = await settleLegacyProvider(
        admin,
        refundId,
        "confirmed",
        refundReference
      );

      return json({
        ok: true,
        idempotent: false,
        refund: settled,
        provider,
        status: "confirmed",
        providerReference: refundReference,
        providerStatus: String(body?.status ?? "completed"),
      });
    }

    if (provider === "paypal") {
      if (!PAYPAL_CLIENT_ID || !PAYPAL_CLIENT_SECRET) {
        throw new Error("PAYPAL_CREDENTIALS_NOT_CONFIGURED");
      }

      const { data: sessionData, error: sessionError } = await admin
        .from("payment_sessions")
        .select("metadata")
        .eq("id", sessionId)
        .eq("business_id", businessId)
        .maybeSingle();

      if (sessionError || !sessionData) {
        throw new Error(
          `PAYPAL_SESSION_LOOKUP_FAILED: ${sessionError?.message ?? "sesión no encontrada"}`
        );
      }

      const metadata =
        sessionData.metadata && typeof sessionData.metadata === "object"
          ? (sessionData.metadata as Record<string, unknown>)
          : {};

      const captureId =
        typeof metadata.paypal_capture_id === "string"
          ? metadata.paypal_capture_id.trim()
          : "";

      if (!captureId) {
        throw new Error("PAYPAL_CAPTURE_ID_NOT_FOUND");
      }

      const base =
        PAYPAL_ENV === "sandbox"
          ? "https://api-m.sandbox.paypal.com"
          : "https://api-m.paypal.com";

      const accessTokenPaypal = await resolvePayPalAccessToken();

      const response = await fetchWithTimeout(
        `${base}/v2/payments/captures/${encodeURIComponent(captureId)}/refund`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessTokenPaypal}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            amount: {
              currency_code: currency,
              value: refundAmount.toFixed(2),
            },
          }),
        }
      );

      const body = await readJson<Record<string, unknown>>(response);

      if (!response.ok) {
        throw new Error(
          `PAYPAL_REFUND_FAILED: ${String(body?.message ?? `HTTP ${response.status}`)}`
        );
      }

      const refundReference = String(body?.id ?? captureId);
      const settled = await settleLegacyProvider(
        admin,
        refundId,
        "confirmed",
        refundReference
      );

      return json({
        ok: true,
        idempotent: false,
        refund: settled,
        provider,
        status: "confirmed",
        providerReference: refundReference,
        providerStatus: String(body?.status ?? "COMPLETED"),
      });
    }

    return json(
      { error: `PROVIDER_NOT_SUPPORTED: ${provider}` },
      400
    );
  } catch (error) {
    const message = errorText(error);
    const status =
      message.includes("FORBIDDEN") || message.includes("NOT_A_MEMBER")
        ? 403
        : message.includes("NOT_FOUND")
          ? 404
          : message.includes("INVALID") || message.includes("REQUIRED")
            ? 400
            : 500;

    return json(
      {
        error: "POS_SALE_REFUND_FAILED",
        detail: message,
      },
      status
    );
  }
});
