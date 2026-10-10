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
//   - El alta inicial se serializa por usuario en register_business_atomic;
//     los retries recuperan el negocio existente sin duplicar el bootstrap.
//   - El alta adicional exige una suscripción activa administrada por el usuario.
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
import { parseRegistrationPayload } from "./registrationPayload.ts";

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

const ALLOWED_BUSINESS_TYPES = new Set([
  "restaurante", "cafeteria", "pizzeria", "asadero", "bar", "panaderia",
  "heladeria", "food_truck", "comida_rapida", "negocio_bebidas",
  "pasteleria", "reposteria", "jugueria", "catering", "comedor", "cadena",
  "tienda", "hotel", "minimercado", "pequeno_supermercado",
  "negocio_productos", "negocio_servicios", "otro"
]);

function isBusinessTypeId(value: string): boolean {
  return ALLOWED_BUSINESS_TYPES.has(value);
}

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

    let rawPayload: unknown;
    try {
      rawPayload = await req.json();
    } catch {
      console.warn("[register-business] INVALID_JSON: could not parse request body");
      return json({ error: "INVALID_JSON" }, 400, corsHeaders);
    }

    const payloadResult = parseRegistrationPayload(rawPayload);
    if (!payloadResult.ok) {
      console.warn(`[register-business] ${payloadResult.error}`);
      return json({ error: payloadResult.error }, 400, corsHeaders);
    }

    const { businessName, ownerName, country } = payloadResult.payload;
    const businessType = payloadResult.payload.businessType ?? "restaurante";
    const registrationMode = payloadResult.payload.registrationMode ?? "initial";

    if (!businessName || !ownerName || !country) {
      console.warn("[register-business] MISSING_FIELDS:", { businessName: !!businessName, ownerName: !!ownerName, country: !!country });
      return json({ error: "Faltan campos: businessName, ownerName y country son obligatorios." }, 400, corsHeaders);
    }

    if (!isBusinessTypeId(businessType)) {
      console.warn(`[register-business] BUSINESS_TYPE_INVALID: ${businessType}`);
      return json({ error: "BUSINESS_TYPE_INVALID: el tipo de negocio no es válido." }, 400, corsHeaders);
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

    const { data: registration, error: registrationError } = await admin.rpc("register_business_atomic", {
      p_user_id: authUser.id,
      p_registration_mode: registrationMode,
      p_business_name: businessName,
      p_country: country,
      p_currency: countryDefaults.currency,
      p_language: countryDefaults.language,
      p_timezone: countryDefaults.timezone,
      p_tax_rate: countryDefaults.taxRate,
      p_business_type: businessType,
      p_enabled_modules: enabledModules,
      p_trial_ends_at: trialEndsAt.toISOString(),
      p_trial_used_at: now.toISOString()
    });

    if (registrationError || !registration?.ok || !registration.businessId || !registration.branchId) {
      const message = registrationError?.message ?? registration?.error ?? "Sin detalle.";
      console.error("[register-business] ATOMIC_REGISTRATION_FAILED:", message);
      const trialAlreadyUsed = message.includes("TRIAL_YA_USADO");
      const subscriptionRequired = message.includes("ADDITIONAL_BUSINESS_REQUIRES_ACTIVE_SUBSCRIPTION");
      const status = trialAlreadyUsed || subscriptionRequired
        ? 403
        : 500;
      const responseMessage = trialAlreadyUsed
        ? "TRIAL_YA_USADO: ya utilizaste tu prueba gratuita de 14 días. Puedes contratar un plan mensual o anual para continuar."
        : message;
      return json({ error: responseMessage }, status, corsHeaders);
    }

    if (!registration.idempotent) {
      try {
        const nowIso = new Date().toISOString();
        const { error: profileInsertError } = await admin.from("app_users").insert({
          id: authUser.id,
          business_id: registration.businessId,
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
    }

    console.log(`[register-business] Registration complete for user ${authUser.id}, business ${registration.businessId}`);
    return json(registration, 200, corsHeaders);
  } catch (error) {
    console.error("[register-business] FATAL_ERROR:", String(error));
    return json({ error: "INTERNAL_SERVER_ERROR", detail: String(error) }, 500, corsHeaders);
  }
});