import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, x-hub-signature-256" };
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const VERIFY_TOKEN = Deno.env.get("WHATSAPP_WEBHOOK_VERIFY_TOKEN");
const APP_SECRET = Deno.env.get("WHATSAPP_APP_SECRET");
if (!SUPABASE_URL || !SERVICE_ROLE_KEY) throw new Error("SERVER_CONFIG_MISSING");
const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
function response(body: unknown, status = 200) { return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } }); }
async function verifySignature(raw: string, signature: string | null): Promise<boolean> {
  if (!APP_SECRET || !signature?.startsWith("sha256=")) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(APP_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(raw));
  const expected = `sha256=${Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("")}`;
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

async function createEmailFallback(jobId: string, businessId: string): Promise<void> {
  const { data: settings } = await admin.from("daily_report_settings").select("email_enabled,email_recipients,email_fallback_enabled").eq("business_id", businessId).maybeSingle();
  const cfg = { email_enabled: true, email_recipients: [] as string[], email_fallback_enabled: true, ...(settings ?? {}) };
  if (!cfg.email_enabled || !cfg.email_fallback_enabled) return;
  let emails = cfg.email_recipients ?? [];
  if (!emails.length) {
    const { data: members } = await admin.from("business_members").select("user_id").eq("business_id", businessId).in("role", ["ADMIN", "GERENTE"]);
    const resolved = new Set<string>();
    for (const member of members ?? []) {
      const user = await admin.auth.admin.getUserById(String(member.user_id));
      const email = user.data.user?.email?.trim().toLowerCase();
      if (email) resolved.add(email);
    }
    emails = [...resolved];
  }
  for (const raw of emails) {
    const recipient = raw.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) continue;
    await admin.from("daily_report_deliveries").upsert({ job_id: jobId, business_id: businessId, channel: "EMAIL", recipient, status: "PENDING", next_attempt_at: new Date().toISOString() }, { onConflict: "job_id,channel,recipient" });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method === "GET") {
    const url = new URL(req.url);
    if (url.searchParams.get("hub.verify_token") !== VERIFY_TOKEN) return response({ error: "VERIFY_FAILED" }, 403);
    return new Response(url.searchParams.get("hub.challenge") ?? "", { status: 200, headers: { "Content-Type": "text/plain" } });
  }
  const raw = await req.text();
  if (!(await verifySignature(raw, req.headers.get("x-hub-signature-256")))) return response({ error: "INVALID_SIGNATURE" }, 401);
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { return response({ error: "INVALID_JSON" }, 400); }
  const entries = Array.isArray((payload as Record<string, unknown>)?.entry) ? (payload as Record<string, unknown>).entry as Record<string, unknown>[] : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry.changes) ? entry.changes as Record<string, unknown>[] : [];
    for (const change of changes) {
      const value = change.value as Record<string, unknown> | undefined;
      const statuses = Array.isArray(value?.statuses) ? value.statuses as Record<string, unknown>[] : [];
      for (const item of statuses) {
        const providerId = String(item.id ?? "");
        const rawStatus = String(item.status ?? "").toLowerCase();
        if (!providerId) continue;
        const mapped = rawStatus === "sent" ? "SENT" : rawStatus === "delivered" ? "DELIVERED" : rawStatus === "read" ? "READ" : rawStatus === "failed" ? "FAILED" : null;
        if (!mapped) continue;
        const errorText = Array.isArray(item.errors) ? JSON.stringify(item.errors) : null;
        const patch: Record<string, unknown> = { status: mapped, updated_at: new Date().toISOString() };
        if (mapped === "SENT") patch.sent_at = new Date().toISOString();
        if (mapped === "DELIVERED") patch.delivered_at = new Date().toISOString();
        if (mapped === "READ") patch.read_at = new Date().toISOString();
        if (mapped === "FAILED") patch.last_error = errorText;
        const { data: matchedDelivery } = await admin
          .from("daily_report_deliveries")
          .select("id,job_id,business_id,channel")
          .eq("provider_message_id", providerId)
          .maybeSingle();
        if (matchedDelivery?.id) await admin.from("daily_report_deliveries").update(patch).eq("id", matchedDelivery.id);
        if (mapped === "FAILED" && matchedDelivery?.channel === "WHATSAPP" && matchedDelivery.job_id) {
          await createEmailFallback(String(matchedDelivery.job_id), String(matchedDelivery.business_id));
          await admin.from("daily_report_jobs").update({ status: "PARTIAL", next_attempt_at: new Date().toISOString(), updated_at: new Date().toISOString(), last_error: errorText ?? "WhatsApp delivery failed." }).eq("id", matchedDelivery.job_id);
        }
      }
    }
  }
  return response({ ok: true });
});
