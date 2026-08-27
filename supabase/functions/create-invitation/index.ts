// ============================================================================
// create-invitation (Supabase Edge Function)
// ----------------------------------------------------------------------------
// Crea una invitación para que un usuario se una a un negocio.
// Solo ADMIN puede crear invitaciones.
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL");
const corsHeaders = {
  "Access-Control-Allow-Origin": VIMDY_APP_URL ?? "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface RequestPayload {
  email?: string;
  roleId?: string;
}

const VALID_ROLES = new Set(["ADMIN", "CAJERO", "MESERO", "COCINA"]);
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

function generateSecureToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
}

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

  const { data: callerData, error: callerError } = await admin.auth.getUser(accessToken);
  if (callerError || !callerData.user) {
    return json({ error: "SESSION_INVALID" }, 401);
  }

  const { data: callerMembership, error: membershipError } = await admin
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  if (membershipError || !callerMembership) {
    return json({ error: "NO_BUSINESS" }, 403);
  }

  if (callerMembership.role !== "ADMIN") {
    return json({ error: "FORBIDDEN: solo un administrador puede crear invitaciones." }, 403);
  }

  const businessId = callerMembership.business_id;

  const { data: activeData, error: activeError } = await admin.rpc("is_business_subscription_active", {
    p_business_id: businessId
  });

  if (activeError || !activeData) {
    return json({ error: "SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido. Selecciona un plan para continuar." }, 403);
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const email = payload.email?.trim().toLowerCase();
  const roleId = payload.roleId?.trim().toUpperCase();

  if (!email || !roleId) {
    return json({ error: "Faltan campos: email y roleId son obligatorios." }, 400);
  }
  if (!VALID_ROLES.has(roleId)) {
    return json({ error: `ROLE_INVALID: el rol "${roleId}" no es válido.` }, 400);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const token = generateSecureToken();

  const { error: inviteError } = await admin
    .from("business_invitations")
    .insert({
      business_id: callerMembership.business_id,
      user_id: callerData.user.id,
      email,
      role: roleId,
      token,
      invited_by: callerData.user.id,
      expires_at: expiresAt.toISOString()
    });

  if (inviteError) {
    return json({ error: `INVITATION_FAILED: ${inviteError.message}` }, 500);
  }

  return json({
    ok: true,
    invitation: {
      businessId: callerMembership.business_id,
      email,
      role: roleId,
      token,
      expiresAt: expiresAt.toISOString()
    }
  });
});
