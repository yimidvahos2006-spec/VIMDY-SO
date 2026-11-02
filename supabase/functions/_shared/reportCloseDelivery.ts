/**
 * reportCloseDelivery.ts
 * ---------------------------------------------------------------------------
 * Lógica del "Cierre inteligente por correo" — Parte 2.
 *
 * MÓDULO PURO (sin globales de Deno, sin red, sin base de datos): todo lo que
 * toca el mundo exterior entra por "puertos" que se inyectan. Así el Edge
 * Function `process-daily-report` lo conecta a Supabase/Resend y vitest lo
 * prueba con dobles en memoria.
 *
 * Responsabilidades:
 *   1) Configuración efectiva del cierre, con compatibilidad:
 *        override de la sucursal -> global del negocio   (tabla nueva report_close_settings)
 *        -> daily_report_settings                        (sistema anterior)
 *        -> defaults
 *      Si la tabla nueva no existe todavía (migración sin aplicar) se usa el
 *      sistema anterior en vez de fallar.
 *   2) Destinatarios: el correo configurado; si está vacío, el de un ADMIN o
 *      GERENTE activo del negocio (respaldo).
 *   3) Correo de prueba: validaciones, permisos y mensajes en español.
 */

import { EmailSendError, MAX_EMAIL_LENGTH, normalizeEmail } from "./reportCloseEmail.ts";

/** Máximo de destinatarios por cierre (mismo tope que la tabla nueva). */
export const MAX_CLOSE_RECIPIENTS = 5;

/** Roles que pueden recibir el reporte de cierre como respaldo. */
export const FALLBACK_ROLES: readonly string[] = ["ADMIN", "GERENTE"];

/* ---------------------------------------------------------------------------
   Correos
--------------------------------------------------------------------------- */

/**
 * Normaliza una lista: minúsculas, sin espacios, sin repetidos, solo válidos,
 * tope `max`. (Para saber si había entradas inválidas, compara con `hasEntries`.)
 */
export function normalizeEmailList(values: unknown, max: number = MAX_CLOSE_RECIPIENTS): string[] {
  if (!Array.isArray(values)) return [];
  const result: string[] = [];
  for (const value of values) {
    const email = normalizeEmail(value);
    if (email && !result.includes(email)) result.push(email);
    if (result.length >= max) break;
  }
  return result;
}

/** ¿La lista trae al menos una entrada que no esté en blanco? (válida o no) */
export function hasEntries(values: unknown): boolean {
  return Array.isArray(values) && values.some((value) => typeof value === "string" && value.trim() !== "");
}

/* ---------------------------------------------------------------------------
   Configuración efectiva
--------------------------------------------------------------------------- */

/** Fila de `report_close_settings` (tabla nueva) tal como la devuelve `resolve_report_close_settings`. */
export interface ReportCloseSettingsRow {
  readonly branch_id: string | null;
  readonly enabled: boolean;
  readonly send_on_shift_close: boolean;
  readonly email_enabled: boolean;
  readonly email_recipients: readonly string[] | null;
  readonly email_fallback_enabled: boolean;
}

/** Fila de `daily_report_settings` (sistema anterior). */
export interface LegacyDailyReportSettingsRow {
  readonly enabled: boolean;
  readonly send_on_shift_close: boolean;
  readonly whatsapp_enabled: boolean;
  readonly whatsapp_recipients: readonly string[] | null;
  readonly email_enabled: boolean;
  readonly email_recipients: readonly string[] | null;
  readonly email_fallback_enabled: boolean;
}

export type CloseSettingsSource = "branch" | "business" | "legacy" | "default";

export interface CloseSettings {
  readonly source: CloseSettingsSource;
  readonly enabled: boolean;
  readonly sendOnShiftClose: boolean;
  readonly emailEnabled: boolean;
  /** Tal como se guardó (puede venir vacío). */
  readonly emailRecipients: readonly string[];
  /** Valor del interruptor "usar el correo del negocio como respaldo". */
  readonly emailFallbackEnabled: boolean;
  /**
   * ¿Se debe usar el correo de un ADMIN/GERENTE cuando NO hay correo configurado?
   *   - Tabla nueva: lo decide `emailFallbackEnabled` (el administrador puede apagarlo).
   *   - Sistema anterior y defaults: siempre sí (así funcionaba antes; no se cambia
   *     el comportamiento de quien no ha migrado).
   */
  readonly useAdminWhenEmpty: boolean;
  /** WhatsApp no existe en la tabla nueva: se conserva lo que tenga el sistema anterior. */
  readonly whatsappEnabled: boolean;
  readonly whatsappRecipients: readonly string[];
}

export interface CloseSettingsStore {
  /**
   * Fila efectiva de la tabla nueva (override -> global) o `null` si no hay.
   * Debe devolver `null` —no lanzar— cuando la función/tabla aún no existe.
   */
  fetchResolvedCloseSettings(businessId: string, branchId: string | null): Promise<ReportCloseSettingsRow | null>;
  fetchLegacySettings(businessId: string): Promise<LegacyDailyReportSettingsRow | null>;
}

const LEGACY_DEFAULTS = {
  enabled: true,
  sendOnShiftClose: true,
  emailEnabled: true,
  emailFallbackEnabled: true,
  whatsappEnabled: false
} as const;

/** Une las dos fuentes. Función pura: no consulta nada. */
export function mergeCloseSettings(
  fresh: ReportCloseSettingsRow | null,
  legacy: LegacyDailyReportSettingsRow | null
): CloseSettings {
  const whatsappEnabled = legacy?.whatsapp_enabled ?? LEGACY_DEFAULTS.whatsappEnabled;
  const whatsappRecipients = legacy?.whatsapp_recipients ?? [];

  if (fresh) {
    return {
      source: fresh.branch_id ? "branch" : "business",
      enabled: fresh.enabled,
      sendOnShiftClose: fresh.send_on_shift_close,
      emailEnabled: fresh.email_enabled,
      emailRecipients: fresh.email_recipients ?? [],
      emailFallbackEnabled: fresh.email_fallback_enabled,
      useAdminWhenEmpty: fresh.email_fallback_enabled,
      whatsappEnabled,
      whatsappRecipients
    };
  }

  if (legacy) {
    return {
      source: "legacy",
      enabled: legacy.enabled,
      sendOnShiftClose: legacy.send_on_shift_close,
      emailEnabled: legacy.email_enabled,
      emailRecipients: legacy.email_recipients ?? [],
      emailFallbackEnabled: legacy.email_fallback_enabled,
      useAdminWhenEmpty: true,
      whatsappEnabled,
      whatsappRecipients
    };
  }

  return {
    source: "default",
    enabled: LEGACY_DEFAULTS.enabled,
    sendOnShiftClose: LEGACY_DEFAULTS.sendOnShiftClose,
    emailEnabled: LEGACY_DEFAULTS.emailEnabled,
    emailRecipients: [],
    emailFallbackEnabled: LEGACY_DEFAULTS.emailFallbackEnabled,
    useAdminWhenEmpty: true,
    whatsappEnabled,
    whatsappRecipients
  };
}

export async function loadCloseSettings(
  store: CloseSettingsStore,
  businessId: string,
  branchId: string | null
): Promise<CloseSettings> {
  const [fresh, legacy] = await Promise.all([
    store.fetchResolvedCloseSettings(businessId, branchId),
    store.fetchLegacySettings(businessId)
  ]);
  return mergeCloseSettings(fresh, legacy);
}

/**
 * ¿El error de la base significa "esta tabla/función todavía no existe"?
 * (migración sin aplicar). En ese caso se cae al sistema anterior.
 */
export function isMissingSchemaError(error: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "PGRST205" || code === "42883" || code === "42P01") return true;
  return /could not find the (function|table)|does not exist/i.test(error.message ?? "");
}

/* ---------------------------------------------------------------------------
   Respaldo: ADMIN o GERENTE activo
--------------------------------------------------------------------------- */

/** Un miembro del negocio con los datos necesarios para decidir si recibe el respaldo. */
export interface MemberCandidate {
  readonly userId: string;
  readonly role: string;
  /** Correo de la cuenta de acceso (auth); null si no tiene. */
  readonly email: string | null;
  /** `app_users.data.status` (ACTIVE | SUSPENDED | DELETED); null si no tiene perfil. */
  readonly profileStatus: string | null;
  /** Cuenta de acceso bloqueada (baneada) o inexistente. */
  readonly authDisabled: boolean;
}

/**
 * Correos de ADMIN/GERENTE activos, sin repetidos. Los ADMIN van primero y,
 * dentro de cada rol, se respeta el orden recibido.
 *
 * "Activo" = no suspendido ni eliminado en su perfil, con cuenta de acceso
 * habilitada y con un correo válido. Un miembro sin perfil (`profileStatus`
 * null) cuenta como activo: el dueño original puede no tener fila en app_users.
 */
export function pickFallbackEmails(candidates: readonly MemberCandidate[], max: number = MAX_CLOSE_RECIPIENTS): string[] {
  const rank = (role: string) => (role.trim().toUpperCase() === "ADMIN" ? 0 : 1);
  const eligible = candidates
    .map((candidate, index) => ({ candidate, index }))
    .filter(({ candidate }) => {
      const role = candidate.role.trim().toUpperCase();
      if (!FALLBACK_ROLES.includes(role)) return false;
      if (candidate.authDisabled) return false;
      const status = candidate.profileStatus?.trim().toUpperCase();
      if (status && status !== "ACTIVE") return false;
      return normalizeEmail(candidate.email) !== null;
    })
    .sort((a, b) => rank(a.candidate.role) - rank(b.candidate.role) || a.index - b.index);

  const emails: string[] = [];
  for (const { candidate } of eligible) {
    const email = normalizeEmail(candidate.email);
    if (email && !emails.includes(email)) emails.push(email);
    if (emails.length >= max) break;
  }
  return emails;
}

/* ---------------------------------------------------------------------------
   Destinatarios del cierre
--------------------------------------------------------------------------- */

export type RecipientOrigin = "configured" | "fallback" | "none";

export interface RecipientResolution {
  readonly recipients: string[];
  readonly origin: RecipientOrigin;
  /** Por qué no hay destinatarios (en español). null si hay. */
  readonly reason: string | null;
}

export async function resolveEmailRecipients(
  settings: Pick<CloseSettings, "emailEnabled" | "emailRecipients" | "useAdminWhenEmpty">,
  loadFallbackEmails: () => Promise<string[]>
): Promise<RecipientResolution> {
  if (!settings.emailEnabled) {
    return { recipients: [], origin: "none", reason: "El envío por correo está desactivado." };
  }

  const configured = normalizeEmailList(settings.emailRecipients);
  if (configured.length > 0) return { recipients: configured, origin: "configured", reason: null };

  // Hay algo escrito pero nada válido: es un error de configuración que no se
  // tapa mandando el reporte a otra persona.
  if (hasEntries(settings.emailRecipients)) {
    return {
      recipients: [],
      origin: "none",
      reason: "El correo configurado para el cierre no es válido. Corrígelo en Configuración."
    };
  }

  if (!settings.useAdminWhenEmpty) {
    return {
      recipients: [],
      origin: "none",
      reason: "No hay un correo configurado y el respaldo con el correo del negocio está desactivado."
    };
  }

  const fallback = normalizeEmailList(await loadFallbackEmails());
  if (fallback.length > 0) return { recipients: fallback, origin: "fallback", reason: null };

  return {
    recipients: [],
    origin: "none",
    reason: "No hay un correo configurado y no se encontró un ADMIN o GERENTE activo con correo."
  };
}

/* ---------------------------------------------------------------------------
   Correo de prueba
--------------------------------------------------------------------------- */

export interface TestEmailContent {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export interface TestEmailDeps {
  /** Envía un correo. Lanza `EmailSendError` si falla. Devuelve el id del proveedor. */
  sendEmail(to: string, content: TestEmailContent): Promise<string | null>;
  /** Configuración efectiva del cierre (para probar el respaldo si no se escribe un correo). */
  loadSettings(): Promise<CloseSettings>;
  loadFallbackEmails(): Promise<string[]>;
  buildContent(): TestEmailContent;
}

export interface TestEmailInput {
  /** La petición vino del procesador automático (secreto del worker), no de una persona. */
  readonly isWorker: boolean;
  /** Rol de la persona en el negocio, ya verificado en el servidor. */
  readonly role: string | null;
  /** Correo escrito en la pantalla. Vacío = probar a los destinatarios efectivos del cierre. */
  readonly recipient?: unknown;
}

export type TestEmailCode =
  | "FORBIDDEN"
  | "INVALID_EMAIL"
  | "MULTIPLE_EMAILS"
  | "NO_RECIPIENTS"
  | "EMAIL_NOT_CONFIGURED"
  | "EMAIL_TEMPORARY_FAILURE"
  | "EMAIL_REJECTED"
  | "UNEXPECTED";

export interface TestEmailSuccess {
  readonly ok: true;
  /** Primer destinatario (compatibilidad con la pantalla actual). */
  readonly recipient: string;
  readonly recipients: string[];
  readonly providerId: string | null;
  /** manual = el correo que se escribió; configured/fallback = destinatarios efectivos del cierre. */
  readonly origin: "manual" | RecipientOrigin;
  readonly failed: Array<{ recipient: string; message: string }>;
  readonly message: string;
}

export interface TestEmailFailure {
  readonly ok: false;
  readonly code: TestEmailCode;
  /** Mensaje en español para mostrar tal cual. */
  readonly message: string;
  /** Igual que `code` (las demás respuestas de process-daily-report usan `error` para el código). */
  readonly error: TestEmailCode;
}

export interface TestEmailResult {
  readonly status: number;
  readonly body: TestEmailSuccess | TestEmailFailure;
}

function failure(status: number, code: TestEmailCode, message: string): TestEmailResult {
  return { status, body: { ok: false, code, message, error: code } };
}

function statusFor(error: EmailSendError): { status: number; code: TestEmailCode } {
  if (error.code === "CONFIG") return { status: 503, code: "EMAIL_NOT_CONFIGURED" };
  if (error.code === "RETRY") return { status: 502, code: "EMAIL_TEMPORARY_FAILURE" };
  return { status: 422, code: "EMAIL_REJECTED" };
}

export async function handleTestEmail(deps: TestEmailDeps, input: TestEmailInput): Promise<TestEmailResult> {
  // 1) Permisos. El correo de prueba sale desde VIMDY hacia una dirección que
  //    escribe quien llama: solo el ADMIN del negocio, nunca el worker.
  if (input.isWorker || (input.role ?? "").trim().toUpperCase() !== "ADMIN") {
    return failure(403, "FORBIDDEN", "Solo el administrador del negocio puede enviar el correo de prueba.");
  }

  // 2) Destinatarios.
  const raw = typeof input.recipient === "string" ? input.recipient.trim() : "";
  let recipients: string[];
  let origin: TestEmailSuccess["origin"];

  if (raw) {
    if (/[,;\s]/.test(raw)) {
      return failure(400, "MULTIPLE_EMAILS", "Escribe un solo correo para enviar la prueba.");
    }
    if (raw.length > MAX_EMAIL_LENGTH || normalizeEmail(raw) === null) {
      return failure(
        400,
        "INVALID_EMAIL",
        `El correo "${raw.slice(0, 80)}" no es válido. Revisa que tenga el formato nombre@dominio.com.`
      );
    }
    recipients = [normalizeEmail(raw) as string];
    origin = "manual";
  } else {
    let resolution: RecipientResolution;
    try {
      const settings = await deps.loadSettings();
      resolution = await resolveEmailRecipients(settings, deps.loadFallbackEmails);
    } catch {
      return failure(500, "UNEXPECTED", "No se pudo leer la configuración del cierre. Inténtalo de nuevo.");
    }
    if (resolution.recipients.length === 0) {
      return failure(
        422,
        "NO_RECIPIENTS",
        `${resolution.reason ?? "No hay a quién enviar la prueba."} Escribe un correo para enviar la prueba.`
      );
    }
    recipients = resolution.recipients;
    origin = resolution.origin;
  }

  // 3) Envío.
  const content = deps.buildContent();
  const sent: Array<{ recipient: string; providerId: string | null }> = [];
  const failed: Array<{ recipient: string; message: string; error: EmailSendError | null }> = [];

  for (const recipient of recipients) {
    try {
      sent.push({ recipient, providerId: await deps.sendEmail(recipient, content) });
    } catch (error) {
      if (error instanceof EmailSendError) {
        failed.push({ recipient, message: error.userMessage, error });
      } else {
        // No se filtra el detalle interno a la pantalla.
        failed.push({ recipient, message: "No se pudo enviar el correo de prueba. Inténtalo de nuevo.", error: null });
      }
    }
  }

  if (sent.length === 0) {
    const first = failed[0];
    if (first.error) {
      const mapped = statusFor(first.error);
      return failure(mapped.status, mapped.code, first.message);
    }
    return failure(500, "UNEXPECTED", first.message);
  }

  const sentTo = sent.map((item) => item.recipient);
  const message = failed.length
    ? `Correo de prueba enviado a ${sentTo.join(", ")}, pero falló para ${failed.map((item) => item.recipient).join(", ")}.`
    : sentTo.length === 1
      ? `Correo de prueba enviado a ${sentTo[0]}. Revisa tu bandeja de entrada (y la carpeta de spam).`
      : `Correo de prueba enviado a ${sentTo.join(", ")}. Revisa la bandeja de entrada (y la carpeta de spam).`;

  return {
    status: 200,
    body: {
      ok: true,
      recipient: sentTo[0],
      recipients: sentTo,
      providerId: sent[0].providerId,
      origin,
      failed: failed.map(({ recipient, message: failureMessage }) => ({ recipient, message: failureMessage })),
      message
    }
  };
}