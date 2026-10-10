// ============================================================================
// wompi-create-pos-checkout (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 3 — POS Colombia. Crea una sesión de pago POS server-side vía la RPC
// create_wompi_sale_payment_session_atomic, luego firma la URL del Web Checkout
// de Wompi con el integrity secret (que NUNCA vive en el navegador).
//
// CONTRATO:
//   Request (JWT de usuario autenticado, llamado desde el POS):
//     {
//       saleId: string,
//       paymentMethod: "CARD" | "TRANSFER" | "QR" | "MIXED",
//       cashAmount: number,
//       externalAmount: number,
//       idempotencyKey: string,
//       shiftId?: string,
//       cashRegisterId?: string
//     }
//   Response:
//     { ok: true, sessionId: string, checkoutUrl: string, reference: string,
//       amount: number, currency: string, paymentMethod: string }
//
// SEGURIDAD:
//   - Solo usuarios autenticados que sean miembros ADMIN/GERENTE/CAJERO del
//     negocio pueden crear sesiones POS (validado en la RPC).
//   - El monto externo y la moneda se leen del servidor (la RPC valida contra
//     la venta en la base de datos), NUNCA del body del cliente. El cliente
//     envía cashAmount y externalAmount, pero la RPC VERIFICA que
//     cashAmount + externalAmount == sale.total.
//   - WOMPI_INTEGRITY_SECRET solo vive como secret de esta función.
//   - La referencia Wompi es determinista a partir de sessionId.
//   - provider='wompi' (NUNCA 'external_terminal' para checkout Web).
//
// CONFIGURACIÓN REQUERIDA:
//   supabase secrets set WOMPI_PUBLIC_KEY=pub_prod_...  (o pub_test_...)
//   supabase secrets set WOMPI_INTEGRITY_SECRET=integrity_prod_...
//   supabase secrets set APP_BASE_URL=https://app.vimdy.co
//
// Despliegue: supabase functions deploy wompi-create-pos-checkout
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

type PosPaymentMethod = "CARD" | "TRANSFER" | "QR" | "MIXED";

interface RequestBody {
  saleId: string;
  paymentMethod: PosPaymentMethod;
  cashAmount: number;
  externalAmount: number;
  idempotencyKey: string;
  shiftId?: string | null;
  cashRegisterId?: string | null;
}

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY");
const WOMPI_PUBLIC_KEY = Deno.env.get("WOMPI_PUBLIC_KEY");
const WOMPI_INTEGRITY_SECRET = Deno.env.get("WOMPI_INTEGRITY_SECRET");
const APP_BASE_URL = Deno.env.get("APP_BASE_URL") ?? "https://app.vimdy.co";

function resolveWompiCheckoutBase(): string {
  const isSandbox = WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ?? false;
  return isSandbox ? "https://checkout.wompi.co/p/" : "https://checkout.wompi.co/p/";
}

function buildWompiReference(sessionId: string): string {
  // Deterministic: same sessionId → same reference. Uses UUID without hyphens.
  return `VIMDY-${sessionId.replace(/-/g, "")}`;
}

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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !SUPABASE_ANON_KEY) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  if (!WOMPI_PUBLIC_KEY || !WOMPI_INTEGRITY_SECRET) {
    return json(
      { error: "WOMPI_CONFIG_MISSING: falta WOMPI_PUBLIC_KEY o WOMPI_INTEGRITY_SECRET" },
      500
    );
  }

  // 1) Validar JWT del usuario POS (con su JWT, no service_role)
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión." }, 401);
  }

  // Use service_role for admin operations (updating payment_sessions provider_reference)
  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  // The RPC needs auth.uid() to match the POS user — use their JWT as the access token
  // In supabase-js v2 Edge Functions, we pass the user's JWT directly as the access token
  const userClient = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    db: { schema: "public" },
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });

  let payload: RequestBody;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const { saleId, paymentMethod, cashAmount, externalAmount, idempotencyKey, shiftId, cashRegisterId } = payload;

  if (!saleId || !idempotencyKey || !paymentMethod) {
    return json(
      { error: "Faltan campos: saleId, paymentMethod, cashAmount, externalAmount e idempotencyKey son obligatorios." },
      400
    );
  }

  if (cashAmount === undefined || externalAmount === undefined || externalAmount <= 0) {
    return json(
      { error: "externalAmount debe ser > 0. cashAmount debe ser >= 0." },
      400
    );
  }

  if (cashAmount < 0) {
    return json({ error: "cashAmount no puede ser negativo." }, 400);
  }

  if (!["CARD", "TRANSFER", "QR", "MIXED"].includes(paymentMethod)) {
    return json(
      { error: `paymentMethod inválido: ${paymentMethod}. Usa CARD, TRANSFER, QR o MIXED.` },
      400
    );
  }

  // Validate method vs cashAmount consistency (server-side, redundant with RPC)
  if (paymentMethod !== "MIXED" && cashAmount !== 0) {
    return json({ error: "cashAmount debe ser 0 para métodos no MIXED." }, 400);
  }

  try {
    // 2) Crear la sesión de pago POS server-side vía RPC con el usuario autenticado.
    //    La RPC valida: tenant, membresía, estado de venta, amount, currency,
    //    y que cashAmount + externalAmount == sale.total.
    //    Crea la session con provider='wompi' (NUNCA 'external_terminal').
    const { data: rpcData, error: rpcError } = await userClient.rpc(
      "create_wompi_sale_payment_session_atomic",
      {
        p_sale_id: saleId,
        p_payment_method: paymentMethod,
        p_cash_amount: cashAmount,
        p_external_amount: externalAmount,
        p_idempotency_key: idempotencyKey,
        p_shift_id: shiftId ?? null,
        p_cash_register_id: cashRegisterId ?? null,
      }
    );

    if (rpcError) {
      return json(
        { error: "PAYMENT_SESSION_RPC_FAILED", detail: rpcError.message },
        500
      );
    }

    const rpcResult = (rpcData as any)?.[0];
    if (!rpcResult?.success) {
      return json(
        {
          error: rpcResult?.error ?? "PAYMENT_SESSION_RPC_FAILED",
          detail: rpcResult?.message ?? "No se pudo crear la sesión de pago.",
        },
        400
      );
    }

    const session = rpcResult.session;
    const sessionId = session.id;
    const businessId = session.business_id;
    const externalAmountFromRpc = Number(rpcResult.externalAmount);
    const cashAmountFromRpc = Number(rpcResult.cashAmount);
    const amount = externalAmountFromRpc;
    const currency = session.currency;

    // 3) Verificar membresía del usuario en el negocio (redundante con RPC, pero explícito)
    const { data: membership, error: membershipError } = await admin
      .from("business_members")
      .select("role")
      .eq("user_id", (await admin.auth.getUser(accessToken)).data.user?.id ?? "")
      .eq("business_id", businessId)
      .maybeSingle();

    if (membershipError || !membership) {
      return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
    }

    // 4) Generar referencia WOMPI determinista (estable para la misma session)
    const reference = buildWompiReference(sessionId);
    const amountInCents = Math.round(amount * 100);
    const signature = await buildIntegritySignature(
      reference,
      amountInCents,
      currency,
      WOMPI_INTEGRITY_SECRET
    );

    // 5) Vincular la referencia Wompi a la payment session (solo si no está vinculada)
    //    Usa service_role para UPDATE (authenticated no puede escribir)
    await admin
      .from("payment_sessions")
      .update({ provider_reference: reference })
      .eq("id", sessionId)
      .is("provider_reference", null);  // Only set if not already set (idempotency)

    // 6) Construir la URL del Web Checkout de Wompi
    const redirectUrl = `${APP_BASE_URL}/pos/checkout/${sessionId}`;
    const checkoutUrl =
      `${resolveWompiCheckoutBase()}?public-key=${encodeURIComponent(WOMPI_PUBLIC_KEY!)}` +
      `&currency=${encodeURIComponent(currency)}` +
      `&amount-in-cents=${amountInCents}` +
      `&reference=${encodeURIComponent(reference)}` +
      `&signature:integrity=${signature}` +
      `&redirect-url=${encodeURIComponent(redirectUrl)}` +
      `&format=single` +
      `&lang=es`;

    return json({
      ok: true,
      sessionId,
      checkoutUrl,
      reference,
      amount,
      currency,
      paymentMethod,
      cashAmount: cashAmountFromRpc,
      externalAmount: amount,
    });
  } catch (error) {
    return json(
      { error: "WOMPI_POS_CHECKOUT_FAILED", detail: String(error) },
      500
    );
  }
});
