// ============================================================================
// copilot-chat (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Proxy seguro hacia la API de Claude (Anthropic). El navegador NUNCA debe
// tener la ANTHROPIC_API_KEY — si la pusiéramos en el frontend, cualquiera
// que abra las DevTools podría robarla y gastar tu saldo. Por eso esta
// función vive en el servidor (Deno, Supabase Edge Functions) y es la única
// que conoce el secreto.
//
// El cliente (CopilotApiClient.ts) llama a esta función con:
//   { system: string, messages: [{ role: "user" | "assistant", content: string }] }
// y recibe:
//   { reply: string }
//
// CONFIGURACIÓN REQUERIDA (una sola vez, desde tu terminal):
//   supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxxxxx
//
// Y despliegue:
//   supabase functions deploy copilot-chat
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL");
const corsHeaders = {
  "Access-Control-Allow-Origin": VIMDY_APP_URL ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface IncomingMessage {
  role: "user" | "assistant";
  content: string;
}

interface RequestPayload {
  system?: string;
  messages?: IncomingMessage[];
  businessId?: string;
}

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const ANTHROPIC_MODEL = "claude-sonnet-5";

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (!ANTHROPIC_API_KEY) {
    return json(
      { error: "ANTHROPIC_API_KEY_MISSING: configura el secreto con `supabase secrets set ANTHROPIC_API_KEY=...`" },
      500
    );
  }

  let payload: RequestPayload;

  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const { system, messages, businessId } = payload;

  if (!businessId) {
    return json({ error: "Falta el campo: businessId es obligatorio." }, 400);
  }

  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }

  const authUser = userData.user;

  const { data: membership, error: membershipError } = await admin
    .from("business_members")
    .select("role")
    .eq("user_id", authUser.id)
    .eq("business_id", businessId)
    .maybeSingle();

  if (membershipError) {
    return json({ error: "MEMBERSHIP_CHECK_FAILED", detail: membershipError.message }, 500);
  }

  if (!membership) {
    return json({ error: "NOT_A_MEMBER: no perteneces a este negocio." }, 403);
  }

  const { data: activeData, error: activeError } = await admin.rpc("is_business_subscription_active", {
    p_business_id: businessId
  });

  if (activeError || !activeData) {
    return json({ error: "SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido. Selecciona un plan para continuar." }, 403);
  }

  if (!messages || messages.length === 0) {
    return json({ error: "MESSAGES_REQUIRED" }, 400);
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: ANTHROPIC_MODEL,
        max_tokens: 1024,
        system: system ?? "",
        messages
      })
    });

    if (!response.ok) {
      const errorBody = await response.text();
      return json({ error: "ANTHROPIC_API_ERROR", detail: errorBody }, 502);
    }

    const data = await response.json();

    const reply = (data.content ?? [])
      .filter((block: { type: string }) => block.type === "text")
      .map((block: { text: string }) => block.text)
      .join("\n")
      .trim();

    return json({ reply: reply || "No obtuve una respuesta clara. ¿Puedes reformular la pregunta?" });
  } catch (error) {
    return json({ error: "COPILOT_REQUEST_FAILED", detail: String(error) }, 500);
  }
});