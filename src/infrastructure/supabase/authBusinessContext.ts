import { supabase, setCurrentBusinessId, setCurrentBranchId } from "./supabaseClient";
import type { BusinessTypeId } from "../../core/config/businessTypes";
import type { ModuleId } from "../../core/config/modules";
import type { KitchenOutputMode } from "../../core/services/kitchenOutput";
import { getCountryDefaults } from "../../core/config/globalization";

/* ===========================================================================
   authBusinessContext
   ---------------------------------------------------------------------------
   MISIÓN 1 — Registro Seguro. El registro de un negocio nuevo ya NO es un
   solo paso: ahora exige verificar el correo con un código OTP de 6 dígitos
   ANTES de crear el negocio (ver register-business/index.ts, que ahora
   rechaza la creación si email_confirmed_at es nulo). El flujo completo:

     1. beginRegistration(input)   -> supabase.auth.signUp(). Deja el usuario
        creado pero SIN CONFIRMAR. Guarda businessName/ownerName/country en
        sessionStorage (pendingRegistration) para no pedirlos de nuevo en
        la pantalla de OTP.
     2. verifyRegistrationOtp(...) -> vive en authOtp.ts (siguiente archivo
        de esta misión). Confirma el código y deja la sesión activa y
        confirmada.
     3. completeRegistration()    -> lee pendingRegistration, llama a la
        Edge Function register-business (ya con sesión confirmada) y
        resuelve el negocio recién creado.

   Para el login normal (usuario ya existente) nada cambia: signIn() sigue
   validando password y resolviendo el negocio en un solo paso.
=========================================================================== */

export interface RegisterBusinessInput {
  businessName: string;
  ownerName: string;
  email: string;
  password: string;
  /** Código de país ISO de 2 letras (ej. "CO", "MX", "US"). Ver src/core/config/globalization.ts. */
  country: string;
}

export interface BusinessSession {
  userId: string;
  businessId: string;
  businessName: string;
  ownerName: string;
  role: string;
  /** Configuración inteligente calculada al registrar el negocio a partir del país (ver register-business). */
  country: string;
  currency: string;
  language: string;
  timezone: string;
  taxRate: number;
  /** Fase 3 — Onboarding inteligente: false hasta que el negocio termina el asistente en /onboarding. */
  onboardingCompleted: boolean;
  /** PASO 3 del onboarding. Null si el negocio todavía no ha pasado por ese paso. */
  businessType: BusinessTypeId | null;
  /** PASO 4 del onboarding. Vacío si el negocio todavía no ha pasado por ese paso. */
  enabledModules: ModuleId[];
  /**
   * Qué usa este negocio para recibir comandas en Cocina: "pantalla" (el
   * KDS, ver KitchenScreenOutput) o "impresora" (tiquetera, ver
   * KitchenPrinterOutput — todavía no implementada). "pantalla" por
   * defecto: hoy todos los negocios de prueba usan pantalla.
   */
  salidaCocina: KitchenOutputMode;
}

/** Lo que necesita completeRegistration() para crear el negocio, una vez el OTP ya se verificó. */
interface PendingRegistration {
  businessName: string;
  ownerName: string;
  country: string;
  email: string;
}

const PENDING_REGISTRATION_KEY = "vimdy_pending_registration";

/**
 * Traduce los errores crudos de Supabase Auth (en inglés) que puede
 * devolver signIn()/beginRegistration()/requestPasswordReset()/
 * updatePassword() a mensajes claros en español. Mismo patrón que
 * translateOtpError() en authOtp.ts, para la pantalla de OTP — este cubre
 * el resto del flujo de cuenta (login, "crear cuenta", contraseña).
 */
function translateAuthError(rawMessage: string | undefined): string {
  const message = (rawMessage ?? "").toLowerCase();

  if (message.includes("invalid login credentials")) {
    return "Correo o contraseña incorrectos.";
  }
  if (message.includes("email not confirmed")) {
    return "Este correo todavía no ha sido verificado.";
  }
  if (message.includes("user already registered") || message.includes("already registered")) {
    return "Este correo ya tiene una cuenta. Si ya la verificaste, inicia sesión. Si no la recuerdas, usa '¿Olvidaste tu contraseña?'.";
  }
  if (message.includes("password should be at least") || message.includes("password should contain")) {
    return "La contraseña debe tener al menos 6 caracteres.";
  }
  if (message.includes("unable to validate email") || message.includes("invalid email")) {
    return "El correo no tiene un formato válido.";
  }
  if (message.includes("should be different from the old password")) {
    return "La nueva contraseña debe ser distinta a la anterior.";
  }
  if (message.includes("auth session missing") || message.includes("session")) {
    return "Tu sesión no es válida o expiró. Vuelve a intentarlo desde el enlace del correo.";
  }
  if (message.includes("rate limit") || message.includes("too many")) {
    return "Demasiados intentos. Espera un momento antes de volver a intentarlo.";
  }
  if (message.includes("signups not allowed") || message.includes("signup is disabled")) {
    return "El registro de cuentas nuevas no está disponible en este momento.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }

  return rawMessage || "Ocurrió un error inesperado. Inténtalo de nuevo.";
}

/* ---------------------------------------------------------------------------
   Helper interno: shape crudo de `businesses` tal como lo devuelve el join
   anidado de Supabase (que no tipa bien el objeto embebido, lo infiere como
   array). Se usa tanto en resolveBusinessSession() como en signIn().
--------------------------------------------------------------------------- */
interface BusinessRow {
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
}

const TRIAL_PERIOD_DAYS = 14;

function toBusinessSession(
  userId: string,
  businessId: string,
  role: string,
  ownerName: string,
  businessRow: BusinessRow | undefined
): BusinessSession {
  return {
    userId,
    businessId,
    businessName: businessRow?.name ?? "",
    ownerName,
    role,
    country: businessRow?.country ?? "CO",
    currency: businessRow?.currency ?? "COP",
    language: businessRow?.language ?? "es",
    timezone: businessRow?.timezone ?? "America/Bogota",
    taxRate: businessRow?.tax_rate ?? 19,
    onboardingCompleted: businessRow?.onboarding_completed ?? false,
    businessType: (businessRow?.business_type as BusinessTypeId | null) ?? null,
    enabledModules: (businessRow?.enabled_modules as ModuleId[] | null) ?? [],
    salidaCocina: (businessRow?.salida_cocina as KitchenOutputMode | null) ?? "pantalla"
  };
}

/**
 * Helper compartido: dado un userId ya autenticado en supabase.auth, resuelve
 * a qué negocio pertenece. Lo usan tanto signIn() como completeRegistration()
 * (y también AuthContext.tsx al restaurar una sesión guardada al recargar la
 * página — reemplaza la copia que tenía duplicada ahí mismo).
 *
 * Devuelve null en vez de lanzar cuando no hay membresía, para que quien
 * restaura una sesión pueda decidir qué hacer sin depender de un catch.
 */
export async function resolveBusinessSession(
  userId: string,
  ownerName: string
): Promise<BusinessSession | null> {
  const { data: membership, error } = await supabase
    .from("business_members")
    .select(
      "business_id, role, businesses(name, country, currency, language, timezone, tax_rate, onboarding_completed, business_type, enabled_modules, salida_cocina)"
    )
    .eq("user_id", userId)
    .limit(1)
    .maybeSingle();

  if (error || !membership) return null;

  const businessRow = membership.businesses as unknown as BusinessRow | undefined;

  // Auto-sanado: negocios registrados ANTES de este fix (register-business
  // ahora sí crea este perfil, ver ese archivo) se quedaron con el dueño
  // en Auth + business_members pero SIN fila en app_users. Eso hace que el
  // Dashboard no encuentre su nombre al vender (fallback "Empleado sin
  // nombre registrado"). Se detecta y repara acá, una sola vez, sin que el
  // dueño tenga que hacer nada — mismo patrón de detección de huérfanos ya
  // usado para la carrera de registro (RLS timing + grants faltantes).
  ensureOwnerProfile(userId, membership.business_id, ownerName);

  return toBusinessSession(userId, membership.business_id, membership.role, ownerName, businessRow);
}

/**
 * Crea la fila de app_users del dueño si todavía no existe (negocio
 * registrado antes de este fix). No bloquea el login si falla (ej. sin
 * red) — simplemente se reintenta en la próxima sesión.
 */
async function ensureOwnerProfile(userId: string, businessId: string, ownerName: string): Promise<void> {
  try {
    const { data: existing } = await supabase
      .from("app_users")
      .select("id")
      .eq("id", userId)
      .maybeSingle();

    if (existing) return;

    const now = new Date().toISOString();
    await supabase.from("app_users").insert({
      id: userId,
      business_id: businessId,
      data: {
        id: userId,
        name: ownerName,
        email: "",
        roleId: "ADMIN",
        status: "ACTIVE",
        createdAt: now,
        updatedAt: now
      }
    });
  } catch {
    // Sin red u otro fallo puntual: no rompe el login, se reintenta luego.
  }
}

function savePendingRegistration(pending: PendingRegistration): void {
  try {
    sessionStorage.setItem(PENDING_REGISTRATION_KEY, JSON.stringify(pending));
  } catch {
    // Sin sessionStorage disponible (modo privado extremo, etc.) el flujo
    // igual continúa: completeRegistration() simplemente fallará con un
    // mensaje claro pidiendo reiniciar el registro.
  }
}

/**
 * Lee los datos del registro en curso (businessName/ownerName/country/email)
 * guardados por beginRegistration(). La pantalla de OTP la usa para mostrar
 * "Enviamos un código a tal correo" sin tener que volver a pedirlo.
 */
export function getPendingRegistration(): PendingRegistration | null {
  try {
    const raw = sessionStorage.getItem(PENDING_REGISTRATION_KEY);
    return raw ? (JSON.parse(raw) as PendingRegistration) : null;
  } catch {
    return null;
  }
}

/** Cancela un registro en curso (botón "volver" en la pantalla de OTP, o tras completar el registro). */
export function clearPendingRegistration(): void {
  try {
    sessionStorage.removeItem(PENDING_REGISTRATION_KEY);
  } catch {
    // No hay nada que limpiar si sessionStorage no está disponible.
  }
}

/**
 * Paso 1 del registro seguro: crea el usuario en Supabase Auth (sin
 * confirmar todavía) y deja guardados los datos del negocio para el paso 3.
 * Dispara el correo con el código OTP de 6 dígitos (según la plantilla de
 * "Confirm signup" configurada en el panel de Supabase). NO crea el
 * negocio — eso solo ocurre en completeRegistration(), después de verificar
 * el código en authOtp.ts.
 */
export async function beginRegistration(input: RegisterBusinessInput): Promise<void> {
  const { data, error } = await supabase.auth.signUp({
    email: input.email,
    password: input.password,
    options: {
      data: { full_name: input.ownerName }
    }
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }

  // Supabase no revela si un correo ya existe: si la cuenta ya estaba
  // confirmada, devuelve un user con identities: [] en vez de un error
  // (así evita que alguien use este formulario para averiguar qué correos
  // están registrados). Lo detectamos igual para no dejar al usuario
  // esperando un código que nunca le servirá.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    throw new Error(
      "Este correo ya está registrado. Si ya verificaste tu cuenta, inicia sesión. " +
      "Si no la recuerdas, usa '¿Olvidaste tu contraseña?'. " +
      "Si crees que es un error, contacta a soporte."
    );
  }

  savePendingRegistration({
    businessName: input.businessName,
    ownerName: input.ownerName,
    country: input.country,
    email: input.email
  });
}

/**
 * Paso 3 del registro seguro: se llama DESPUÉS de que authOtp.ts confirmó el
 * código de 6 dígitos (lo que deja la sesión de Supabase activa y con
 * email_confirmed_at ya lleno). Llama a la Edge Function register-business
 * (que ahora exige justo eso) para crear el negocio + la membresía ADMIN, y
 * resuelve la sesión de negocio completa.
 */
export async function completeRegistration(): Promise<BusinessSession> {
  const pending = getPendingRegistration();
  if (!pending) {
    throw new Error("No hay un registro en curso. Vuelve a empezar desde 'Crear cuenta'.");
  }

  const { data: fnData, error: fnError } = await supabase.functions.invoke("register-business", {
    body: {
      businessName: pending.businessName,
      ownerName: pending.ownerName,
      country: pending.country
    }
  });

  if (fnError) {
    // supabase-js solo da un mensaje genérico ("Edge Function returned a
    // non-2xx status code") en fnError.message. El mensaje real que SÍ
    // escribimos nosotros (ej. "EMAIL_NOT_VERIFIED", "Faltan campos...")
    // viene en el body de la respuesta, accesible vía fnError.context.
    let detailedMessage: string | null = null;
    const context = (fnError as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        detailedMessage = body?.error ?? null;
      } catch {
        // El body no era JSON válido; nos quedamos con el mensaje genérico.
      }
    }
    throw new Error(detailedMessage ?? fnError.message ?? "No se pudo crear el negocio.");
  }
  if (fnData?.error) {
    throw new Error(fnData.error);
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Tu sesión no es válida. Vuelve a iniciar sesión.");
  }

  const businessSession = await resolveBusinessSession(userData.user.id, pending.ownerName);
  if (!businessSession) {
    throw new Error("El negocio se creó pero no se pudo cargar. Intenta iniciar sesión de nuevo.");
  }

  clearPendingRegistration();
  setCurrentBusinessId(businessSession.businessId);
  setCurrentBranchId(await resolveDefaultBranchId(businessSession.businessId));
  return businessSession;
}

/**
 * Inicia sesión y resuelve el negocio activo del usuario. Se llama al
 * cargar la app (si ya hay sesión guardada) y en la pantalla de Login.
 */
export async function resolveDefaultBranchId(businessId: string): Promise<string | null> {
  const { data, error } = await supabase
    .from("branches")
    .select("id")
    .eq("business_id", businessId)
    .eq("is_main", true)
    .maybeSingle();

  if (error) {
    return null;
  }

  if (data?.id) {
    return data.id as string | null;
  }

  const { data: insertedBranch, error: insertError } = await supabase
    .from("branches")
    .insert({
      business_id: businessId,
      name: "Sucursal principal",
      is_main: true,
      active: true
    })
    .select("id")
    .maybeSingle();

  if (insertError || !insertedBranch?.id) {
    return null;
  }

  return insertedBranch.id as string | null;
}

export async function getUserBusinesses(userId: string): Promise<BusinessSession[]> {
  const { data: memberships, error } = await supabase
    .from("business_members")
    .select(
      "business_id, role, businesses(name, country, currency, language, timezone, tax_rate, onboarding_completed, business_type, enabled_modules, salida_cocina)"
    )
    .eq("user_id", userId);

  if (error || !memberships || memberships.length === 0) {
    return [];
  }

  return memberships.map((membership: Record<string, unknown>) => {
    const businessRow = membership.businesses as unknown as BusinessRow | undefined;
    return toBusinessSession(userId, membership.business_id as string, membership.role as string, "", businessRow);
  });
}

export async function signIn(email: string, password: string): Promise<BusinessSession | BusinessSession[] | null> {
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email,
    password
  });

  if (authError || !authData.user) {
    throw new Error(authError ? translateAuthError(authError.message) : "Credenciales inválidas.");
  }

  const ownerName = (authData.user.user_metadata?.full_name as string | undefined) ?? "";
  const businesses = await getUserBusinesses(authData.user.id);

  if (businesses.length === 0) {
    return null;
  }

  if (businesses.length === 1) {
    const session = businesses[0];
    setCurrentBusinessId(session.businessId);
    setCurrentBranchId(await resolveDefaultBranchId(session.businessId));
    return session;
  }

  return businesses;
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut();
  setCurrentBusinessId(null);
  setCurrentBranchId(null);
}

/**
 * Recuperación de contraseña — paso 1: dispara el correo de recuperación.
 * Supabase no revela si el correo existe o no (responde éxito igual en
 * ambos casos), así que esta función tampoco lo hace — evita que alguien
 * use este formulario para averiguar qué correos están registrados.
 * El link del correo apunta a /actualizar-password (ver App.tsx).
 */
export async function requestPasswordReset(email: string): Promise<void> {
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/actualizar-password`
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }
}

/**
 * Recuperación de contraseña — paso 2: se llama desde /actualizar-password,
 * ya con la sesión temporal de recuperación que Supabase deja activa al
 * abrir el link del correo (la detecta sola desde la URL). Requiere que
 * esa sesión exista; si no, Supabase responde con un error claro.
 */
export async function updatePassword(newPassword: string): Promise<void> {
  const { error } = await supabase.auth.updateUser({ password: newPassword });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }
}

/**
 * Marca el negocio como onboarding_completed = true en Supabase (real,
 * persistido). Se llama al terminar el asistente de /onboarding (PASO 11).
 * Requiere la policy `businesses_update_own` (ver supabase/schema.sql).
 */
export async function markOnboardingCompleted(businessId: string): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ onboarding_completed: true })
    .eq("id", businessId);

  if (error) {
    throw new Error(error.message ?? "No se pudo guardar el estado del onboarding.");
  }
}

/**
 * Guarda el tipo de negocio elegido en Supabase (real, persistido).
 * Se llama al terminar el PASO 3 del asistente de /onboarding.
 * Requiere la policy `businesses_update_own` (ver supabase/schema.sql).
 */
export async function setBusinessType(businessId: string, businessType: BusinessTypeId): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ business_type: businessType })
    .eq("id", businessId);

  if (error) {
    throw new Error(error.message ?? "No se pudo guardar el tipo de negocio.");
  }
}

/**
 * Guarda los módulos activos del negocio en Supabase (real, persistido).
 * Se llama al terminar el PASO 4 del asistente de /onboarding, con los
 * módulos calculados por getDefaultModulesForBusinessType() (ver
 * src/core/config/modules.ts). Requiere la policy `businesses_update_own`
 * (ver supabase/schema.sql).
 */
export async function setEnabledModules(businessId: string, modules: ModuleId[]): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({ enabled_modules: modules })
    .eq("id", businessId);

  if (error) {
    throw new Error(error.message ?? "No se pudieron guardar los módulos del negocio.");
  }
}

/**
 * Crea un negocio adicional para un usuario ya autenticado, reutilizando el
 * mismo auth.uid(). No requiere OTP porque la cuenta ya está confirmada.
 */
export async function createAdditionalBusiness(
  userId: string,
  input: { businessName: string; ownerName: string; country: string }
): Promise<BusinessSession> {
  const countryDefaults = getCountryDefaults(input.country);
  if (!countryDefaults) {
    throw new Error("COUNTRY_INVALID: país no reconocido.");
  }

  const now = new Date();
  const trialEndsAt = new Date(now);
  trialEndsAt.setDate(trialEndsAt.getDate() + TRIAL_PERIOD_DAYS);

  const { data: hasUsedTrial, error: hasUsedTrialError } = await supabase.rpc("has_user_used_trial", {
    p_user_id: userId
  });

  if (hasUsedTrialError || hasUsedTrial) {
    throw new Error("TRIAL_YA_USADO: ya utilizaste tu prueba gratuita de 30 días. Puedes contratar un plan mensual o anual para continuar.");
  }

  const { data: existingBusinesses, error: existingError } = await supabase
    .from("business_members")
    .select("business_id")
    .eq("user_id", userId);

  if (existingError) {
    throw new Error("BUSINESS_LOOKUP_FAILED: " + existingError.message);
  }

  if (existingBusinesses && existingBusinesses.length > 0) {
    const { data: existingBizData, error: existingBizError } = await supabase
      .from("businesses")
      .select("id, plan, payment_status, subscription_status")
      .in("id", existingBusinesses.map((b: { business_id: string }) => b.business_id))
      .or("plan.eq.trial,plan.eq.suspended,payment_status.eq.none,payment_status.eq.pending");

    if (existingBizError) {
      throw new Error("EXISTING_BUSINESS_LOOKUP_FAILED: " + existingBizError.message);
    }

    if (existingBizData && existingBizData.length > 0) {
      throw new Error("TRIAL_DUPLICADO: ya tienes un negocio en periodo de prueba o suspendido. Activa un plan para ese negocio antes de crear uno nuevo.");
    }
  }

  const { data: business, error: businessInsertError } = await supabase
    .from("businesses")
    .insert({
      name: input.businessName.trim(),
      plan: "trial",
      trial_ends_at: trialEndsAt.toISOString(),
      trial_used_at: now.toISOString(),
      country: input.country,
      currency: countryDefaults.currency,
      language: countryDefaults.language,
      timezone: countryDefaults.timezone,
      tax_rate: countryDefaults.taxRate
    })
    .select("id")
    .single();

  if (businessInsertError || !business) {
    throw new Error(businessInsertError?.message ?? "No se pudo crear el negocio.");
  }

  const { error: memberInsertError } = await supabase.from("business_members").insert({
    user_id: userId,
    business_id: business.id,
    role: "ADMIN"
  });

  if (memberInsertError) {
    await supabase.from("businesses").delete().eq("id", business.id);
    throw new Error(memberInsertError.message ?? "No se pudo asociar el usuario al negocio.");
  }

  const { error: trialUsageError } = await supabase.rpc("record_trial_usage", {
    p_user_id: userId,
    p_business_id: business.id
  });

  if (trialUsageError) {
    await supabase.from("business_members").delete().eq("user_id", userId).eq("business_id", business.id);
    await supabase.from("businesses").delete().eq("id", business.id);
    throw new Error("TRIAL_USAGE_RECORD_FAILED: " + trialUsageError.message);
  }

  const session = toBusinessSession(userId, business.id, "ADMIN", input.ownerName, {
    name: input.businessName,
    country: input.country,
    currency: countryDefaults.currency,
    language: countryDefaults.language,
    timezone: countryDefaults.timezone,
    tax_rate: countryDefaults.taxRate,
    onboarding_completed: false,
    business_type: null,
    enabled_modules: [],
    salida_cocina: "pantalla"
  });

  return session;
}