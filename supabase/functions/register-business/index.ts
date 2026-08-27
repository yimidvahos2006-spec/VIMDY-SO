// ============================================================================
// register-business (Supabase Edge Function)
// ----------------------------------------------------------------------------
// MISIÓN 1 — Registro seguro. Paso 3 del flujo (ver authBusinessContext.ts):
// se llama DESPUÉS de que el usuario ya verificó su correo con el código
// OTP de 6 dígitos (authOtp.ts). Esta función es la única autorizada para
// crear una fila en `businesses` + su membresía ADMIN en `business_members`.
//
// CONTRATO:
//   El cliente llama a esta función con una sesión activa
//   (authBusinessContext.ts -> completeRegistration()). supabase-js adjunta
//   el Authorization: Bearer <token> automáticamente.
//
//   Body: { businessName, ownerName, country }
//   Respuesta: { ok: true, businessId }
//
// SEGURIDAD:
//   - El usuario se identifica siempre por el JWT (nunca por el body).
//   - Se rechaza con EMAIL_NOT_VERIFIED si email_confirmed_at es nulo —
//     sin esto, cualquiera podría crear negocios con un correo que nunca
//     confirmó, saltándose el OTP de authOtp.ts.
//   - Un mismo usuario no puede registrar un negocio dos veces (se
//     verifica que no exista ya una fila en business_members para su
//     user_id antes de crear nada).
//   - `country` se valida contra una lista cerrada; cualquier otro valor
//     se rechaza en vez de guardarse tal cual. Moneda/idioma/timezone/IVA
//     se calculan SIEMPRE en el servidor a partir de ese país — el cliente
//     nunca los manda directamente.
//   - `trial_ends_at` se calcula en el SERVIDOR (now + 30 días) — el
//     cliente jamás decide su propia fecha de vencimiento de prueba.
//
// CONFIGURACIÓN REQUERIDA: ninguna adicional (usa las mismas
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY que el resto de funciones).
//
// Despliegue:
//   supabase functions deploy register-business
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
  businessName?: string;
  ownerName?: string;
  country?: string;
}

// Espejo server-side de COUNTRIES en src/core/config/globalization.ts. Vive
// acá aparte (no se importa el archivo del cliente) porque las Edge
// Functions de Supabase corren en Deno, con su propio bundling.
interface CountryDefaults {
  currency: string;
  language: string;
  timezone: string;
  taxRate: number;
}

const COUNTRY_DEFAULTS: Record<string, CountryDefaults> = {
  CO: { currency: "COP", language: "es", timezone: "America/Bogota", taxRate: 19 },
  MX: { currency: "MXN", language: "es", timezone: "America/Mexico_City", taxRate: 16 },
  PE: { currency: "PEN", language: "es", timezone: "America/Lima", taxRate: 18 },
  CL: { currency: "CLP", language: "es", timezone: "America/Santiago", taxRate: 19 },
  AR: { currency: "ARS", language: "es", timezone: "America/Argentina/Buenos_Aires", taxRate: 21 },
  ES: { currency: "EUR", language: "es", timezone: "Europe/Madrid", taxRate: 21 },
  US: { currency: "USD", language: "en", timezone: "America/New_York", taxRate: 0 },
  EC: { currency: "USD", language: "es", timezone: "America/Guayaquil", taxRate: 15 },
  PA: { currency: "USD", language: "es", timezone: "America/Panama", taxRate: 7 },
  VE: { currency: "USD", language: "es", timezone: "America/Caracas", taxRate: 0 }
};

const TRIAL_PERIOD_DAYS = 30;

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

  // 1) Extraer y validar el JWT del usuario que llama. NUNCA confiamos en
  //    quién dice ser el body — el dueño del negocio nuevo es siempre el
  //    usuario dueño de este token.
  const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
  const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

  if (!accessToken) {
    return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401);
  }

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

  const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
  if (userError || !userData.user) {
    return json({ error: "SESSION_INVALID: tu sesión no es válida o expiró." }, 401);
  }

  const authUser = userData.user;

  // 2) Sin correo verificado (código OTP de authOtp.ts) no se crea ningún
  //    negocio, sin importar qué diga el body.
  if (!authUser.email_confirmed_at) {
    return json({ error: "EMAIL_NOT_VERIFIED: verifica tu correo antes de continuar." }, 403);
  }

  let payload: RequestPayload;
  try {
    payload = await req.json();
  } catch {
    return json({ error: "INVALID_JSON" }, 400);
  }

  const businessName = payload.businessName?.trim();
  const ownerName = payload.ownerName?.trim();
  const country = payload.country?.trim();

  if (!businessName || !ownerName || !country) {
    return json({ error: "Faltan campos: businessName, ownerName y country son obligatorios." }, 400);
  }

  const countryDefaults = COUNTRY_DEFAULTS[country];
  if (!countryDefaults) {
    return json({ error: "COUNTRY_INVALID: país no reconocido." }, 400);
  }

  const now = new Date();
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS);

  // 3) Protección definitiva por persona: un usuario SOLO puede tener UN
  //    trial de por vida, sin importar cuántos negocios cree, cuántas
  //    veces cambie de dispositivo, navegador, IP o sesión.
  const { data: hasUsedTrial, error: hasUsedTrialError } = await admin
    .rpc("has_user_used_trial", { p_user_id: authUser.id });

  if (hasUsedTrialError) {
    return json({ error: "TRIAL_CHECK_FAILED", detail: hasUsedTrialError.message }, 500);
  }

  if (hasUsedTrial) {
    return json({
      error: "TRIAL_YA_USADO: ya utilizaste tu prueba gratuita de 30 días. Puedes contratar un plan mensual o anual para continuar."
    }, 403);
  }

  // 4) Protección anti-trial-duplicado por negocio: no permitir crear un
  //    negocio nuevo si este usuario ya tiene uno en trial/suspendido.
  const { data: existingBusinesses, error: existingError } = await admin
    .from("business_members")
    .select("business_id, role")
    .eq("user_id", authUser.id);

  if (existingError) {
    return json({ error: "BUSINESS_LOOKUP_FAILED", detail: existingError.message }, 500);
  }

  if (existingBusinesses && existingBusinesses.length > 0) {
    const { data: existingBizData, error: existingBizError } = await admin
      .from("businesses")
      .select("id, plan, payment_status, subscription_status")
      .in("id", existingBusinesses.map((b: { business_id: string }) => b.business_id))
      .or("plan.eq.trial,plan.eq.suspended,payment_status.eq.none,payment_status.eq.pending");

    if (existingBizError) {
      return json({ error: "EXISTING_BUSINESS_LOOKUP_FAILED", detail: existingBizError.message }, 500);
    }

    if (existingBizData && existingBizData.length > 0) {
      return json({
        error: "TRIAL_DUPLICADO: ya tienes un negocio en periodo de prueba o suspendido. Activa un plan para ese negocio antes de crear uno nuevo."
      }, 403);
    }
  }

  try {
    const { data: business, error: businessInsertError } = await admin
      .from("businesses")
      .insert({
        name: businessName,
        plan: "trial",
        trial_ends_at: trialEndsAt.toISOString(),
        trial_used_at: now.toISOString(),
        country,
        currency: countryDefaults.currency,
        language: countryDefaults.language,
        timezone: countryDefaults.timezone,
        tax_rate: countryDefaults.taxRate
      })
      .select("id")
      .single();

    if (businessInsertError || !business) {
      return json(
        { error: "BUSINESS_INSERT_FAILED", detail: businessInsertError?.message ?? "Sin detalle." },
        500
      );
    }

    // 6) Crear la membresía ADMIN del dueño sobre su negocio recién creado.
    //    Si esto falla, se revierte el negocio para no dejar un registro
    //    huérfano sin ningún usuario que pueda administrarlo.
    const { error: memberInsertError } = await admin.from("business_members").insert({
      user_id: authUser.id,
      business_id: business.id,
      role: "ADMIN"
    });

    if (memberInsertError) {
      await admin.from("businesses").delete().eq("id", business.id);
      return json({ error: "MEMBER_INSERT_FAILED", detail: memberInsertError.message }, 500);
    }

    // 7) Perfil del dueño en app_users — mismo directorio de empleados que
    //    ya usa create-staff-user para cajero/mesero/cocina (ver ese
    //    archivo). Sin esto, el dueño existe en Supabase Auth y en
    //    business_members, pero NO en app_users: cualquier pantalla que
    //    lea el directorio de empleados (ej. BusinessAnalyzer -> "empleado
    //    que más vende" del Dashboard) no encuentra su nombre y cae al
    //    fallback "Empleado sin nombre registrado" cada vez que el dueño
    //    hace una venta él mismo. Se guarda con roleId "ADMIN", igual que
    //    business_members.role.
    const now = new Date().toISOString();
    const { error: profileInsertError } = await admin.from("app_users").insert({
      id: authUser.id,
      business_id: business.id,
      data: {
        id: authUser.id,
        name: ownerName,
        email: authUser.email ?? "",
        roleId: "ADMIN",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now
      }
    });

    if (profileInsertError) {
      await admin.from("business_members").delete().eq("user_id", authUser.id).eq("business_id", business.id);
      await admin.from("businesses").delete().eq("id", business.id);
      return json({ error: "OWNER_PROFILE_FAILED", detail: profileInsertError.message }, 500);
    }

    const { error: branchInsertError } = await admin.from("branches").insert({
      business_id: business.id,
      name: "Sucursal principal",
      is_main: true,
      active: true
    });

    if (branchInsertError) {
      await admin.from("app_users").delete().eq("id", authUser.id);
      await admin.from("business_members").delete().eq("user_id", authUser.id).eq("business_id", business.id);
      await admin.from("businesses").delete().eq("id", business.id);
      return json({ error: "BRANCH_INSERT_FAILED", detail: branchInsertError.message }, 500);
    }

    // 8) Registrar el uso del trial para esta persona (idempotente a nivel
    //    de BD por el unique constraint en user_id). Si esto falla, el
    //    negocio ya está creado pero el trial no quedó marcado — en ese
    //    caso se revierte todo para no dejar un trial "gratis" sin marcar.
    const { error: trialUsageError } = await admin.rpc("record_trial_usage", {
      p_user_id: authUser.id,
      p_business_id: business.id
    });

    if (trialUsageError) {
      await admin.from("branches").delete().eq("business_id", business.id);
      await admin.from("app_users").delete().eq("id", authUser.id);
      await admin.from("business_members").delete().eq("user_id", authUser.id).eq("business_id", business.id);
      await admin.from("businesses").delete().eq("id", business.id);
      return json({ error: "TRIAL_USAGE_RECORD_FAILED", detail: trialUsageError.message }, 500);
    }

    return json({ ok: true, businessId: business.id });
  } catch (error) {
    return json({ error: "REGISTER_BUSINESS_FAILED", detail: String(error) }, 500);
  }
});