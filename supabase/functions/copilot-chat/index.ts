// ============================================================================
// copilot-chat (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Proxy seguro hacia la API de Gemini (Google AI Studio). El navegador NUNCA
// debe tener la GEMINI_API_KEY — si estuviera en el frontend, cualquiera que
// abra las DevTools podría robarla y gastar tu cuota. Por eso esta función
// vive en el servidor (Deno, Supabase Edge Functions) y es la única que
// conoce el secreto.
//
// Contrato con el cliente (CopilotApiClient.ts) — NO cambió:
//   entrada: { system: string, messages: [{ role: "user" | "assistant", content: string }], businessId: string }
//   salida:  { reply: string }
//
// CONFIGURACIÓN REQUERIDA (una sola vez, desde tu terminal):
//   supabase secrets set GEMINI_API_KEY=<tu clave>
//   (opcional) supabase secrets set GEMINI_MODEL=<modelo vigente>
//
// DESPLIEGUE:
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

interface GeminiContent {
  role: "user" | "model";
  parts: { text: string }[];
}

// Hasta dos claves de Gemini. Lo ideal es que la segunda sea de OTRO proyecto
// de Google (en AI Studio: "Create API key" en un proyecto distinto), porque
// la cuota gratis se cuenta por proyecto, no por clave.
const GEMINI_API_KEYS = [Deno.env.get("GEMINI_API_KEY"), Deno.env.get("GEMINI_API_KEY_2")]
  .map((k) => (k ?? "").trim())
  .filter((k) => k.length > 0);

// Mismo modelo que ya usa menu-vision. Si Google lo retira, cámbialo con
// `supabase secrets set GEMINI_MODEL=...` sin tocar código (revisa la lista
// vigente en https://ai.google.dev/gemini-api/docs/models).
const GEMINI_MODEL = (Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash").trim();
// Opcional: segundo modelo de respaldo (por ejemplo uno "lite", con más cuota
// gratis). Si no se define, no se usa.
const GEMINI_FALLBACK_MODEL = (Deno.env.get("GEMINI_FALLBACK_MODEL") ?? "").trim();
const GEMINI_TIMEOUT_MS = 25_000;

/**
 * Convierte el historial al formato de Gemini: el rol "assistant" se llama
 * "model", y la conversación debe empezar con un mensaje de "user" (el
 * recorte de historial del cliente puede dejar un "assistant" al inicio).
 */
function toGeminiContents(messages: IncomingMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = messages
    .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
    .map((m) => ({
      role: m.role === "assistant" ? ("model" as const) : ("user" as const),
      parts: [{ text: m.content }]
    }));

  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  return contents;
}

class ProviderError extends Error {}

async function callGemini(
  apiKey: string,
  model: string,
  system: string,
  messages: IncomingMessage[]
): Promise<string> {
  const contents = toGeminiContents(messages);
  if (contents.length === 0) throw new ProviderError("GEMINI_NO_CONTENT");

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La clave va en header (no en ?key=) para que nunca quede en URLs,
        // logs ni en el "detail" de un error.
        "x-goog-api-key": apiKey
      },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents,
        generationConfig: {
          temperature: 0.4,
          // Gemini cuenta el "pensamiento" dentro de maxOutputTokens: con un
          // tope bajo y razonamiento alto la respuesta puede salir vacía.
          thinkingConfig: { thinkingLevel: "low" },
          maxOutputTokens: 2048
        }
      })
    }
  );

  if (!response.ok) {
    const errorBody = await response.text();
    throw new ProviderError(`GEMINI_API_ERROR ${response.status}: ${errorBody.slice(0, 300)}`);
  }

  const data = await response.json();

  if (data?.promptFeedback?.blockReason) {
    throw new ProviderError(`GEMINI_BLOCKED: ${data.promptFeedback.blockReason}`);
  }

  const reply = ((data?.candidates?.[0]?.content?.parts ?? []) as { text?: string; thought?: boolean }[])
    .filter((part) => typeof part.text === "string" && !part.thought)
    .map((part) => part.text as string)
    .join("\n")
    .trim();

  if (!reply) throw new ProviderError("GEMINI_EMPTY_REPLY");
  return reply;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  if (GEMINI_API_KEYS.length === 0) {
    return json(
      { error: "GEMINI_API_KEY_MISSING: configura el secreto con `supabase secrets set GEMINI_API_KEY=...`" },
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

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "MESSAGES_REQUIRED" }, 400);
  }

  const systemText = system ?? "";
  const failures: string[] = [];

  // Orden de intentos: clave 1 con el modelo principal; clave 2 (si existe) con
  // el modelo principal; y por último el modelo de respaldo (si existe) con
  // cada clave. Se corta en la primera respuesta válida.
  const attempts: { key: string; model: string; label: string }[] = [];
  GEMINI_API_KEYS.forEach((key, i) =>
    attempts.push({ key, model: GEMINI_MODEL, label: `clave${i + 1}/${GEMINI_MODEL}` })
  );
  if (GEMINI_FALLBACK_MODEL && GEMINI_FALLBACK_MODEL !== GEMINI_MODEL) {
    GEMINI_API_KEYS.forEach((key, i) =>
      attempts.push({ key, model: GEMINI_FALLBACK_MODEL, label: `clave${i + 1}/${GEMINI_FALLBACK_MODEL}` })
    );
  }

  for (const attempt of attempts) {
    try {
      return json({ reply: await callGemini(attempt.key, attempt.model, systemText, messages) });
    } catch (error) {
      failures.push(`${attempt.label}: ${String(error)}`);
      console.error("copilot-chat: intento falló", attempt.label, String(error));
    }
  }

  return json({ error: "COPILOT_REQUEST_FAILED", detail: failures.join(" | ").slice(0, 800) }, 502);
});