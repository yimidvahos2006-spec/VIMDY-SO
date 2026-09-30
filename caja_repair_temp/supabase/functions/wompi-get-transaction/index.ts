// ============================================================================
// wompi-get-transaction (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Único punto autorizado para CONSULTAR el estado
// de una transacción de Wompi (GET /v1/transactions/:id). Este endpoint
// es público por diseño, pero igual se protege para evitar que un cliente
// autenticado use VIMDY como proxy abierto y consulte transacciones ajenas.
//
// CONTRATO:
//   El cliente llama a esta función con una sesión activa
//   (WompiProvider.ts -> getPayment()). supabase-js adjunta el
//   Authorization: Bearer <token> automáticamente.
//
//   Body: { transactionId }
//   Respuesta: { ok: true, transaction }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - La transacción a consultar tiene que corresponder a un cobro que ESTA
//     integración generó (existe en subscription_payments por
//     wompi_reference o por id). Así se evita el proxy abierto.
//   - El usuario debe pertenecer a ese negocio Y ser ADMIN.
//   - WOMPI_PUBLIC_KEY solo vive como secret de esta función — nunca en
//     el navegador ni en ninguna tabla.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_PUBLIC_KEY=pub_prod_...
//
// Despliegue:
//   supabase functions deploy wompi-get-transaction
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
}

interface WompiTransactionApiData {
  id: string;
  status: string;
  amount_in_cents: number;
  currency: string;
  created_at: string;
  reference: string;
}

interface WompiGetApiResponse {
  data: WompiTransactionApiData;
  error?: { type?: string; reason?: string };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_PUBLIC_KEY = Deno.env.get("WOMPI_PUBLIC_KEY");

/** Wompi resuelve sandbox/producción por el prefijo de la llave pública, igual que en WompiProvider.ts. */
function resolveWompiApiBase(publicKey: string): string {
  const isSandbox = publicKey.startsWith("pub_test_");
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

  if (!WOMPI_PUBLIC_KEY) {
    return json({ error: "WOMPI_CONFIG_MISSING: falta WOMPI_PUBLIC_KEY" }, 500);
  }

  // 1) Extraer y validar el JWT del usuario que llama.
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

  try {
    // 2) La transacción tiene que corresponder a un cobro que ESTA
    //    integración generó (existe en subscription_payments por
    //    wompi_reference o por id) — nunca se le pasa un transactionId
    //    crudo a Wompi sin antes saber a qué negocio pertenece.
    const { data: paymentRow, error: paymentLookupError } = await admin
      .from("subscription_payments")
      .select("id, business_id, status")
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
      return json({ error: "FORBIDDEN: solo un administrador puede consultar esta transacción." }, 403);
    }

    // 4) Consultar la transacción en Wompi con la llave PUBLICA — este
    //    endpoint es público por diseño, pero lo llamamos desde el servidor
    //    para no exponer la base URL ni permitir consultas arbitrarias.
    const apiBase = resolveWompiApiBase(WOMPI_PUBLIC_KEY);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15_000);
    const wompiResponse = await fetch(`${apiBase}/transactions/${transactionId}`, {
      headers: {
        "Content-Type": "application/json"
      },
      signal: controller.signal
    });
    clearTimeout(timeoutId);

    const wompiBody = (await wompiResponse.json()) as WompiGetApiResponse;

    if (!wompiResponse.ok || !wompiBody.data) {
      return json(
        {
          error: "WOMPI_GET_REJECTED",
          detail: wompiBody.error?.reason ?? `Wompi respondió HTTP ${wompiResponse.status}.`
        },
        wompiResponse.status
      );
    }

    const transaction = wompiBody.data;

    return json({ ok: true, transaction });
  } catch (error) {
    return json({ error: "WOMPI_GET_TRANSACTION_FAILED", detail: String(error) }, 500);
  }
});
