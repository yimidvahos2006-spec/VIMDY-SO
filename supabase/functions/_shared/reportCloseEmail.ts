/**
 * reportCloseEmail.ts
 * ---------------------------------------------------------------------------
 * Cliente de Resend para el "Cierre inteligente por correo".
 *
 * MÓDULO PURO: sin imports y sin globales de Deno. Funciona igual en el Edge
 * Function (Deno) y en vitest (Node), y lo revisa `tsc --noEmit`. El `fetch` se
 * inyecta, así que las pruebas no tocan la red.
 *
 * Qué resuelve:
 *   - Envía por la API de Resend (POST /emails) con Idempotency-Key opcional,
 *     para que un reintento NO duplique el correo si el primer envío sí salió.
 *   - Traduce cada fallo de Resend a (a) un tipo de reintento que entiende el
 *     procesador de cierres y (b) un mensaje en español para el administrador.
 *
 * Tipos de fallo (`EmailSendError.code`, mismos valores que ya usa
 * process-daily-report):
 *   CONFIG -> falta/está mal la configuración del servicio (clave, dominio).
 *             No se reintenta a ciegas: el cierre queda esperando configuración.
 *   RETRY  -> fallo temporal (red, 429, 5xx). Se reintenta con espera creciente.
 *   FAILED -> fallo definitivo (dirección o contenido rechazados). No se reintenta.
 */

export type EmailFailureKind = "CONFIG" | "RETRY" | "FAILED";

export const RESEND_EMAILS_URL = "https://api.resend.com/emails";
export const RESEND_DEFAULT_TIMEOUT_MS = 15_000;
export const MAX_EMAIL_LENGTH = 254;
export const MAX_IDEMPOTENCY_KEY_LENGTH = 256;

/** Formato mínimo `algo@dominio.tld` (mismo criterio que usaba process-daily-report). */
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Devuelve el correo en minúsculas y sin espacios, o `null` si no es válido.
 * Nunca corrige en silencio un valor inválido: quien llama decide qué hacer.
 */
export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  if (!email || email.length > MAX_EMAIL_LENGTH) return null;
  return EMAIL_PATTERN.test(email) ? email : null;
}

export class EmailSendError extends Error {
  /** CONFIG | RETRY | FAILED — lo lee el procesador de cierres. */
  readonly code: EmailFailureKind;
  /** Código estable (RESEND_DOMAIN_NOT_VERIFIED, RESEND_RATE_LIMITED...). */
  readonly reason: string;
  /** Estado HTTP de Resend; null si no hubo respuesta (red, tiempo agotado, configuración). */
  readonly httpStatus: number | null;
  /** Mensaje en español, listo para mostrar al administrador. */
  readonly userMessage: string;

  constructor(code: EmailFailureKind, reason: string, userMessage: string, httpStatus: number | null = null) {
    // `message` es lo que se guarda en `last_error`: código estable + texto claro.
    super(`${reason}: ${userMessage}`);
    this.name = "EmailSendError";
    this.code = code;
    this.reason = reason;
    this.userMessage = userMessage;
    this.httpStatus = httpStatus;
  }
}

/* ---------------------------------------------------------------------------
   Clasificación de errores de Resend
   https://resend.com/docs/api-reference/errors
--------------------------------------------------------------------------- */

export interface ResendErrorBody {
  readonly name?: unknown;
  readonly message?: unknown;
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

const SUPPORT_HINT = "Avísale a soporte de VIMDY.";

/** Convierte una respuesta de error de Resend en un `EmailSendError` claro. */
export function classifyResendFailure(status: number, body: ResendErrorBody | null | undefined): EmailSendError {
  const name = text(body?.name);
  const providerMessage = text(body?.message);

  // --- Credenciales / permisos del servicio de correo (problema nuestro, no del negocio)
  if (status === 401 || name === "missing_api_key" || name === "restricted_api_key" || name === "suspended_api_key") {
    return new EmailSendError(
      "CONFIG",
      "RESEND_API_KEY_INVALID",
      `El servicio de correo de VIMDY no está autorizado en este momento. ${SUPPORT_HINT}`,
      status
    );
  }

  if (status === 403) {
    if (/not verified|domain is not/i.test(providerMessage)) {
      return new EmailSendError(
        "CONFIG",
        "RESEND_DOMAIN_NOT_VERIFIED",
        `El dominio desde el que VIMDY envía los correos aún no está verificado. ${SUPPORT_HINT}`,
        status
      );
    }
    if (/your own email|testing/i.test(providerMessage)) {
      return new EmailSendError(
        "CONFIG",
        "RESEND_TESTING_MODE",
        `El servicio de correo está en modo de pruebas y solo puede enviar al correo de la cuenta. ${SUPPORT_HINT}`,
        status
      );
    }
    return new EmailSendError(
      "CONFIG",
      "RESEND_FORBIDDEN",
      `El servicio de correo rechazó el envío por permisos. ${SUPPORT_HINT}`,
      status
    );
  }

  // --- Idempotencia
  if (name === "concurrent_idempotent_requests" || name === "resource_locked") {
    return new EmailSendError(
      "RETRY",
      "RESEND_IN_PROGRESS",
      "Ya hay un envío de este correo en curso. Se reintentará en unos minutos.",
      status
    );
  }
  if (name === "invalid_idempotent_request" || name === "invalid_idempotency_key") {
    return new EmailSendError(
      "FAILED",
      "RESEND_IDEMPOTENCY_CONFLICT",
      "El servicio de correo detectó un envío repetido con contenido distinto. No se reenvió para evitar duplicados.",
      status
    );
  }

  // --- Límites de uso (temporal: se reintenta)
  if (status === 429) {
    if (name === "daily_quota_exceeded" || name === "monthly_quota_exceeded") {
      return new EmailSendError(
        "RETRY",
        "RESEND_QUOTA_EXCEEDED",
        "Se alcanzó el límite de correos del servicio. Se reintentará automáticamente más tarde.",
        status
      );
    }
    return new EmailSendError(
      "RETRY",
      "RESEND_RATE_LIMITED",
      "El servicio de correo recibió demasiados envíos seguidos. Se reintentará en unos minutos.",
      status
    );
  }

  // --- Caídas del proveedor (temporal)
  if (status >= 500) {
    return new EmailSendError(
      "RETRY",
      "RESEND_UNAVAILABLE",
      "El servicio de correo no está disponible en este momento. Se reintentará automáticamente.",
      status
    );
  }

  // --- Datos rechazados (definitivo)
  if (status === 400 || status === 422) {
    if (/\bto\b|email address|recipient|invalid.*address/i.test(providerMessage)) {
      return new EmailSendError(
        "FAILED",
        "RESEND_INVALID_RECIPIENT",
        "El servicio de correo rechazó la dirección del destinatario. Revisa que esté bien escrita.",
        status
      );
    }
    return new EmailSendError(
      "FAILED",
      "RESEND_REJECTED",
      "El servicio de correo rechazó el mensaje por un dato inválido.",
      status
    );
  }

  return new EmailSendError(
    "FAILED",
    `RESEND_HTTP_${status}`,
    "El servicio de correo no pudo enviar el mensaje.",
    status
  );
}

/* ---------------------------------------------------------------------------
   Cliente
--------------------------------------------------------------------------- */

export interface ResendClientConfig {
  readonly apiKey?: string | null;
  /** Remitente verificado en Resend, p. ej. `VIMDY <reportes@vimdy.co>`. */
  readonly from?: string | null;
  /** Inyectable para pruebas. Por defecto, el `fetch` global. */
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  readonly url?: string;
}

export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly text: string;
  readonly html?: string;
  /** Evita duplicados si se reintenta (Resend la guarda 24 h). 1–256 caracteres. */
  readonly idempotencyKey?: string;
}

export interface ResendClient {
  /** Devuelve el id del correo en Resend, o `null` si no lo informó. Lanza `EmailSendError`. */
  send(input: SendEmailInput): Promise<string | null>;
}

export function createResendClient(config: ResendClientConfig): ResendClient {
  const apiKey = (config.apiKey ?? "").trim();
  const from = (config.from ?? "").trim();
  const timeoutMs = config.timeoutMs ?? RESEND_DEFAULT_TIMEOUT_MS;
  const url = config.url ?? RESEND_EMAILS_URL;

  return {
    async send(input: SendEmailInput): Promise<string | null> {
      if (!apiKey || !from) {
        throw new EmailSendError(
          "CONFIG",
          "RESEND_NOT_CONFIGURED",
          `El envío de correos aún no está configurado en VIMDY. ${SUPPORT_HINT}`
        );
      }

      const to = normalizeEmail(input.to);
      if (!to) {
        throw new EmailSendError(
          "FAILED",
          "INVALID_RECIPIENT",
          "El correo del destinatario no es válido."
        );
      }

      const headers: Record<string, string> = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json"
      };
      const key = input.idempotencyKey?.trim();
      if (key && key.length <= MAX_IDEMPOTENCY_KEY_LENGTH) headers["Idempotency-Key"] = key;

      const doFetch = config.fetchImpl ?? fetch;
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);

      let response: Response;
      try {
        response = await doFetch(url, {
          method: "POST",
          headers,
          body: JSON.stringify({
            from,
            to: [to],
            subject: input.subject,
            text: input.text,
            ...(input.html ? { html: input.html } : {})
          }),
          signal: controller.signal
        });
      } catch (error) {
        const aborted = error instanceof Error && error.name === "AbortError";
        throw new EmailSendError(
          "RETRY",
          aborted ? "RESEND_TIMEOUT" : "RESEND_NETWORK",
          aborted
            ? "El servicio de correo tardó demasiado en responder. Se reintentará automáticamente."
            : "No se pudo conectar con el servicio de correo. Se reintentará automáticamente."
        );
      } finally {
        clearTimeout(timer);
      }

      const body = (await response.json().catch(() => ({}))) as Record<string, unknown> | null;

      if (!response.ok) throw classifyResendFailure(response.status, body);

      const id = body && typeof body.id === "string" ? body.id : "";
      return id || null;
    }
  };
}