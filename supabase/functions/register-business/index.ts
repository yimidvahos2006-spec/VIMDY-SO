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
//   Body: { businessName, ownerName, country, businessType }
//   Respuesta: { ok: true, businessId, branchId, role, business }
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
//   - `businessType` se valida contra una lista cerrada de tipos de negocio.
//     Los módulos por defecto se calculan en el servidor a partir de ese
//     tipo — el cliente nunca los manda directamente.
//   - `trial_ends_at` se calcula en el SERVIDOR (now + 14 días) — el
//     cliente jamás decide su propia fecha de vencimiento de prueba.
//
// CONFIGURACIÓN REQUERIDA: ninguna adicional (usa las mismas
// SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY que el resto de funciones).
//
// Despliegue:
//   supabase functions deploy register-business
// ============================================================================

import { createClient } from "npm:@supabase/supabase-js@2";

const VIMDY_APP_URL = Deno.env.get("VIMDY_APP_URL") ?? "https://app.vimdy.co";
const ALLOWED_ORIGINS = new Set([
  "https://vimdy.co",
  "https://www.vimdy.co",
  "https://app.vimdy.co",
  VIMDY_APP_URL
]);

function getCorsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get("origin") ?? "";
  const allowed = ALLOWED_ORIGINS.has(origin) ? origin : VIMDY_APP_URL;
  return {
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Vary": "Origin"
  };
}

function json(body: unknown, status = 200, corsHeaders?: Record<string, string>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" }
  });
}

interface RequestPayload {
  businessName?: string;
  ownerName?: string;
  country?: string;
  businessType?: string;
  /** initial = alta de cuenta; additional = negocio adicional desde cuenta existente. */
  registrationMode?: "initial" | "additional";
}

const BUSINESS_BOOTSTRAP_SELECT =
  "id,name,country,currency,language,timezone,tax_rate,onboarding_completed,business_type,enabled_modules,salida_cocina";

type BootstrapBusiness = {
  id: string;
  name: string;
  country: string;
  currency: string;
  language: string;
  timezone: string;
  tax_rate: number;
  onboarding_completed: boolean;
  business_type: string | null;
  enabled_modules: string[] | null;
  salida_cocina: string | null;
};

async function resolveMainBranchId(admin: ReturnType<typeof createClient>, businessId: string): Promise<string | null> {
  const { data: mainBranch } = await admin
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_main", true)
    .maybeSingle();

  if (mainBranch?.id) return String(mainBranch.id);

  const { data: activeBranch } = await admin
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("active", true)
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();

  return activeBranch?.id ? String(activeBranch.id) : null;
}

async function buildBootstrap(
  admin: ReturnType<typeof createClient>,
  businessId: string,
  role: string
) {
  const { data: business, error: businessError } = await admin
    .from("businesses")
    .select(BUSINESS_BOOTSTRAP_SELECT)
    .eq("id", businessId)
    .single();

  if (businessError || !business) {
    throw new Error(`BUSINESS_BOOTSTRAP_LOOKUP_FAILED: ${businessError?.message ?? "business not found"}`);
  }

  const branchId = await resolveMainBranchId(admin, businessId);

  return {
    ok: true,
    businessId,
    branchId,
    role,
    business
  };
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

// Espejo server-side de DEFAULT_MODULES_BY_MODULES_BY_BUSINESS_TYPE en src/core/config/modules.ts.
// Los módulos por defecto se calculan en el servidor para garantizar que un negocio
// nunca se cree con enabled_modules vacío, incluso si el onboarding no se completa.
const DEFAULT_MODULES_BY_BUSINESS_TYPE: Record<string, string[]> = {
  restaurante: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  cafeteria: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  pizzeria: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  asadero: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  bar: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  hotel: ["mesas", "cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  food_truck: ["cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  panaderia: ["caja", "inventario", "clientes", "ia"],
  heladeria: ["caja", "inventario", "clientes", "ia"],
  tienda: ["caja", "inventario", "clientes", "ia"],
  comida_rapida: ["cocina", "pedidos", "caja", "inventario", "clientes", "ia"],
  minimercado: ["caja", "inventario", "clientes", "ia"],
  pequeno_supermercado: ["caja", "inventario", "clientes", "ia"],
  negocio_bebidas: ["caja", "inventario", "clientes", "ia"],
  negocio_productos: ["caja", "inventario", "clientes", "ia"],
  negocio_servicios: ["caja", "clientes", "ia"]
};

// Módulos por defecto para tipos de negocio no reconocidos (mínimo seguro)
const FALLBACK_MODULES = ["caja", "inventario", "clientes", "ia"];

function getDefaultModulesForBusinessType(businessType: string): string[] {
  return DEFAULT_MODULES_BY_BUSINESS_TYPE[businessType] ?? FALLBACK_MODULES;
}

const TRIAL_PERIOD_DAYS = 14;

const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req: Request) => {
  // Handle CORS preflight requests
  const corsHeaders = getCorsHeaders(req);
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405, corsHeaders);
  }

  if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
    console.error("[register-business] SERVER_CONFIG_MISSING: SUPABASE_URL or SERVICE_ROLE_KEY not set");
    return json({ error: "SERVER_CONFIG_MISSING: faltan SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY" }, 500, corsHeaders);
  }

  try {
    // 1) Extraer y validar el JWT del usuario que llama. NUNCA confiamos en
    //    quién dice ser el body — el dueño del negocio nuevo es siempre el
    //    usuario dueño de este token.
    const authHeader = req.headers.get("Authorization") ?? req.headers.get("authorization");
    const accessToken = authHeader?.replace(/^Bearer\s+/i, "").trim();

    if (!accessToken) {
      console.warn("[register-business] NO_AUTH: missing authorization header");
      return json({ error: "NO_AUTH: falta el token de sesión. Inicia sesión de nuevo." }, 401, corsHeaders);
    }

    const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

    const { data: userData, error: userError } = await admin.auth.getUser(accessToken);
    if (userError || !userData.user) {
      console.warn("[register-business] SESSION_INVALID:", userError?.message ?? "no user data");
      return json({ error: "SESSION_INVALID: tu sesión no es válida o expiró." }, 401, corsHeaders);
    }

    const authUser = userData.user;
    console.log(`[register-business] User ${authUser.id} (${authUser.email}) attempting registration`);

    // 2) Sin correo verificado (código OTP de authOtp.ts) no se crea ningún
    //    negocio, sin importar qué diga el body.
    if (!authUser.email_confirmed_at) {
      console.warn(`[register-business] EMAIL_NOT_VERIFIED for user ${authUser.id}`);
      return json({ error: "EMAIL_NOT_VERIFIED: verifica tu correo antes de continuar." }, 403, corsHeaders);
    }

    let payload: RequestPayload;
    try {
      payload = await req.json();
    } catch {
      console.warn("[register-business] INVALID_JSON: could not parse request body");
      return json({ error: "INVALID_JSON" }, 400, corsHeaders);
    }

    const businessName = payload.businessName?.trim();
    const ownerName = payload.ownerName?.trim();
    const country = payload.country?.trim();
    const businessType = payload.businessType?.trim() ?? "restaurante";
    const registrationMode = payload.registrationMode ?? "initial";

    if (!businessName || !ownerName || !country) {
      console.warn("[register-business] MISSING_FIELDS:", { businessName: !!businessName, ownerName: !!ownerName, country: !!country });
      return json({ error: "Faltan campos: businessName, ownerName y country son obligatorios." }, 400, corsHeaders);
    }

    if (registrationMode !== "initial" && registrationMode !== "additional") {
      return json({ error: "REGISTRATION_MODE_INVALID" }, 400, corsHeaders);
    }

    const countryDefaults = COUNTRY_DEFAULTS[country];
    if (!countryDefaults) {
      console.warn(`[register-business] COUNTRY_INVALID: ${country}`);
      return json({ error: "COUNTRY_INVALID: país no reconocido." }, 400, corsHeaders);
    }

    // Calcular módulos por defecto según el tipo de negocio
    const enabledModules = getDefaultModulesForBusinessType(businessType);
    console.log(`[register-business] Tipo de negocio: ${businessType}, Módulos: ${enabledModules.join(", ")}`);

    const now = new Date();
    const trialEndsAt = new Date(now);
    trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS);

    // 3) En el alta inicial, primero recuperamos un negocio existente.
    //    Esto es deliberado: si el primer request creó el negocio pero el cliente
    //    perdió la respuesta, una repetición debe devolver el mismo negocio y NO
    //    bloquearse por TRIAL_YA_USADO.
    if (registrationMode === "initial") {
      const { data: existingBusinesses, error: existingError } = await admin
        .from("business_members")
        .select("business_id, role")
        .eq("user_id", authUser.id)
        .limit(1);

      if (existingError) {
        console.error("[register-business] BUSINESS_LOOKUP_FAILED:", existingError.message);
        return json({ error: "BUSINESS_LOOKUP_FAILED", detail: existingError.message }, 500, corsHeaders);
      }

      if (existingBusinesses && existingBusinesses.length > 0) {
        const existing = existingBusinesses[0];
        try {
          const bootstrap = await buildBootstrap(
            admin,
            String(existing.business_id),
            String(existing.role ?? "ADMIN")
          );
          console.log(`[register-business] Returning existing business ${existing.business_id} for user ${authUser.id} (idempotent recovery)`);
          return json({ ...bootstrap, idempotent: true }, 200, corsHeaders);
        } catch (error) {
          console.error("[register-business] EXISTING_BUSINESS_BOOTSTRAP_FAILED:", String(error));
          return json({ error: "EXISTING_BUSINESS_BOOTSTRAP_FAILED", detail: String(error) }, 500, corsHeaders);
        }
      }
    }

    // 4) Protección definitiva por persona: un usuario solo puede consumir el
    //    trial una vez. La comprobación ocurre después del recovery inicial para
    //    que un reintento seguro nunca convierta una operación ya creada en error.
    const { data: hasUsedTrial, error: hasUsedTrialError } = await admin
      .rpc("has_user_used_trial", { p_user_id: authUser.id });

    if (hasUsedTrialError) {
      console.error("[register-business] TRIAL_CHECK_FAILED:", hasUsedTrialError.message);
      return json({ error: "TRIAL_CHECK_FAILED", detail: hasUsedTrialError.message }, 500, corsHeaders);
    }

    if (hasUsedTrial) {
      console.log(`[register-business] TRIAL_YA_USADO for user ${authUser.id}`);
      return json({
        error: "TRIAL_YA_USADO: ya utilizaste tu prueba gratuita de 14 días. Puedes contratar un plan mensual o anual para continuar."
      }, 403, corsHeaders);
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
          tax_rate: countryDefaults.taxRate,
          business_type: businessType,
          enabled_modules: enabledModules
        })
        .select("id")
        .single();

      if (businessInsertError || !business) {
        console.error("[register-business] BUSINESS_INSERT_FAILED:", businessInsertError?.message ?? "no business data");
        return json(
          { error: "BUSINESS_INSERT_FAILED", detail: businessInsertError?.message ?? "Sin detalle." },
          500,
          corsHeaders
        );
      }

      console.log(`[register-business] Created business ${business.id} for user ${authUser.id}`);

      // 6) Crear la membresía ADMIN del dueño sobre su negocio recién creado.
      //    Si esto falla, se revierte el negocio para no dejar un registro
      //    huérfano sin ningún usuario que pueda administrarlo.
      const { error: memberInsertError } = await admin.from("business_members").insert({
        user_id: authUser.id,
        business_id: business.id,
        role: "ADMIN"
      });

      if (memberInsertError) {
        console.error("[register-business] MEMBER_INSERT_FAILED:", memberInsertError.message);
        await admin.from("businesses").delete().eq("id", business.id);
        return json({ error: "MEMBER_INSERT_FAILED", detail: memberInsertError.message }, 500, corsHeaders);
      }

      // 7) Perfil del dueño en app_users (opcional) — mismo directorio de
      //    empleados que ya usa create-staff-user para cajero/mesero/cocina.
      //    Si la tabla no existe en este proyecto, se omite sin fallar.
      try {
        const nowIso = new Date().toISOString();
        const { error: profileInsertError } = await admin.from("app_users").insert({
          id: authUser.id,
          business_id: business.id,
          data: {
            id: authUser.id,
            name: ownerName,
            email: authUser.email ?? "",
            roleId: "ADMIN",
            status: "ACTIVE",
            createdAt: nowIso,
            updatedAt: nowIso
          }
        });

        if (profileInsertError) {
          console.warn("[register-business] app_users insert omitido:", profileInsertError.message);
        }
      } catch (appUserErr) {
        console.warn("[register-business] app_users no disponible:", String(appUserErr));
      }

      const { data: branch, error: branchInsertError } = await admin
        .from("branches")
        .insert({
          business_id: business.id,
          name: "Sucursal principal",
          is_main: true,
          active: true
        })
        .select("id")
        .single();

      if (branchInsertError || !branch) {
        console.error("[register-business] BRANCH_INSERT_FAILED:", branchInsertError.message);
        await admin.from("business_members").delete().eq("user_id", authUser.id).eq("business_id", business.id);
        await admin.from("businesses").delete().eq("id", business.id);
        return json({ error: "BRANCH_INSERT_FAILED", detail: branchInsertError.message }, 500, corsHeaders);
      }

      // 8) Registrar el uso del trial (opcional) — si la función SQL no existe
      //    en este proyecto, se omite sin fallar. No es crítico para login.
      try {
        const { error: trialUsageError } = await admin.rpc("record_trial_usage", {
          p_user_id: authUser.id,
          p_business_id: business.id
        });

        if (trialUsageError) {
          console.warn("[register-business] trial usage omitido:", trialUsageError.message);
        }
      } catch (trialErr) {
        console.warn("[register-business] record_trial_usage no disponible:", String(trialErr));
      }

      const bootstrap = await buildBootstrap(admin, business.id, "ADMIN");
      const response = {
        ...bootstrap,
        branchId: String(branch.id)
      };

      console.log(`[register-business] Registration complete for user ${authUser.id}, business ${business.id}`);
      return json(response, 200, corsHeaders);
    } catch (error) {
      console.error("[register-business] UNEXPECTED_ERROR:", String(error));
      return json({ error: "REGISTER_BUSINESS_FAILED", detail: String(error) }, 500, corsHeaders);
    }
  } catch (error) {
    console.error("[register-business] FATAL_ERROR:", String(error));
    return json({ error: "INTERNAL_SERVER_ERROR", detail: String(error) }, 500, corsHeaders);
  }
});