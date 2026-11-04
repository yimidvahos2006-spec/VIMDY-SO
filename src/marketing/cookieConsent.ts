/**
 * Consentimiento de cookies del sitio de marketing (vimdy.co).
 *
 * Lógica pura (sin React) para poder probarla en vitest con un storage falso
 * y para que cualquier script de analítica futuro consulte el consentimiento
 * ANTES de cargarse:
 *
 *   if (hasAnalyticsConsent()) loadAnalytics();
 *   window.addEventListener(COOKIE_CONSENT_CHANGE_EVENT, ...)
 *
 * Las cookies técnicas no requieren consentimiento (son necesarias para
 * prestar el servicio), por eso solo se guarda la decisión sobre analítica.
 */

export const COOKIE_CONSENT_KEY = "vimdy.cookieConsent";
export const COOKIE_CONSENT_VERSION = 1;

/** Dispara la reapertura del panel de preferencias (p. ej. desde el Footer). */
export const COOKIE_CONSENT_OPEN_EVENT = "vimdy:cookie-preferences:open";
/** Se emite cada vez que el usuario guarda una decisión. */
export const COOKIE_CONSENT_CHANGE_EVENT = "vimdy:cookie-consent:change";

export interface CookieConsent {
  version: typeof COOKIE_CONSENT_VERSION;
  /** Cookies de análisis: false por defecto (opt-in). */
  analytics: boolean;
  /** ISO 8601. Evidencia de cuándo se tomó la decisión. */
  decidedAt: string;
}

function getStorage(): Storage | null {
  try {
    if (typeof window === "undefined") return null;
    return window.localStorage ?? null;
  } catch {
    // Acceso bloqueado (modo privado estricto, políticas del navegador).
    return null;
  }
}

function isCookieConsent(value: unknown): value is CookieConsent {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    v.version === COOKIE_CONSENT_VERSION &&
    typeof v.analytics === "boolean" &&
    typeof v.decidedAt === "string"
  );
}

/** Devuelve la decisión guardada o null si no existe, está corrupta o es de otra versión. */
export function readCookieConsent(): CookieConsent | null {
  const storage = getStorage();
  if (!storage) return null;
  try {
    const raw = storage.getItem(COOKIE_CONSENT_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isCookieConsent(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** Guarda la decisión y avisa a quien esté escuchando. Nunca lanza. */
export function saveCookieConsent(analytics: boolean): CookieConsent {
  const consent: CookieConsent = {
    version: COOKIE_CONSENT_VERSION,
    analytics,
    decidedAt: new Date().toISOString(),
  };

  try {
    getStorage()?.setItem(COOKIE_CONSENT_KEY, JSON.stringify(consent));
  } catch {
    // Cuota llena o storage no disponible: la decisión rige solo en esta sesión.
  }

  try {
    if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
      window.dispatchEvent(
        new CustomEvent<CookieConsent>(COOKIE_CONSENT_CHANGE_EVENT, { detail: consent }),
      );
    }
  } catch {
    // Entornos sin CustomEvent.
  }

  return consent;
}

/** true solo si el usuario aceptó explícitamente la analítica. */
export function hasAnalyticsConsent(): boolean {
  return readCookieConsent()?.analytics === true;
}

/** Reabre el panel de preferencias para que el usuario pueda cambiar o revocar. */
export function openCookiePreferences(): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new Event(COOKIE_CONSENT_OPEN_EVENT));
}