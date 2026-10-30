// ============================================================================
// VIMDY Copilot — Supabase Edge Function
// ---------------------------------------------------------------------------
// Seguridad:
// - Valida sesión con Supabase Auth.
// - Valida que el usuario pertenezca al businessId recibido.
// - Valida que la suscripción del negocio esté activa.
// - Mantiene todas las claves de proveedores exclusivamente en servidor.
//
// Failover:
// 1. Gemini: todas las claves configuradas con el modelo principal.
// 2. Gemini: todas las claves con el modelo secundario (si existe).
// 3. Proveedor OpenAI-compatible configurado como respaldo.
//
// Contrato con CopilotApiClient.ts (se mantiene):
//   entrada: { system, messages, businessId }
//   salida:  { reply, provider?, model?, fallbackActivated? }
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = (Deno.env.get("VIMDY_APP_URL") ?? "").trim();
const corsHeaders = {
  "Access-Control-Allow-Origin": VIMDY_APP_URL || "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin"
};

const SUPABASE_URL = (Deno.env.get("SUPABASE_URL") ?? "").trim();
const SERVICE_ROLE_KEY = (
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
).trim();

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
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

class ProviderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderError";
  }
}

// ---------------------------------------------------------------------------
// Gemini — proveedor principal
// ---------------------------------------------------------------------------

// Hasta dos claves. Se recomienda que pertenezcan a proyectos Google distintos
// para que la cuota no dependa de un único proyecto.
const GEMINI_API_KEYS = [
  Deno.env.get("GEMINI_API_KEY"),
  Deno.env.get("GEMINI_API_KEY_2")
]
  .map((key) => (key ?? "").trim())
  .filter((key) => key.length > 0);

const GEMINI_MODEL = (
  Deno.env.get("GEMINI_MODEL") ?? "gemini-3.6-flash"
).trim();

const GEMINI_FALLBACK_MODEL = (
  Deno.env.get("GEMINI_FALLBACK_MODEL") ?? ""
).trim();

const GEMINI_TIMEOUT_MS = 25_000;

// ---------------------------------------------------------------------------
// Proveedor alternativo — OpenAI o cualquier API compatible con Chat Completions
// ---------------------------------------------------------------------------

const AI_FALLBACK_API_KEY = (
  Deno.env.get("AI_FALLBACK_API_KEY") ??
  Deno.env.get("OPENAI_API_KEY") ??
  ""
).trim();

const AI_FALLBACK_PROVIDER = (
  Deno.env.get("AI_FALLBACK_PROVIDER") ?? "openai-compatible"
).trim();

const AI_FALLBACK_BASE_URL = (
  Deno.env.get("AI_FALLBACK_BASE_URL") ?? "https://api.openai.com/v1"
).trim().replace(/\/+$/, "");

const AI_FALLBACK_MODEL = (
  Deno.env.get("AI_FALLBACK_MODEL") ?? "gpt-4.1-mini"
).trim();

const AI_FALLBACK_TIMEOUT_MS = 25_000;

const parsedFallbackTokenLimit = Number(
  Deno.env.get("AI_FALLBACK_MAX_TOKENS") ?? "1200"
);

const AI_FALLBACK_MAX_TOKENS =
  Number.isFinite(parsedFallbackTokenLimit) && parsedFallbackTokenLimit > 0
    ? Math.min(Math.floor(parsedFallbackTokenLimit), 8192)
    : 1200;

// OpenAI documenta max_completion_tokens como el nombre actual. Algunos
// proveedores compatibles solo implementan max_tokens; se puede seleccionar
// ese formato con AI_FALLBACK_TOKEN_LIMIT_FIELD=max_tokens.
const AI_FALLBACK_TOKEN_LIMIT_FIELD =
  Deno.env.get("AI_FALLBACK_TOKEN_LIMIT_FIELD")?.trim() === "max_tokens"
    ? "max_tokens"
    : "max_completion_tokens";

// ---------------------------------------------------------------------------
// Normalización del historial
// ---------------------------------------------------------------------------

function toGeminiContents(messages: IncomingMessage[]): GeminiContent[] {
  const contents: GeminiContent[] = messages
    .filter(
      (message) =>
        message &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
    .map((message) => ({
      role: message.role === "assistant" ? "model" as const : "user" as const,
      parts: [{ text: message.content }]
    }));

  // Gemini exige que el primer contenido conversacional sea del usuario.
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  return contents;
}

function toOpenAIContents(messages: IncomingMessage[]): IncomingMessage[] {
  const contents = messages
    .filter(
      (message) =>
        message &&
        (message.role === "user" || message.role === "assistant") &&
        typeof message.content === "string" &&
        message.content.trim().length > 0
    )
    .map((message) => ({
      role: message.role,
      content: message.content
    }));

  // Chat Completions debe comenzar con un mensaje de usuario.
  while (contents.length > 0 && contents[0].role !== "user") {
    contents.shift();
  }

  return contents;
}

// ---------------------------------------------------------------------------
// Llamada a Gemini
// ---------------------------------------------------------------------------

async function callGemini(
  apiKey: string,
  model: string,
  system: string,
  messages: IncomingMessage[]
): Promise<string> {
  const contents = toGeminiContents(messages);

  if (contents.length === 0) {
    throw new ProviderError("GEMINI_NO_CONTENT");
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        // La clave va en header, nunca en la URL.
        "x-goog-api-key": apiKey
      },
      signal: AbortSignal.timeout(GEMINI_TIMEOUT_MS),
      body: JSON.stringify({
        systemInstruction: {
          parts: [{ text: system }]
        },
        contents,
        generationConfig: {
          temperature: 0.4,
          thinkingConfig: { thinkingLevel: "low" },
          maxOutputTokens: 2048
        }
      })
    }
  );

  if (!response.ok) {
    // No reenviamos el cuerpo upstream al cliente: puede contener detalles
    // internos del proveedor y no es necesario para activar el failover.
    throw new ProviderError(`GEMINI_API_ERROR_${response.status}`);
  }

  const data = await response.json();

  if (data?.promptFeedback?.blockReason) {
    throw new ProviderError(
      `GEMINI_BLOCKED_${String(data.promptFeedback.blockReason)}`
    );
  }

  const parts = (data?.candidates?.[0]?.content?.parts ?? []) as {
    text?: string;
    thought?: boolean;
  }[];

  const reply = parts
    .filter(
      (part) => typeof part.text === "string" && !part.thought
    )
    .map((part) => part.text as string)
    .join("\n")
    .trim();

  if (!reply) {
    throw new ProviderError("GEMINI_EMPTY_REPLY");
  }

  return reply;
}

// ---------------------------------------------------------------------------
// Llamada al proveedor alternativo OpenAI-compatible
// ---------------------------------------------------------------------------

async function callFallbackProvider(
  system: string,
  messages: IncomingMessage[]
): Promise<string> {
  if (!AI_FALLBACK_API_KEY) {
    throw new ProviderError("FALLBACK_API_KEY_MISSING");
  }

  if (!AI_FALLBACK_BASE_URL || !AI_FALLBACK_MODEL) {
    throw new ProviderError("FALLBACK_CONFIGURATION_INVALID");
  }

  const contents = toOpenAIContents(messages);

  if (contents.length === 0) {
    throw new ProviderError("FALLBACK_NO_CONTENT");
  }

  const tokenLimit: Record<string, number> = {
    [AI_FALLBACK_TOKEN_LIMIT_FIELD]: AI_FALLBACK_MAX_TOKENS
  };

  const response = await fetch(
    `${AI_FALLBACK_BASE_URL}/chat/completions`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${AI_FALLBACK_API_KEY}`
      },
      signal: AbortSignal.timeout(AI_FALLBACK_TIMEOUT_MS),
      body: JSON.stringify({
        model: AI_FALLBACK_MODEL,
        messages: [
          {
            role: "system",
            content: system
          },
          ...contents
        ],
        ...tokenLimit,
        stream: false
      })
    }
  );

  if (!response.ok) {
    throw new ProviderError(
      `FALLBACK_API_ERROR_${response.status}`
    );
  }

  const data = await response.json();
  const rawContent = data?.choices?.[0]?.message?.content;

  const reply = typeof rawContent === "string"
    ? rawContent.trim()
    : Array.isArray(rawContent)
      ? rawContent
          .map((part: { text?: string }) =>
            typeof part?.text === "string" ? part.text : ""
          )
          .join("\n")
          .trim()
      : "";

  if (!reply) {
    throw new ProviderError("FALLBACK_EMPTY_REPLY");
  }

  return reply;
}

// ---------------------------------------------------------------------------
// Handler HTTP
// ---------------------------------------------------------------------------

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "METHOD_NOT_ALLOWED" }, 405);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("copilot-chat: falta SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY");
    return json({ error: "SUPABASE_SERVER_CONFIGURATION_MISSING" }, 500);
  }

  let payload: RequestPayload;

  try {
    const parsed: unknown = await req.json();

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return json({ error: "INVALID_REQUEST_BODY" }, 400);
    }

    payload = parsed as RequestPayload;
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const { system, messages, businessId } = payload;

  if (typeof businessId !== "string" || businessId.trim().length === 0) {
    return json({ error: "BUSINESS_ID_REQUIRED" }, 400);
  }

  if (typeof system !== "string" || system.trim().length === 0) {
    return json({ error: "SYSTEM_PROMPT_REQUIRED" }, 400);
  }

  if (system.length > 100_000) {
    return json({ error: "SYSTEM_PROMPT_TOO_LARGE" }, 413);
  }

  if (!Array.isArray(messages) || messages.length === 0) {
    return json({ error: "MESSAGES_REQUIRED" }, 400);
  }

  if (messages.length > 32) {
    return json({ error: "TOO_MANY_MESSAGES" }, 400);
  }

  const validMessages = messages.every(
    (message) =>
      message &&
      (message.role === "user" || message.role === "assistant") &&
      typeof message.content === "string" &&
      message.content.trim().length > 0 &&
      message.content.length <= 20_000
  );

  if (!validMessages) {
    return json({ error: "INVALID_MESSAGES" }, 400);
  }

  const authHeader = req.headers.get("Authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH" }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false
    }
  });

  const { data: userData, error: userError } = await admin.auth.getUser(
    accessToken
  );

  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }

  const authUser = userData.user;

  const { data: membership, error: membershipError } = await admin
    .from("business_members")
    .select("role")
    .eq("user_id", authUser.id)
    .eq("business_id", businessId.trim())
    .maybeSingle();

  if (membershipError) {
    console.error(
      "copilot-chat: membership lookup failed",
      membershipError.message
    );
    return json({ error: "MEMBERSHIP_CHECK_FAILED" }, 500);
  }

  if (!membership) {
    return json({ error: "NOT_A_MEMBER" }, 403);
  }

  const { data: activeData, error: activeError } = await admin.rpc(
    "is_business_subscription_active",
    { p_business_id: businessId.trim() }
  );

  if (activeError) {
    console.error(
      "copilot-chat: subscription check failed",
      activeError.message
    );
    return json({ error: "SUBSCRIPTION_CHECK_FAILED" }, 500);
  }

  if (!activeData) {
    return json({ error: "SUBSCRIPTION_EXPIRED" }, 403);
  }

  // Se valida después de autenticar para no revelar la configuración de los
  // proveedores a solicitudes anónimas.
  if (GEMINI_API_KEYS.length === 0 && !AI_FALLBACK_API_KEY) {
    console.error("copilot-chat: no AI provider secret configured");
    return json({ error: "AI_PROVIDERS_UNCONFIGURED" }, 503);
  }

  const systemText = system.trim();
  const conversation = messages as IncomingMessage[];
  const failures: string[] = [];

  // Construir los intentos Gemini en el orden ya utilizado por VIMDY:
  // primero todas las claves con el modelo principal; luego el secundario.
  const attempts: {
    key: string;
    model: string;
    label: string;
  }[] = [];

  GEMINI_API_KEYS.forEach((key, index) => {
    attempts.push({
      key,
      model: GEMINI_MODEL,
      label: `gemini-key-${index + 1}/${GEMINI_MODEL}`
    });
  });

  if (
    GEMINI_FALLBACK_MODEL &&
    GEMINI_FALLBACK_MODEL !== GEMINI_MODEL
  ) {
    GEMINI_API_KEYS.forEach((key, index) => {
      attempts.push({
        key,
        model: GEMINI_FALLBACK_MODEL,
        label: `gemini-key-${index + 1}/${GEMINI_FALLBACK_MODEL}`
      });
    });
  }

  // NIVEL 1: Gemini principal, claves rotativas y modelo secundario.
  for (const attempt of attempts) {
    try {
      const reply = await callGemini(
        attempt.key,
        attempt.model,
        systemText,
        conversation
      );

      return json({
        reply,
        provider: "gemini",
        model: attempt.model,
        fallbackActivated: false
      });
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "UNKNOWN_PROVIDER_ERROR";

      failures.push(`${attempt.label}: ${reason}`);

      console.error(
        "copilot-chat: Gemini attempt failed",
        attempt.label,
        reason
      );
    }
  }

  // NIVEL 2: OpenAI o proveedor compatible configurado.
  if (AI_FALLBACK_API_KEY) {
    try {
      const reply = await callFallbackProvider(
        systemText,
        conversation
      );

      console.warn(
        "copilot-chat: fallback provider activated",
        AI_FALLBACK_PROVIDER,
        AI_FALLBACK_MODEL
      );

      return json({
        reply,
        provider: AI_FALLBACK_PROVIDER,
        model: AI_FALLBACK_MODEL,
        fallbackActivated: true
      });
    } catch (error) {
      const reason = error instanceof Error
        ? error.message
        : "UNKNOWN_PROVIDER_ERROR";

      failures.push(`${AI_FALLBACK_PROVIDER}: ${reason}`);

      console.error(
        "copilot-chat: fallback provider failed",
        AI_FALLBACK_PROVIDER,
        reason
      );
    }
  }

  console.error(
    "copilot-chat: all configured providers failed",
    failures.join(" | ")
  );

  return json(
    {
      error: "COPILOT_ALL_PROVIDERS_FAILED",
      providersAttempted: failures.length
    },
    502
  );
});