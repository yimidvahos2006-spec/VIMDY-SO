// ============================================================================
// test-diagnose-branches (Supabase Edge Function - TEMPORAL, SOLO LECTURA)
// ----------------------------------------------------------------------------
// Diagnóstico de permisos y estado del entorno TEST.
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

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

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

  try {
    const { data: testBusinesses } = await admin
      .from("businesses")
      .select("id,name,country,created_at")
      .ilike("name", "%TEST%")
      .order("created_at", { ascending: false });

    const businessIds = (testBusinesses ?? []).map((b: any) => b.id);

    const [testMembers, testProfiles, testBranches] = await Promise.all([
      admin.from("business_members").select("user_id,business_id,role").in("business_id", businessIds).then(r => r.data ?? []),
      admin.from("app_users").select("id,business_id,data").in("business_id", businessIds).then(r => r.data ?? []),
      admin.from("branches").select("id,business_id,name,is_main,active").in("business_id", businessIds).then(r => r.data ?? [])
    ]);

    return json({
      ok: true,
      testBusinesses,
      testMembers,
      testProfiles,
      testBranches
    });
  } catch (err) {
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
