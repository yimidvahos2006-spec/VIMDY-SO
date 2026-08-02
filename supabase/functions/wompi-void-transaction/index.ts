// ============================================================================
// wompi-void-transaction (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — Wompi real. Único punto autorizado para ANULAR una transacción
// de Wompi todavía no capturada/liquidada (POST /v1/transactions/:id/void).
// Exige la llave PRIVADA del comercio (Authorization: Bearer <private_key>),
// así que jamás puede ejecutarse en el navegador — WompiProvider.cancelPayment()
// delega acá justo por eso.
//
// CONTRATO:
//   El cliente llama a esta función con una sesión activa
//   (WompiProvider.ts -> cancelPayment()). supabase-js adjunta el
//   Authorization: Bearer <token> automáticamente.
//
//   Body: { transactionId }
//   Respuesta: { ok: true, transaction }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - La transacción a anular tiene que pertenecer a un `wompi_reference`
//     que exista en `subscription_payments` del `business_id` al que
//     pertenece el usuario que llama, y ese usuario debe ser ADMIN —
//     igual que activate-subscription. Así se evita que cualquier cuenta
//     autenticada pueda anular la transacción de OTRO negocio con solo
//     adivinar/probar un transactionId de Wompi.
//   - WOMPI_PRIVATE_KEY solo vive como secret de esta función — nunca en
//     el navegador ni en ninguna tabla.
//   - Solo aplica a transacciones que Wompi todavía pueda anular (PENDING
//     o recién APPROVED sin liquidar). Si Wompi la rechaza por estar fuera
//     de esa ventana, se devuelve tal cual el error de Wompi — esta función
//     no intenta adivinar ni forzar nada.
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_PRIVATE_KEY=prv_prod_...
//
// Despliegue:
//   supabase functions deploy wompi-void-transaction
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

interface WompiVoidApiResponse {
  data: WompiTransactionApiData;
  error?: { type?: string; reason?: string };
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const WOMPI_PRIVATE_KEY = Deno.env.get("WOMPI_PRIVATE_KEY");

/** Wompi resuelve sandbox/producción por el prefijo de la llave privada, igual que el público en WompiProvider.ts. */
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
  //    activate-subscription: NUNCA confiamos en nada del body sin antes
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

  try {
    // 2) La transacción tiene que corresponder a un cobro que ESTA
    //    integración generó (existe en subscription_payments por
    //    wompi_reference) — nunca se le pasa un transactionId crudo a
    //    Wompi sin antes saber a qué negocio pertenece.
    //    NOTA: transaction_id de Wompi solo se conoce con certeza una vez
    //    que wompi-webhook procesó el evento; por eso se busca tanto por
    //    referencia como por transaction_id ya guardado en el histórico.
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
      return json({ error: "FORBIDDEN: solo un administrador puede anular un pago." }, 403);
    }

    // 4) Anular en Wompi con la llave PRIVADA — esto es lo único que este
    //    endpoint le agrega a la operación (el navegador no puede hacerlo).
    const apiBase = resolveWompiApiBase(WOMPI_PRIVATE_KEY);
    const wompiResponse = await fetch(`${apiBase}/transactions/${transactionId}/void`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${WOMPI_PRIVATE_KEY}`,
        "Content-Type": "application/json"
      }
    });

    const wompiBody = (await wompiResponse.json()) as WompiVoidApiResponse;

    if (!wompiResponse.ok || !wompiBody.data) {
      return json(
        {
          error: "WOMPI_VOID_REJECTED",
          detail: wompiBody.error?.reason ?? `Wompi respondió HTTP ${wompiResponse.status}.`
        },
        409
      );
    }

    const transaction = wompiBody.data;

    // 5) Reflejar el resultado real en nuestro propio histórico — nunca se
    //    asume "anulado" en subscription_payments solo porque se llamó a
    //    este endpoint: se guarda lo que Wompi confirmó de vuelta.
    if (transaction.status === "VOIDED") {
      const { error: paymentUpdateError } = await admin
        .from("subscription_payments")
        .update({ status: "declined" })
        .eq("id", paymentRow.id);

      if (paymentUpdateError) {
        return json({ error: "PAYMENT_UPDATE_FAILED", detail: paymentUpdateError.message }, 500);
      }

      // Si el negocio ya había quedado 'approved' por este mismo pago
      // (ej. anulación disparada justo después de la aprobación), se
      // revierte su estado de pago — el plan/fechas de vigencia actuales
      // NO se tocan: VIMDY no revoca acceso ya otorgado por una anulación,
      // solo dejan de proyectarse renovaciones futuras sobre este cobro.
      await admin
        .from("businesses")
        .update({ payment_status: "declined" })
        .eq("id", paymentRow.business_id)
        .eq("payment_status", "approved");
    }

    return json({ ok: true, transaction });
  } catch (error) {
    return json({ error: "WOMPI_VOID_TRANSACTION_FAILED", detail: String(error) }, 500);
  }
});