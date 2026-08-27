// ============================================================================
// create-staff-user (Supabase Edge Function)
// ----------------------------------------------------------------------------
// CRÍTICO #1 del checklist de lanzamiento — "Mover el login de personal a
// una Edge Function". La forma más sólida de resolverlo no es agregar un
// endpoint de verificación aparte: es dejar de tener una tabla paralela de
// contraseñas (`app_users.data.passwordHash`, hasheada y verificada en el
// navegador) y hacer que cajero/mesero/cocina sean usuarios REALES de
// Supabase Auth, exactamente como el dueño — con `business_members.role`
// diciendo qué rol tienen (columna que YA existía en schema.sql, lista para
// esto: 'ADMIN' | 'CAJERO' | 'MESERO' | 'COCINA').
//
// Con esto:
//   - El login de personal deja de ser código propio: es
//     supabase.auth.signInWithPassword(), la MISMA función ya usada por el
//     dueño (ver authBusinessContext.ts -> signIn()), que ya resuelve el
//     negocio y el rol de forma genérica (resolveBusinessSession()).
//   - Ningún passwordHash vuelve a viajar al navegador ni se guarda en
//     `app_users` — Supabase Auth es quien lo guarda, ya hasheado con
//     bcrypt, y nunca lo expone.
//   - Esta función es la ÚNICA autorizada a crear cuentas de personal:
//     solo un ADMIN del negocio puede llamarla.
//
// CONTRATO:
//   Body: { name, email, password, roleId }  (roleId: ADMIN|CAJERO|MESERO|COCINA)
//   Respuesta: { ok: true, user: { id, name, email, roleId, status } }
//
// SEGURIDAD:
//   - El negocio del que se crea el empleado se resuelve SIEMPRE del JWT del
//     que llama (business_members), nunca de un businessId en el body.
//   - Solo un ADMIN del negocio puede crear empleados.
//   - Si algo falla después de crear el usuario en Auth (ej. el insert en
//     business_members), se revierte borrando ese usuario para no dejar
//     cuentas huérfanas sin negocio.
//
// Despliegue:
//   supabase functions deploy create-staff-user
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

const VALID_ROLES = new Set(["ADMIN", "CAJERO", "MESERO", "COCINA"]);

interface RequestPayload {
  name?: string;
  email?: string;
  password?: string;
  roleId?: string;
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
    return json({ error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500);
  }

  // 1) Identificar quién llama, siempre por el JWT — nunca por el body.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: callerData, error: callerError } = await admin.auth.getUser(accessToken);
  if (callerError || !callerData.user) {
    return json({ error: "SESSION_INVALID: tu sesión no es válida o expiró." }, 401);
  }

  // 2) Resolver el negocio y el rol de quien llama a partir de
  //    business_members — no del body. Solo un ADMIN puede crear personal.
  const { data: callerMembership, error: membershipError } = await admin
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", callerData.user.id)
    .maybeSingle();

  if (membershipError || !callerMembership) {
    return json({ error: "NO_BUSINESS: tu usuario no pertenece a ningún negocio." }, 403);
  }

  if (callerMembership.role !== "ADMIN") {
    return json({ error: "FORBIDDEN: solo un administrador puede crear empleados." }, 403);
  }

  const businessId = callerMembership.business_id as string;

  // 3) Verificar que la suscripción del negocio está activa.
  const { data: activeData, error: activeError } = await admin.rpc("is_business_subscription_active", {
    p_business_id: businessId
  });

  if (activeError || !activeData) {
    return json({ error: "SUBSCRIPTION_EXPIRED: la suscripción del negocio ha vencido. Selecciona un plan para continuar." }, 403);
  }

  // 4) Validar el body.
  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const name = payload.name?.trim();
  const email = payload.email?.trim().toLowerCase();
  const password = payload.password ?? "";
  const roleId = payload.roleId?.trim().toUpperCase();

  if (!name || !email || !roleId) {
    return json({ error: "Faltan campos: name, email y roleId son obligatorios." }, 400);
  }
  if (password.length < 6) {
    return json({ error: "WEAK_PASSWORD: la contraseña debe tener al menos 6 caracteres." }, 400);
  }
  if (!roleId || !VALID_ROLES.has(roleId)) {
    return json({ error: `ROLE_INVALID: el rol "${roleId}" no es válido.` }, 400);
  }

  try {
    // 4) Crear el usuario real en Supabase Auth. El password nunca vuelve
    //    a salir de aquí — Supabase lo guarda ya hasheado (bcrypt).
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: name }
    });

    if (createError || !created.user) {
      const message = createError?.message ?? "";
      if (message.toLowerCase().includes("already") || message.toLowerCase().includes("registered")) {
        return json({ error: `EMAIL_ALREADY_IN_USE: ya existe una cuenta con el correo "${email}".` }, 409);
      }
      return json({ error: `AUTH_CREATE_FAILED: ${message || "no se pudo crear el usuario."}` }, 500);
    }

    const newUserId = created.user.id;

    // 5) Atarlo al negocio con su rol. Si esto falla, no debe quedar un
    //    usuario de Auth huérfano sin negocio — se revierte.
    const { error: memberError } = await admin
      .from("business_members")
      .insert({ user_id: newUserId, business_id: businessId, role: roleId });

    if (memberError) {
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return json({ error: `MEMBERSHIP_FAILED: ${memberError.message}` }, 500);
    }

    // 6) Perfil del empleado (nombre, avatar, preferencias) — nunca una
    //    contraseña. Mismo shape que ya consume la UI (Entities.User),
    //    menos passwordHash/failedLoginAttempts/lockedUntil, que ya no
    //    existen: eso ahora lo maneja Supabase Auth.
    const now = new Date().toISOString();
    const { error: profileError } = await admin.from("app_users").insert({
      id: newUserId,
      business_id: businessId,
      data: {
        id: newUserId,
        name,
        email,
        roleId,
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now
      }
    });

    if (profileError) {
      await admin.from("business_members").delete().eq("user_id", newUserId).eq("business_id", businessId);
      await admin.auth.admin.deleteUser(newUserId).catch(() => {});
      return json({ error: `PROFILE_FAILED: ${profileError.message}` }, 500);
    }

    return json({
      ok: true,
      user: { id: newUserId, name, email, roleId, status: "ACTIVE" }
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Error inesperado.";
    return json({ error: `UNEXPECTED: ${message}` }, 500);
  }
});