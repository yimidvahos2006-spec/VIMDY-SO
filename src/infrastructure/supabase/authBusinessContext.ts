import { supabase, setCurrentBusinessId, setCurrentBranchId } from "./supabaseClient";
import { APP_URL } from "../../core/config/appUrl";
import { markRegistrationOtpSent, resendRegistrationOtp, translateOtpError } from "./authOtp";
import type { BusinessTypeId } from "../../core/config/businessTypes";
import type { ModuleId } from "../../core/config/modules";
import type { KitchenOutputMode } from "../../core/services/kitchenOutput";
import { kitchenOutputModeStore } from "../../core/store/kitchenOutputModeStore";
import type { OperationConfig } from "../../core/config/operation";
import { getCountryDefaults } from "../../core/config/globalization";
import { getDefaultModulesForBusinessType } from "../../core/config/modules";
import { TRIAL_PERIOD_DAYS } from "../../core/config/trial";

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
  businessType?: string;
}

/** Respuesta server-side estable del alta inicial. Evita el read-after-write
 *  inmediato que podía producir “El negocio se creó pero no se pudo cargar”.
 *  El Edge Function construye este snapshot con service_role. */
interface RegisteredBusinessBootstrap {
  businessId: string;
  branchId: string | null;
  role: string;
  business: BusinessRow & { id?: string };
}

function isRegisteredBusinessBootstrap(value: unknown): value is RegisteredBusinessBootstrap {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  const business = candidate.business as Record<string, unknown> | undefined;
  return (
    typeof candidate.businessId === "string" &&
    typeof candidate.role === "string" &&
    !!business &&
    typeof business.name === "string" &&
    typeof business.country === "string" &&
    typeof business.currency === "string" &&
    typeof business.language === "string" &&
    typeof business.timezone === "string"
  );
}

function businessSessionFromBootstrap(
  bootstrap: RegisteredBusinessBootstrap,
  ownerName: string,
  userId: string
): BusinessSession {
  return toBusinessSession(
    userId,
    bootstrap.businessId,
    bootstrap.role,
    ownerName,
    bootstrap.business
  );
}

async function resolveBusinessSessionWithRetry(
  userId: string,
  ownerName: string,
  maxAttempts = 4
): Promise<BusinessSession | null> {
  const delays = [150, 350, 750, 1500];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      const session = await resolveBusinessSession(userId, ownerName);
      if (session) return session;
      return null;
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt] ?? 1500));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudo resolver el negocio del usuario.");
}

export async function getUserBusinessesWithRetry(
  userId: string,
  ownerName: string,
  maxAttempts = 4
): Promise<BusinessSession[]> {
  const delays = [150, 350, 750, 1500];
  let lastError: unknown = null;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    try {
      return await getUserBusinesses(userId, ownerName);
    } catch (error) {
      lastError = error;
      if (attempt === maxAttempts - 1) break;
      await new Promise((resolve) => setTimeout(resolve, delays[attempt] ?? 1500));
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("No se pudieron cargar los negocios del usuario.");
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
    return "La contraseña debe tener al menos 8 caracteres, combinando letras, números y símbolos.";
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
  if (message.includes("provider_disabled") || message.includes("provider not configured")) {
    return "El método de autenticación con Google no está disponible. Usa correo y contraseña o el código por email.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("timeout") || message.includes("gateway")) {
    return "No hay conexión estable con VIMDY. Revisa tu internet e inténtalo de nuevo.";
  }
  if (message.includes("email rate limit exceeded")) {
    return "Se alcanzó el límite temporal de correos. Espera unos minutos y vuelve a intentarlo.";
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

/**
 * Calcula los módulos activos del negocio.
 *
 * Prioridad:
 *  1. Si enabled_modules tiene valores válidos → usar esos valores.
 *  2. Solo durante onboarding incompleto, business_type puede sugerir defaults.
 *  3. Un negocio ya terminado con [] queda realmente sin módulos; no se
 *     inventan capacidades desde business_type.
 */
function resolveEnabledModules(businessRow: BusinessRow | undefined): ModuleId[] {
  const existing = businessRow?.enabled_modules as ModuleId[] | null | undefined;

  if (existing && existing.length > 0) {
    return existing;
  }

  const businessType = businessRow?.business_type as BusinessTypeId | null | undefined;
  if (businessRow?.onboarding_completed !== true && businessType) {
    return getDefaultModulesForBusinessType(businessType);
  }

  return [];
}

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
     enabledModules: resolveEnabledModules(businessRow),
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

  if (error) {
    console.error("[AUTH] business lookup failed", error);
    throw new Error("No pudimos cargar tu negocio. Revisa tu conexión e inténtalo de nuevo.");
  }

  if (!membership) return null;

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
  const normalizedEmail = input.email.trim().toLowerCase();
  const businessName = input.businessName.trim();
  const ownerName = input.ownerName.trim();
  const password = input.password;

  if (!businessName || !ownerName) {
    throw new Error("Completa el nombre del negocio y tu nombre.");
  }
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Ingresa un correo válido.");
  }
  if (password.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }

  const startTime = Date.now();
  console.log("[VIMDY-AUTH] beginRegistration: signUp called for email:", normalizedEmail.replace(/(.).*?(.)@/, "$1***$2@"));

  let data: { user: { id?: string; identities?: unknown[]; email_confirmed_at?: string | null } | null } | undefined;
  let error: { message: string; status?: number } | null = null;

  try {
    const result = await supabase.auth.signUp({
      email: normalizedEmail,
      password,
      options: {
        data: { full_name: ownerName }
      }
    });
    data = result.data as typeof data;
    error = result.error as typeof error;
  } catch (err) {
    error = { message: err instanceof Error ? err.message : String(err) };
  }

  const elapsed = Date.now() - startTime;
  console.log("[VIMDY-AUTH] signUp response:", {
    elapsedMs: elapsed,
    hasError: !!error,
    hasUser: !!data?.user,
    userId: data?.user?.id,
    identitiesCount: data?.user?.identities?.length,
    emailConfirmed: data?.user?.email_confirmed_at,
    errorMessage: error?.message,
    errorStatus: error?.status
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("user already registered") || msg.includes("already registered")) {
      console.log("[VIMDY-AUTH] signUp returned 'user already registered' — calling resendRegistrationOtp");
      savePendingRegistration({
        businessName,
        ownerName,
        country: input.country,
        email: normalizedEmail
      });
      await resendRegistrationOtp();
      return;
    }
    console.error("[VIMDY-AUTH] signUp error:", error.message);
    throw new Error(translateAuthError(error.message));
  }

  if (data?.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    console.log("[VIMDY-AUTH] signUp returned existing unconfirmed user (identities=[]), calling resendRegistrationOtp");
    savePendingRegistration({
      businessName,
      ownerName,
      country: input.country,
      email: normalizedEmail
    });
    await resendRegistrationOtp();
    return;
  }

  console.log("[VIMDY-AUTH] signUp succeeded for new user — email should have been sent by Supabase");
  // El servidor limita nuevas solicitudes de confirmación a un intervalo
  // mínimo; VIMDY inicia el contador desde el primer OTP y lo conserva
  // aunque la página se recargue.
  markRegistrationOtpSent(input.email);
  savePendingRegistration({
    businessName,
    ownerName,
    country: input.country,
    email: normalizedEmail
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

  const invokeRegistration = async () => {
    const { data, error } = await supabase.functions.invoke("register-business", {
      body: {
        businessName: pending.businessName,
        ownerName: pending.ownerName,
        country: pending.country,
        businessType: pending.businessType ?? "restaurante",
        registrationMode: "initial"
      }
    });

    if (error) {
      let detailedMessage: string | null = null;
      const context = (error as { context?: Response }).context;
      if (context && typeof context.json === "function") {
        try {
          const body = await context.json();
          detailedMessage = body?.error ?? null;
        } catch {
          // El body no era JSON válido; usar el mensaje genérico.
        }
      }
      const errorMessage = error instanceof Error ? error.message : "No se pudo completar el registro.";
      throw new Error(detailedMessage ?? errorMessage);
    }

    if (data && typeof data === "object" && "error" in data) {
      throw new Error(String((data as { error: unknown }).error));
    }

    return data as unknown;
  };

  // La Edge Function devuelve el snapshot del negocio creado con service_role.
  // Esto elimina la dependencia de que la consulta RLS recién hecha sea visible
  // inmediatamente después del INSERT.
  let bootstrap: RegisteredBusinessBootstrap | null = null;
  let lastError: unknown = null;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await invokeRegistration();
      if (isRegisteredBusinessBootstrap(response)) {
        bootstrap = response;
        break;
      }

      // Compatibilidad durante un despliegue parcial: si aún responde el contrato
      // antiguo { businessId }, hacemos fallback al resolver con reintentos.
      lastError = new Error("REGISTER_BUSINESS_BOOTSTRAP_MISSING");
    } catch (error) {
      lastError = error;
      if (attempt === 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }

  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) {
    throw new Error("Tu sesión no es válida. Vuelve a iniciar sesión.");
  }

  let businessSession: BusinessSession | null = null;

  if (bootstrap) {
    businessSession = businessSessionFromBootstrap(bootstrap, pending.ownerName, userData.user.id);
  }

  if (!businessSession) {
    // Recuperación automática si el primer despliegue todavía no devuelve el
    // bootstrap o hubo un read-after-write transitorio. Nunca obliga al usuario
    // a comenzar el registro de cero.
    businessSession = await resolveBusinessSessionWithRetry(
      userData.user.id,
      pending.ownerName
    );
  }

  if (!businessSession) {
    const fallbackMessage = lastError instanceof Error ? lastError.message : null;
    throw new Error(
      fallbackMessage && fallbackMessage !== "REGISTER_BUSINESS_BOOTSTRAP_MISSING"
        ? fallbackMessage
        : "No pudimos cargar tu espacio de VIMDY todavía. Tu cuenta quedó confirmada; vuelve a intentarlo en unos segundos."
    );
  }

  clearPendingRegistration();
  setCurrentBusinessId(businessSession.businessId);
  setCurrentBranchId(bootstrap?.branchId ?? await resolveDefaultBranchId(businessSession.businessId));

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

export async function getUserBusinesses(userId: string, ownerName: string): Promise<BusinessSession[]> {
  const { data: memberships, error } = await supabase
    .from("business_members")
    .select(
      "business_id, role, businesses(name, country, currency, language, timezone, tax_rate, onboarding_completed, business_type, enabled_modules, salida_cocina)"
    )
    .eq("user_id", userId);

  if (error) {
    console.error("[AUTH] user businesses lookup failed", error);
    throw new Error("No pudimos cargar tus negocios. Revisa tu conexión e inténtalo de nuevo.");
  }

  if (!memberships || memberships.length === 0) {
    return [];
  }

  return memberships.map((membership: Record<string, unknown>) => {
    const businessId = membership.business_id;
    const role = membership.role;

    if (typeof businessId !== "string" || typeof role !== "string") {
      throw new Error("La sesión contiene una membresía de negocio inválida.");
    }

    const businessRow = membership.businesses as unknown as BusinessRow | undefined;
    return toBusinessSession(userId, businessId, role, ownerName, businessRow);
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
  const businesses = await getUserBusinessesWithRetry(authData.user.id, ownerName);

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

const LOGIN_OTP_RESEND_COOLDOWN_MS = 30_000;
const LOGIN_OTP_RESEND_STORAGE_PREFIX = "vimdy:auth:login-resend-at:";
const memoryLoginOtpResendAt = new Map<string, number>();

function loginOtpStorageKey(email: string): string {
  return `${LOGIN_OTP_RESEND_STORAGE_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function readLoginOtpResendAt(email: string): number {
  const key = loginOtpStorageKey(email);
  const inMemory = memoryLoginOtpResendAt.get(key) ?? 0;

  try {
    const raw = window.localStorage.getItem(key);
    const parsed = raw ? Number(raw) : 0;
    if (Number.isFinite(parsed) && parsed > inMemory) {
      memoryLoginOtpResendAt.set(key, parsed);
      return parsed;
    }
  } catch {
    // localStorage puede no estar disponible.
  }

  return inMemory;
}

function writeLoginOtpResendAt(email: string, timestamp: number): void {
  const key = loginOtpStorageKey(email);
  memoryLoginOtpResendAt.set(key, timestamp);

  try {
    window.localStorage.setItem(key, String(timestamp));
  } catch {
    // El mapa en memoria mantiene el cooldown durante esta sesión.
  }
}

/**
 * Inicia el flujo de "Ingresar con código": envía un email con un código OTP
 * de 6 dígitos al correo ingresado. NO inicia sesión aún — el usuario debe
 * verificar el código con verifyLoginOtp(). Supabase no revela si el email
 * está registrado (responde éxito igual), por lo que esta función tampoco lo
 * hace: evita enumeración de usuarios.
 */
export async function requestLoginOtp(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Ingresa un correo válido.");
  }

  const lastSentAt = readLoginOtpResendAt(normalizedEmail);
  const elapsed = Date.now() - lastSentAt;
  if (lastSentAt !== 0 && elapsed < LOGIN_OTP_RESEND_COOLDOWN_MS) {
    const secondsLeft = Math.ceil((LOGIN_OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
    throw new Error(`Espera ${secondsLeft}s antes de pedir otro código.`);
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false
    }
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }

  writeLoginOtpResendAt(normalizedEmail, Date.now());
}

/**
 * Verifica el código OTP recibido por email para iniciar sesión. Debe
 * llamarse después de requestLoginOtp(). Si es correcto, Supabase deja
 * la sesión activa con email_confirmado.
 */
export async function verifyLoginOtp(email: string, token: string): Promise<BusinessSession | BusinessSession[] | null> {
  const { data: otpData, error: otpError } = await supabase.auth.verifyOtp({
    email,
    token,
    type: "email"
  });

  if (otpError || !otpData.session) {
    throw new Error(translateOtpError(otpError?.message ?? "No se pudo verificar el código."));
  }

  const authUser = otpData.user;
  if (!authUser) {
    throw new Error("No se pudo iniciar sesión con el código.");
  }

  const ownerName = (authUser.user_metadata?.full_name as string | undefined) ?? "";
  const businesses = await getUserBusinessesWithRetry(authUser.id, ownerName);

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

/**
 * Reenvía el código OTP de login. Aplica un cooldown de 30s en cliente
 * para evitar rate-limit de Supabase y doble clic.
 *
 * Usa supabase.auth.signInWithOtp({ shouldCreateUser: false }) para reenviar
 * en lugar de resend(), porque resend() solo admite type:"signup" |
 * "email_change" (no "email"), y signInWithOtp es el mismo mecanismo que
 * requestLoginOtp() usa para disparar el código inicial.
 */
export async function resendLoginOtp(email: string): Promise<void> {
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Ingresa un correo válido.");
  }

  const now = Date.now();
  const lastSentAt = readLoginOtpResendAt(normalizedEmail);
  const elapsed = now - lastSentAt;

  if (lastSentAt !== 0 && elapsed < LOGIN_OTP_RESEND_COOLDOWN_MS) {
    const secondsLeft = Math.ceil((LOGIN_OTP_RESEND_COOLDOWN_MS - elapsed) / 1000);
    throw new Error(`Espera ${secondsLeft}s antes de pedir otro código.`);
  }

  const { error } = await supabase.auth.signInWithOtp({
    email: normalizedEmail,
    options: {
      shouldCreateUser: false
    }
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }

  writeLoginOtpResendAt(normalizedEmail, now);
}

export function getLoginOtpCooldownSeconds(email?: string): number {
  const pendingEmail = email?.trim().toLowerCase();
  if (!pendingEmail) return 0;

  const lastSentAt = readLoginOtpResendAt(pendingEmail);
  if (lastSentAt === 0) return 0;

  const elapsed = Date.now() - lastSentAt;
  const remaining = LOGIN_OTP_RESEND_COOLDOWN_MS - elapsed;
  return remaining > 0 ? Math.ceil(remaining / 1000) : 0;
}


/**
 * Inicia sesión con Google OAuth. Redirige al usuario al popup de Google
 * y luego resuelve el business session con la sesión que Supabase deja activa.
 */
export async function signInWithGoogle(): Promise<void> {
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${APP_URL}/auth/callback`
    }
  });

  if (error) {
    throw new Error(translateAuthError(error.message));
  }
}

export async function signOut(): Promise<void> {
  await supabase.auth.signOut({ scope: "local" });
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
  const normalizedEmail = email.trim().toLowerCase();
  if (!normalizedEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
    throw new Error("Ingresa un correo válido.");
  }

  const { error } = await supabase.auth.resetPasswordForEmail(normalizedEmail, {
    redirectTo: `${APP_URL}/actualizar-password`
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
  const trimmedPassword = newPassword;
  if (trimmedPassword.length < 8) {
    throw new Error("La contraseña debe tener al menos 8 caracteres.");
  }

  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  if (sessionError || !sessionData.session) {
    throw new Error("El enlace de recuperación no es válido o ya expiró. Solicita uno nuevo.");
  }

  const { error } = await supabase.auth.updateUser({ password: trimmedPassword });

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
export async function setBusinessType(
  businessId: string,
  businessType: BusinessTypeId,
  customLabel?: string
): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({
      business_type: businessType,
      business_type_label: businessType === "otro" ? (customLabel?.trim() || null) : null
    })
    .eq("id", businessId);

  if (error) {
    // Log técnico para diagnóstico (no se muestra al usuario)
    console.error("[VIMDY-ONBOARDING] setBusinessType error:", error);
    throw new Error("No se pudo guardar el tipo de negocio. Intenta nuevamente.");
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
 * Guarda el modo de salida de cocina (pantalla/impresora) en Supabase.
 * Se usa en el PASO 5.2 condicional del onboarding y en Configuración > Operación.
 * Requiere la policy `businesses_update_own` (ver supabase/schema.sql).
 */
export async function setKitchenOutputMode(businessId: string, mode: KitchenOutputMode): Promise<void> {
  const kitchenOutputMode = mode === "impresora" ? "printer"
    : mode === "ambos" ? "both"
    : mode === "pantalla" ? "kds"
    : "none";

  const legacyMode = mode === "impresora" ? "impresora"
    : mode === "ambos" ? "ambos"
    : "pantalla";

  const { error } = await supabase
    .from("businesses")
    .update({
      salida_cocina: legacyMode,
      kitchen_output_mode: kitchenOutputMode,
    })
    .eq("id", businessId);

  if (error) {
    throw new Error(error.message ?? "No se pudo guardar la salida de cocina.");
  }

  kitchenOutputModeStore.set(mode);
}

/**
 * Guarda el perfil operativo completo en UNA sola escritura.
 *
 * Esta es la ruta recomendada para Configuración > Operación: enabled_modules
 * y las columnas de operación deben cambiar juntas para evitar que Caja,
 * Meseros o Cocina queden temporalmente con una combinación inconsistente.
 */
export async function setBusinessOperatingProfile(
  businessId: string,
  modules: ModuleId[],
  config: OperationConfig,
): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({
      enabled_modules: modules,
      sales_channels: config.salesChannels,
      inventory_type: config.inventoryType,
      production_mode: config.productionMode,
      kds_enabled: config.kdsEnabled,
      printer_enabled: config.printerEnabled,
      service_mode: config.serviceMode ?? (config.tablesEnabled ? "both" : "counter"),
      tables_enabled: config.tablesEnabled ?? false,
      waiter_mode_enabled: config.waiterModeEnabled ?? false,
      waiter_photos_enabled: config.waiterPhotosEnabled ?? true,
      kitchen_enabled: config.kitchenEnabled ?? false,
      kitchen_output_mode: config.kitchenOutputMode ?? "none",
      prep_stations: config.prepStations ?? [],
      // La columna legacy no soporta "none". Cuando la nueva configuración
      // dice "none", conservamos un valor válido para clientes antiguos.
      salida_cocina:
        config.kitchenOutputMode === "printer" ? "impresora"
        : config.kitchenOutputMode === "both" ? "ambos"
        : "pantalla"
    })
    .eq("id", businessId)
    .select("id")
    .single();

  if (error) {
    throw new Error(error.message ?? "No se pudo guardar la configuración del negocio.");
  }
}

export async function setOperationConfig(businessId: string, config: OperationConfig): Promise<void> {
  const { error } = await supabase
    .from("businesses")
    .update({
      sales_channels: config.salesChannels,
      inventory_type: config.inventoryType,
      production_mode: config.productionMode,
      kds_enabled: config.kdsEnabled,
      printer_enabled: config.printerEnabled,
      service_mode: config.serviceMode ?? (config.tablesEnabled ? "both" : "counter"),
      tables_enabled: config.tablesEnabled ?? false,
      waiter_mode_enabled: config.waiterModeEnabled ?? false,
      waiter_photos_enabled: config.waiterPhotosEnabled ?? true,
      kitchen_enabled: config.kitchenEnabled ?? false,
      kitchen_output_mode: config.kitchenOutputMode ?? "none",
      prep_stations: config.prepStations ?? [],
      salida_cocina:
        config.kitchenOutputMode === "printer" ? "impresora"
        : config.kitchenOutputMode === "both" ? "ambos"
        : config.kitchenOutputMode === "kds" ? "pantalla"
        : "pantalla"
    })
    .eq("id", businessId);

  if (error) {
    throw new Error(error.message ?? "No se pudo guardar la configuración de operación.");
  }
}

async function resolveBusinessSessionByBusinessId(
  userId: string,
  ownerName: string,
  businessId: string
): Promise<BusinessSession | null> {
  const { data: membership, error } = await supabase
    .from("business_members")
    .select(
      "business_id, role, businesses(name, country, currency, language, timezone, tax_rate, onboarding_completed, business_type, enabled_modules, salida_cocina)"
    )
    .eq("user_id", userId)
    .eq("business_id", businessId)
    .maybeSingle();

  if (error) {
    console.error("[AUTH] created business lookup failed", error);
    throw new Error("No pudimos cargar el negocio creado. Revisa tu conexión e inténtalo de nuevo.");
  }

  if (!membership) return null;

  const businessRow = membership.businesses as unknown as BusinessRow | undefined;
  return toBusinessSession(
    userId,
    businessId,
    String(membership.role ?? "ADMIN"),
    ownerName,
    businessRow
  );
}

/**
 * Creates an additional business for an existing user.
 *
 * This function delegates the entire process (trial check, business creation,
 * membership, owner profile, trial registration) to the register-business
 * Edge Function, which runs with service_role and validates the user via JWT.
 *
 * The client NEVER calls record_trial_usage() directly — that RPC is now
 * restricted to service_role only. The Edge Function performs the trial_usage
 * insert with the authenticated user's identity obtained from the JWT, not
 * from client-supplied data.
 */
export async function createAdditionalBusiness(
  userId: string,
  input: { businessName: string; ownerName: string; country: string }
): Promise<BusinessSession> {
  const countryDefaults = getCountryDefaults(input.country);
  if (!countryDefaults) {
    throw new Error("COUNTRY_INVALID: país no reconocido.");
  }

  if (!userId) {
    throw new Error("USER_ID_REQUIRED: se necesita el ID del usuario autenticado.");
  }
  const { data: fnData, error: fnError } = await supabase.functions.invoke("register-business", {
    body: {
      businessName: input.businessName.trim(),
      ownerName: input.ownerName,
      country: input.country,
      registrationMode: "additional"
    }
  });

  if (fnError) {
    let detailedMessage: string | null = null;
    const context = (fnError as { context?: Response }).context;
    if (context && typeof context.json === "function") {
      try {
        const body = await context.json();
        detailedMessage = body?.error ?? null;
      } catch {
        // Body no válido, usar mensaje genérico
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

  const returnedBusinessId =
    fnData && typeof fnData === "object" && typeof (fnData as Record<string, unknown>).businessId === "string"
      ? String((fnData as Record<string, unknown>).businessId)
      : null;

  let businessSession: BusinessSession | null = null;
  if (returnedBusinessId) {
    businessSession = await resolveBusinessSessionByBusinessId(
      userData.user.id,
      input.ownerName,
      returnedBusinessId
    );

    if (!businessSession) {
      await new Promise((resolve) => setTimeout(resolve, 300));
      businessSession = await resolveBusinessSessionByBusinessId(
        userData.user.id,
        input.ownerName,
        returnedBusinessId
      );
    }
  }

  if (!businessSession) {
    throw new Error("El negocio se creó pero no se pudo cargar todavía. Vuelve a intentarlo en unos segundos.");
  }

  setCurrentBusinessId(businessSession.businessId);
  const returnedBranchId =
    fnData && typeof fnData === "object" && typeof (fnData as Record<string, unknown>).branchId === "string"
      ? String((fnData as Record<string, unknown>).branchId)
      : await resolveDefaultBranchId(businessSession.businessId);
  setCurrentBranchId(returnedBranchId);
  return businessSession;
}

export function __resetLoginOtpCooldown(): void {
  memoryLoginOtpResendAt.clear();
}