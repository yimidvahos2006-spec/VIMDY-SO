// ============================================================================
// payments-reconcile (Supabase Edge Function)
// ----------------------------------------------------------------------------
// RED DE SEGURIDAD, no el camino normal. El camino normal para activar un
// plan sigue siendo wompi-webhook / mercadopago-webhook / paypal-webhook,
// que reaccionan al instante cuando el proveedor avisa. Esta función existe
// para el caso raro en que ese aviso nunca llegue (el servidor estuvo caído
// justo ese segundo, un firewall lo bloqueó, etc.) y una fila se quede en
// 'pending' aunque el proveedor sí haya resuelto el pago (aprobado o
// rechazado) hace rato.
//
// Qué hace: busca filas 'pending' con más de RECONCILE_MIN_AGE_MINUTES de
// creadas (les da tiempo de sobra a que el webhook normal y sus reintentos
// hagan su trabajo primero) y le pregunta DIRECTAMENTE a cada proveedor,
// con sus propias credenciales de servidor, cuál es el estado real de esa
// transacción — nunca confía en nada que no venga de esa consulta directa.
// Aplica exactamente la misma lógica de activación/rechazo que los tres
// webhooks (mismas columnas, mismo cálculo de renewal_date).
//
// SEGURIDAD:
//   - Este endpoint NO lo llama ningún usuario de VIMDY ni ningún
//     proveedor de pago — lo llama únicamente un cron interno (ver más
//     abajo "PROGRAMACIÓN"). Por eso exige un header propio
//     (x-reconcile-secret) en vez de un JWT de usuario o una firma de
//     proveedor. Sin ese header exacto, se rechaza sin tocar nada.
//
// CONFIGURACIÓN REQUERIDA (además de los secrets que ya tienen los otros
// checkouts/webhooks — este reusa exactamente los mismos):
//   supabase secrets set RECONCILE_SECRET=<una cadena larga aleatoria, solo la sabe tu servidor>
//
// Despliegue (SIN verificación de JWT — no hay usuario detrás de esta llamada):
//   supabase functions deploy payments-reconcile --no-verify-jwt
//
// PROGRAMACIÓN — esta función necesita correr sola cada cierto tiempo (por
// ejemplo cada 10 minutos). Opción más simple: Supabase Dashboard > Edge
// Functions > payments-reconcile > pestaña "Cron" (o "Integrations" >
// "Cron Jobs" según la versión del dashboard) y agendarla ahí con el header
// x-reconcile-secret configurado en esa misma pantalla. Si tu proyecto no
// tiene esa opción visible, la alternativa es pg_cron + pg_net desde el SQL
// Editor (ver supabase/payments_reconcile_cron.sql en este mismo proyecto).
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "content-type, x-reconcile-secret"
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

const WOMPI_PAYMENT_METHOD_MAP: Record<string, string> = {
  CARD: "wompi_card",
  PSE: "wompi_pse",
  NEQUI: "wompi_nequi"
};

const MERCADOPAGO_PAYMENT_METHOD_MAP: Record<string, string> = {
  account_money: "mercadopago_wallet",
  credit_card: "mercadopago_card",
  debit_card: "mercadopago_card",
  bank_transfer: "mercadopago_bank_transfer",
  ticket: "mercadopago_bank_transfer"
};

// Filas más viejas que esto entran a revisión. Deliberadamente holgado: los
// tres proveedores reintentan sus webhooks automáticamente durante minutos
// (a veces horas), así que no tiene sentido "competir" con esos reintentos.
const RECONCILE_MIN_AGE_MINUTES = 15;
// Tope de filas por corrida, para no arriesgar timeout si algún día se
// acumulan muchas — el cron vuelve a correr pronto y sigue con el resto.
const RECONCILE_BATCH_SIZE = 25;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const RECONCILE_SECRET = Deno.env.get("RECONCILE_SECRET");

const WOMPI_PUBLIC_KEY = Deno.env.get("WOMPI_PUBLIC_KEY");
const MERCADOPAGO_ACCESS_TOKEN = Deno.env.get("MERCADOPAGO_ACCESS_TOKEN");
const PAYPAL_CLIENT_ID = Deno.env.get("PAYPAL_CLIENT_ID");
const PAYPAL_CLIENT_SECRET = Deno.env.get("PAYPAL_CLIENT_SECRET");
const PAYPAL_ENV = Deno.env.get("PAYPAL_ENV") ?? "sandbox";

function resolveWompiApiBase(): string {
  const isSandbox = WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ?? false;
  return isSandbox ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1";
}

function resolvePayPalApiBase(): string {
  return PAYPAL_ENV === "live" ? "https://api-m.paypal.com" : "https://api-m.sandbox.paypal.com";
}

async function getPayPalAccessToken(): Promise<string> {
  const credentials = btoa(`${PAYPAL_CLIENT_ID}:${PAYPAL_CLIENT_SECRET}`);
  const response = await fetch(`${resolvePayPalApiBase()}/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
    body: "grant_type=client_credentials"
  });
  if (!response.ok) throw new Error(`No se pudo autenticar con PayPal (HTTP ${response.status}).`);
  const data = (await response.json()) as { access_token: string };
  return data.access_token;
}

interface PendingRow {
  id: string;
  business_id: string;
  plan: "monthly" | "yearly";
  amount: number;
  currency: string;
  status: string;
  wompi_reference: string | null;
  mercadopago_reference: string | null;
  paypal_order_id: string | null;
  created_at: string;
}

interface ReconcileOutcome {
  id: string;
  resolvedAs: "approved" | "declined" | "error" | "still_pending" | "skipped_no_provider_data";
}

// deno-lint-ignore no-explicit-any
async function activateBusiness(admin: any, row: PendingRow, paymentMethod: string | null, now: Date) {
  const { data, error } = await admin.rpc("activate_subscription_server_side", {
    p_business_id: row.business_id,
    p_plan: row.plan,
    p_payment_id: row.id,
    p_now: now.toISOString()
  });

  if (error) {
    console.error("PAYMENTS_RECONCILE_ACTIVATION_FAILED", JSON.stringify({ id: row.id, error: error.message }));
    return;
  }

  await admin
    .from("subscription_payments")
    .update({ payment_method: paymentMethod })
    .eq("id", row.id);
}

// deno-lint-ignore no-explicit-any
async function declineBusiness(admin: any, row: PendingRow, paymentMethod: string | null) {
  await admin
    .from("subscription_payments")
    .update({ status: "declined", payment_method: paymentMethod })
    .eq("id", row.id);

  const { error: expireError } = await admin.rpc("expire_subscription_server_side", {
    p_business_id: row.business_id,
    p_now: new Date().toISOString()
  });

  if (expireError) {
    console.error(
      "PAYMENTS_RECONCILE_EXPIRE_FAILED",
      JSON.stringify({ id: row.id, business_id: row.business_id, error: expireError.message })
    );
  }
}

// deno-lint-ignore no-explicit-any
async function markError(admin: any, row: PendingRow) {
  await admin.from("subscription_payments").update({ status: "error" }).eq("id", row.id);
}

// deno-lint-ignore no-explicit-any
async function reconcileWompi(admin: any, row: PendingRow): Promise<ReconcileOutcome> {
  if (!WOMPI_PUBLIC_KEY) {
    console.error("PAYMENTS_RECONCILE_WOMPI_CONFIG_MISSING", "WOMPI_PUBLIC_KEY no está configurada en secrets.");
    return { id: row.id, resolvedAs: "still_pending" };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(
    `${resolveWompiApiBase()}/transactions/${encodeURIComponent(row.wompi_reference as string)}`,
    { headers: { Authorization: `Bearer ${WOMPI_PUBLIC_KEY}` }, signal: controller.signal }
  );
  clearTimeout(timeoutId);

  if (response.status === 404) {
    await declineBusiness(admin, row, null);
    return { id: row.id, resolvedAs: "declined" };
  }

  if (!response.ok) {
    console.error("PAYMENTS_RECONCILE_WOMPI_HTTP_ERROR", JSON.stringify({ reference: row.wompi_reference, status: response.status }));
    return { id: row.id, resolvedAs: "still_pending" };
  }

  const body = (await response.json()) as { data?: Array<Record<string, unknown>> };
  const transaction = body.data?.[0];
  if (!transaction) {
    await declineBusiness(admin, row, null);
    return { id: row.id, resolvedAs: "declined" };
  }

  const status = String(transaction.status ?? "").toUpperCase();
  const amountInCents = Number(transaction.amount_in_cents ?? -1);
  const currency = String(transaction.currency ?? "");
  const expectedAmountInCents = Math.round(row.amount * 100);

  if (status === "APPROVED") {
    if (amountInCents !== expectedAmountInCents || currency !== row.currency) {
      await markError(admin, row);
      return { id: row.id, resolvedAs: "error" };
    }
    const paymentMethod = WOMPI_PAYMENT_METHOD_MAP[String(transaction.payment_method_type ?? "")] ?? null;
    await activateBusiness(admin, row, paymentMethod, new Date());
    return { id: row.id, resolvedAs: "approved" };
  }

  if (status === "DECLINED" || status === "VOIDED" || status === "ERROR") {
    const paymentMethod = WOMPI_PAYMENT_METHOD_MAP[String(transaction.payment_method_type ?? "")] ?? null;
    await declineBusiness(admin, row, paymentMethod);
    return { id: row.id, resolvedAs: "declined" };
  }

  return { id: row.id, resolvedAs: "still_pending" };
}

// deno-lint-ignore no-explicit-any
async function reconcileMercadoPago(admin: any, row: PendingRow): Promise<ReconcileOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  const response = await fetch(
    `https://api.mercadopago.com/v1/payments/search?external_reference=${encodeURIComponent(row.mercadopago_reference as string)}`,
    { headers: { Authorization: `Bearer ${MERCADOPAGO_ACCESS_TOKEN}` }, signal: controller.signal }
  );
  clearTimeout(timeoutId);
  if (!response.ok) return { id: row.id, resolvedAs: "still_pending" };

  const body = (await response.json()) as { results?: Array<Record<string, unknown>> };
  const payment = body.results?.[0];
  if (!payment) {
    await declineBusiness(admin, row, null);
    return { id: row.id, resolvedAs: "declined" };
  }

  const status = String(payment.status ?? "");
  const amount = Number(payment.transaction_amount ?? -1);
  const currency = String(payment.currency_id ?? "");

  if (status === "approved") {
    if (Math.abs(amount - Number(row.amount)) > 0.01 || currency !== row.currency) {
      await markError(admin, row);
      return { id: row.id, resolvedAs: "error" };
    }
    const paymentMethod = MERCADOPAGO_PAYMENT_METHOD_MAP[String(payment.payment_type_id ?? "")] ?? "mercadopago_wallet";
    await activateBusiness(admin, row, paymentMethod, new Date());
    return { id: row.id, resolvedAs: "approved" };
  }

  if (status === "rejected" || status === "cancelled") {
    const paymentMethod = MERCADOPAGO_PAYMENT_METHOD_MAP[String(payment.payment_type_id ?? "")] ?? "mercadopago_wallet";
    await declineBusiness(admin, row, paymentMethod);
    return { id: row.id, resolvedAs: "declined" };
  }

  return { id: row.id, resolvedAs: "still_pending" };
}

// deno-lint-ignore no-explicit-any
async function reconcilePayPal(admin: any, row: PendingRow, accessToken: string): Promise<ReconcileOutcome> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);
  const orderResponse = await fetch(`${resolvePayPalApiBase()}/v2/checkout/orders/${row.paypal_order_id}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    signal: controller.signal
  });
  clearTimeout(timeoutId);
  if (!orderResponse.ok) {
    if (orderResponse.status === 404) {
      await declineBusiness(admin, row, "paypal");
      return { id: row.id, resolvedAs: "declined" };
    }
    return { id: row.id, resolvedAs: "still_pending" };
  }

  const order = (await orderResponse.json()) as {
    status?: string;
    purchase_units?: { payments?: { captures?: { status?: string; amount?: { currency_code?: string; value?: string } }[] } }[];
  };

  // El comprador ya aprobó en PayPal pero la orden nunca se capturó (por
  // ejemplo, el webhook que dispara la captura nunca llegó) — hay que
  // capturarla acá, es lo mismo que haría paypal-webhook.
  if (order.status === "APPROVED") {
    const captureResponse = await fetch(`${resolvePayPalApiBase()}/v2/checkout/orders/${row.paypal_order_id}/capture`, {
      method: "POST",
      headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" }
    });
    if (!captureResponse.ok) {
      await declineBusiness(admin, row, "paypal");
      return { id: row.id, resolvedAs: "declined" };
    }
    const capture = (await captureResponse.json()) as typeof order;
    return finishPayPalCapture(admin, row, capture);
  }

  if (order.status === "COMPLETED") {
    return finishPayPalCapture(admin, row, order);
  }

  if (order.status === "VOIDED") {
    await declineBusiness(admin, row, "paypal");
    return { id: row.id, resolvedAs: "declined" };
  }

  return { id: row.id, resolvedAs: "still_pending" };
}

async function finishPayPalCapture(
  // deno-lint-ignore no-explicit-any
  admin: any,
  row: PendingRow,
  order: { purchase_units?: { payments?: { captures?: { status?: string; amount?: { currency_code?: string; value?: string } }[] } }[] }
): Promise<ReconcileOutcome> {
  const capture = order.purchase_units?.[0]?.payments?.captures?.[0];
  if (!capture || capture.status !== "COMPLETED" || !capture.amount) {
    await markError(admin, row);
    return { id: row.id, resolvedAs: "error" };
  }

  if (Math.abs(Number(capture.amount.value) - Number(row.amount)) > 0.01 || capture.amount.currency_code !== row.currency) {
    await markError(admin, row);
    return { id: row.id, resolvedAs: "error" };
  }

  const { data, error } = await admin.rpc("activate_subscription_server_side", {
    p_business_id: row.business_id,
    p_plan: row.plan,
    p_payment_id: row.id,
    p_now: new Date().toISOString()
  });

  if (error) {
    console.error("PAYMENTS_RECONCILE_PAYPAL_ACTIVATION_FAILED", JSON.stringify({ id: row.id, error: error.message }));
    return { id: row.id, resolvedAs: "still_pending" };
  }

  await admin
    .from("subscription_payments")
    .update({ payment_method: "paypal" })
    .eq("id", row.id);

  return { id: row.id, resolvedAs: "approved" };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY || !RECONCILE_SECRET) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  if (req.headers.get("x-reconcile-secret") !== RECONCILE_SECRET) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  if (new URL(req.url).searchParams.has("diagnose")) {
    const key = WOMPI_PUBLIC_KEY;
    const prefix = key?.startsWith("pub_test_") === true ? "pub_test_" : key?.startsWith("pub_prod_") === true ? "pub_prod_" : key?.startsWith("pub_") === true ? "pub_" : "other";
    const environment = key?.startsWith("pub_test_") === true ? "sandbox" : "production";
    return json({
      ok: true,
      diagnose: true,
      wompiPublicKey: {
        defined: typeof key === "string" && key.length > 0,
        length: typeof key === "string" ? key.length : 0,
        prefix,
        environment
      }
    });
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
  const cutoff = new Date(Date.now() - RECONCILE_MIN_AGE_MINUTES * 60_000).toISOString();

  const { data: rows, error: fetchError } = await admin
    .from("subscription_payments")
    .select("id, business_id, plan, amount, currency, status, wompi_reference, mercadopago_reference, paypal_order_id, created_at")
    .eq("status", "pending")
    .lt("created_at", cutoff)
    .limit(RECONCILE_BATCH_SIZE);

  if (fetchError) {
    return json({ error: "FETCH_FAILED", detail: fetchError.message }, 500);
  }

  const pendingRows = (rows ?? []) as PendingRow[];
  const outcomes: ReconcileOutcome[] = [];

  let paypalAccessToken: string | null = null;
  if (pendingRows.some((row) => row.paypal_order_id) && PAYPAL_CLIENT_ID && PAYPAL_CLIENT_SECRET) {
    try {
      paypalAccessToken = await getPayPalAccessToken();
    } catch {
      paypalAccessToken = null;
    }
  }

  for (const row of pendingRows) {
    try {
      if (row.wompi_reference) {
        outcomes.push(await reconcileWompi(admin, row));
      } else if (row.mercadopago_reference && MERCADOPAGO_ACCESS_TOKEN) {
        outcomes.push(await reconcileMercadoPago(admin, row));
      } else if (row.paypal_order_id && paypalAccessToken) {
        outcomes.push(await reconcilePayPal(admin, row, paypalAccessToken));
      } else {
        outcomes.push({ id: row.id, resolvedAs: "skipped_no_provider_data" });
      }
    } catch (error) {
      console.error("PAYMENTS_RECONCILE_ROW_FAILED", JSON.stringify({ id: row.id, error: String(error) }));
      outcomes.push({ id: row.id, resolvedAs: "still_pending" });
    }
  }

  return json({ ok: true, checked: pendingRows.length, outcomes });
});