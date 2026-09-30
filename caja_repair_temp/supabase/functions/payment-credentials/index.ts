// ============================================================================
// payment-credentials (Supabase Edge Function)
// ---------------------------------------------------------------------------
// Maneja cifrado/descifrado de credenciales de pago en el servidor.
// El secreto de cifrado vive en Supabase secrets (PAYMENT_CREDENTIALS_SECRET),
// nunca en el cliente.
//
// Rutas:
//   POST /save  - guarda credenciales cifradas
//   POST /get   - obtiene credenciales descifradas (solo dueño)
//   POST /test  - prueba si las credenciales son válidas
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL") ?? "*";
const PAYMENT_CREDENTIALS_SECRET = Deno.env.get("PAYMENT_CREDENTIALS_SECRET");

const corsHeaders = {
  "Access-Control-Allow-Origin": VIMDY_APP_URL,
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

async function getAuthUser(req: Request): Promise<{ id: string } | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return null;
  }

  const token = authHeader.slice(7);
  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: `Bearer ${token}` } } }
  );

  const { data: { user }, error: authError } = await supabase.auth.getUser(token);
  if (authError || !user) {
    return null;
  }

  return { id: user.id };
}

async function encrypt(text: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(key.padEnd(32).slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    encoder.encode(text)
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return btoa(String.fromCharCode(...combined));
}

async function decrypt(encryptedBase64: string, key: string): Promise<string> {
  const decoder = new TextDecoder();
  const keyData = new TextEncoder().encode(key.padEnd(32).slice(0, 32));
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  const combined = Uint8Array.from(atob(encryptedBase64), (c) => c.charCodeAt(0));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv },
    cryptoKey,
    data
  );
  return decoder.decode(decrypted);
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (!PAYMENT_CREDENTIALS_SECRET) {
    return json({ error: "SERVER_CONFIG_MISSING" }, 500);
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const businessId = body.businessId as string | undefined;
  if (!businessId) {
    return json({ error: "MISSING_BUSINESS_ID" }, 400);
  }

  const user = await getAuthUser(req);
  if (!user) {
    return json({ error: "UNAUTHORIZED" }, 401);
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? ""
  );

  const { data: member, error: memberError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", user.id)
    .eq("role", "ADMIN")
    .eq("business_id", businessId)
    .maybeSingle();

  if (memberError || !member) {
    return json({ error: "FORBIDDEN" }, 403);
  }

  try {
    const url = new URL(req.url);
    const path = url.pathname.split("/").filter(Boolean).pop();

    if (path === "save" || path === "get" || path === "test") {
      const { provider, ...rest } = body;

      if (path === "save") {
        const { publicKey, privateKey, integritySecret, eventsSecret } = rest;

        const encryptedPublicKey = await encrypt(publicKey, PAYMENT_CREDENTIALS_SECRET);
        const encryptedPrivateKey = await encrypt(privateKey, PAYMENT_CREDENTIALS_SECRET);
        const encryptedIntegritySecret = await encrypt(integritySecret, PAYMENT_CREDENTIALS_SECRET);
        const encryptedEventsSecret = await encrypt(eventsSecret, PAYMENT_CREDENTIALS_SECRET);

        const { data, error } = await supabase
          .from("business_payment_credentials")
          .upsert({
            business_id: businessId,
            provider: provider ?? "wompi",
            public_key_encrypted: encryptedPublicKey,
            private_key_encrypted: encryptedPrivateKey,
            integrity_secret_encrypted: encryptedIntegritySecret,
            events_secret_encrypted: encryptedEventsSecret,
            is_active: true,
            updated_at: new Date().toISOString()
          }, {
            onConflict: "business_id,provider"
          })
          .select("id")
          .single();

        if (error) {
          return json({ error: "SAVE_FAILED", detail: error.message }, 500);
        }

        return json({ ok: true, id: data.id });
      }

      if (path === "get") {
        const { data, error } = await supabase
          .from("business_payment_credentials")
          .select("public_key_encrypted, private_key_encrypted, integrity_secret_encrypted, events_secret_encrypted")
          .eq("business_id", businessId)
          .eq("provider", provider ?? "wompi")
          .eq("is_active", true)
          .maybeSingle();

        if (error || !data) {
          return json({ error: "NOT_FOUND" }, 404);
        }

        const publicKey = await decrypt(data.public_key_encrypted, PAYMENT_CREDENTIALS_SECRET);
        const privateKey = await decrypt(data.private_key_encrypted, PAYMENT_CREDENTIALS_SECRET);
        const integritySecret = await decrypt(data.integrity_secret_encrypted, PAYMENT_CREDENTIALS_SECRET);
        const eventsSecret = await decrypt(data.events_secret_encrypted, PAYMENT_CREDENTIALS_SECRET);

        return json({
          ok: true,
          credentials: {
            provider: provider ?? "wompi",
            publicKey,
            privateKey,
            integritySecret,
            eventsSecret
          }
        });
      }

      if (path === "test") {
        const { data, error } = await supabase
          .from("business_payment_credentials")
          .select("public_key_encrypted")
          .eq("business_id", businessId)
          .eq("provider", provider ?? "wompi")
          .eq("is_active", true)
          .maybeSingle();

        if (error || !data) {
          return json({ success: false, error_message: "No hay credenciales guardadas." });
        }

        try {
          await decrypt(data.public_key_encrypted, PAYMENT_CREDENTIALS_SECRET);
          return json({ success: true, error_message: null });
        } catch {
          return json({ success: false, error_message: "Credenciales corruptas." });
        }
      }
    }

    return json({ error: "Not found" }, 404);
  } catch (error) {
    return json({ error: "INTERNAL_ERROR", detail: String(error) }, 500);
  }
});
