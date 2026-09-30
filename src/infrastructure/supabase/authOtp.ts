import { supabase } from "./supabaseClient";
import { getPendingRegistration } from "./authBusinessContext";

/* ===========================================================================
   authOtp
   ---------------------------------------------------------------------------
   MISIÓN 1 — Registro Seguro, tareas 2, 3 y 4:
     2. Código OTP de 6 dígitos mediante Supabase Auth.
     3. Reenviar código.
     4. Manejo completo de errores.

   Se apoya en el registro pendiente que dejó beginRegistration() en
   sessionStorage (ver authBusinessContext.ts) para saber a qué correo
   corresponde el código, así la pantalla de OTP no tiene que volver a
   pedirlo.

   Al verificar el código con éxito, supabase-js deja la sesión activa y con
   email_confirmed_at ya lleno — con eso completeRegistration() (siguiente
   paso, en authBusinessContext.ts) puede llamar a la Edge Function
   register-business, que exige justo esa condición.
=========================================================================== */

const RESEND_COOLDOWN_MS = 60_000;
const RESEND_COOLDOWN_STORAGE_PREFIX = "vimdy:auth:signup-resend-at:";

let lastResendAt = 0;

function resendStorageKey(email: string): string {
  return `${RESEND_COOLDOWN_STORAGE_PREFIX}${encodeURIComponent(email.trim().toLowerCase())}`;
}

function readStoredResendAt(email: string): number {
  try {
    const raw = window.localStorage.getItem(resendStorageKey(email));
    const parsed = raw ? Number(raw) : 0;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

function writeStoredResendAt(email: string, timestamp: number): void {
  try {
    window.localStorage.setItem(resendStorageKey(email), String(timestamp));
  } catch {
    // El navegador puede bloquear localStorage; el cooldown en memoria sigue activo.
  }
}

function clearStoredResendAt(email: string): void {
  try {
    window.localStorage.removeItem(resendStorageKey(email));
  } catch {
    // No-op.
  }
}

/** Marca el momento en que Supabase aceptó un OTP de registro. */
export function markRegistrationOtpSent(email: string, timestamp = Date.now()): void {
  lastResendAt = timestamp;
  writeStoredResendAt(email, timestamp);
}

/** Limpia el cooldown después de completar la verificación. */
export function clearRegistrationOtpCooldown(email: string): void {
  lastResendAt = 0;
  clearStoredResendAt(email);
}

/** Lee el correo del registro en curso o lanza un error claro si no hay ninguno. */
function requirePendingEmail(): string {
  const pending = getPendingRegistration();
  if (!pending?.email) {
    throw new Error("No hay un registro en curso. Vuelve a empezar desde 'Crear cuenta'.");
  }
  return pending.email;
}

/**
 * Traduce los errores crudos de Supabase Auth (en inglem, pensados para
 * logs) a mensajes claros en español para el usuario final. Cubre los
 * casos reales que devuelve verifyOtp/resend para type: "signup".
 * Exportado para reutilizarlo en flows de OTP de login (authBusinessContext).
 */
export function translateOtpError(rawMessage: string | undefined): string {
  const message = (rawMessage ?? "").toLowerCase();

  if (message.includes("expired")) {
    return "El código venció. Pide uno nuevo con 'Reenviar código'.";
  }
  if (message.includes("invalid") || message.includes("token has expired or is invalid")) {
    return "El código no es correcto. Revisa los 6 dígitos e inténtalo de nuevo.";
  }
  if (message.includes("rate limit") || message.includes("too many") || message.includes("after 60 seconds")) {
    return "Demasiados intentos. Espera un momento antes de volver a intentarlo.";
  }
  if (message.includes("already confirmed") || message.includes("already been confirmed")) {
    return "Este correo ya fue verificado. Puedes continuar.";
  }
  if (message.includes("fetch") || message.includes("network")) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }

  return rawMessage || "No se pudo verificar el código. Inténtalo de nuevo.";
}

/**
 * Traduce los errores específicos del flujo de reenvío de OTP. Separado de
 * translateOtpError() porque los mensajes de error de resend son diferentes
 * a los de verificación (ej. "For security reasons, you can only request
 * this after 60 seconds" vs "otp expired").
 */
function translateResendError(rawMessage: string | undefined): string {
  const message = (rawMessage ?? "").toLowerCase();

  if (message.includes("rate limit") || message.includes("too many") || message.includes("after 60 seconds") || message.includes("for security reasons") || message.includes("email rate limit exceeded")) {
    return "Por seguridad, debes esperar antes de solicitar otro código. VIMDY conserva tu registro; inténtalo de nuevo cuando termine el contador.";
  }
  if (message.includes("already confirmed") || message.includes("already been confirmed")) {
    return "Este correo ya fue verificado. Puedes continuar.";
  }
  if (message.includes("user not found") || message.includes("does not exist")) {
    return "No encontramos una cuenta con este correo. Vuelve a registrarte.";
  }
  if (message.includes("fetch") || message.includes("network") || message.includes("timeout")) {
    return "No hay conexión con el servidor. Revisa tu internet e inténtalo de nuevo.";
  }
  if (message.includes("email not sent") || message.includes("unable to send")) {
    return "No pudimos enviar el correo. Inténtalo de nuevo en un momento.";
  }

  return rawMessage || "No se pudo reenviar el código. Inténtalo de nuevo.";
}

/**
 * Verifica el código OTP de 6 dígitos que Supabase envió al correo del
 * registro en curso. Si es correcto, deja la sesión de Supabase activa y
 * confirmada (email_confirmed_at lleno) — quien llame a esta función debe
 * seguir con completeRegistration() justo después.
 */
export async function verifyRegistrationOtp(code: string): Promise<void> {
  const trimmedCode = code.trim();

  if (!/^\d{6}$/.test(trimmedCode)) {
    throw new Error("El código debe tener 6 dígitos.");
  }

  const email = requirePendingEmail();

  const { data, error } = await supabase.auth.verifyOtp({
    email,
    token: trimmedCode,
    type: "signup"
  });

  if (error) {
    throw new Error(translateOtpError(error.message));
  }

  if (!data.session) {
    throw new Error("No se pudo confirmar tu correo. Inténtalo de nuevo.");
  }

  clearRegistrationOtpCooldown(email);
}

/**
 * Reenvía el código OTP de 6 dígitos al correo del registro en curso.
 * Aplica un enfriamiento de 60s en el propio cliente para evitar que un
 * doble clic dispare dos correos y para darle al usuario un mensaje claro
 * en vez de esperar a que Supabase responda con "rate limit".
 *
 * Cuando el código anterior ya expiró, supabase.auth.resend() genera un
 * nuevo OTP con su propio tiempo de expiración (otp_expiry configurado en
 * Supabase). El código anterior queda invalidado automáticamente.
 */
export async function resendRegistrationOtp(): Promise<void> {
  const email = requirePendingEmail();
  console.log("[VIMDY-AUTH] resendRegistrationOtp called for email:", email.replace(/(.).*?(.)@/, "$1***$2@"));

  const now = Date.now();
  const storedResendAt = readStoredResendAt(email);
  lastResendAt = Math.max(lastResendAt, storedResendAt);
  const elapsed = now - lastResendAt;
  if (lastResendAt !== 0 && elapsed < RESEND_COOLDOWN_MS) {
    const secondsLeft = Math.ceil((RESEND_COOLDOWN_MS - elapsed) / 1000);
    throw new Error(`Espera ${secondsLeft}s antes de pedir otro código.`);
  }

  const { error } = await supabase.auth.resend({
    type: "signup",
    email
  });

  console.log("[VIMDY-AUTH] resend() response:", {
    hasError: !!error,
    errorMessage: error?.message,
    errorStatus: error?.status
  });

  if (error) {
    console.warn("[VIMDY-AUTH] signup OTP resend rejected:", {
      status: error.status,
      message: error.message
    });
    throw new Error(translateResendError(error.message));
  }

  markRegistrationOtpSent(email, now);
}

/**
 * Segundos restantes del enfriamiento de reenvío, para que la pantalla de
 * OTP pueda mostrar "Reenviar código (24s)" sin duplicar el temporizador
 * aquí. Devuelve 0 si ya se puede reenviar.
 */
export function getResendCooldownSeconds(): number {
  const pending = getPendingRegistration();
  if (!pending?.email) return 0;

  const storedResendAt = readStoredResendAt(pending.email);
  const effectiveLastResendAt = Math.max(lastResendAt, storedResendAt);
  if (effectiveLastResendAt === 0) return 0;

  const remaining = RESEND_COOLDOWN_MS - (Date.now() - effectiveLastResendAt);
  if (remaining <= 0) {
    lastResendAt = 0;
    clearStoredResendAt(pending.email);
    return 0;
  }

  return Math.ceil(remaining / 1000);
}