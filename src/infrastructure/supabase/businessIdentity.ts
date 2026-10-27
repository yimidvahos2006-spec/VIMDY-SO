import { supabase, getCurrentBusinessId } from "./supabaseClient";
import {
  buildBusinessSettingsUpdate,
  writeCachedBusinessSettings
} from "./businessSettings";
import { businessStore } from "../../core/store/businessStore";
import { companyConfigStore } from "../../core/store/companyConfigStore";
import {
  buildBusinessIdentity,
  isOnboardingCurrency,
  normalizeBusinessName,
  normalizeCity,
  normalizeTaxId,
  type BusinessIdentity
} from "../../core/config/businessIdentity";
import { logWarning } from "../logging/opsLogger";

/**
 * Guardado de la identidad del negocio (nombre, NIT/cédula, moneda, ciudad).
 *
 * LOCAL-FIRST, en este orden:
 *   1. Se valida (sin red).
 *   2. Se aplica AL INSTANTE en este dispositivo: stores en memoria + caché de
 *      ajustes en localStorage. Con eso el resto de la app ya ve los datos.
 *   3. Se deja anotado en una "bandeja de pendientes" (localStorage) lo que
 *      falta por subir. Si se cierra la pestaña o se cae internet, no se pierde.
 *   4. En segundo plano se sube a Supabase. Si falla, se reintenta solo
 *      (con esperas crecientes y cuando vuelve la conexión).
 *
 * En Supabase:
 *   - `name` y `currency` son columnas de `businesses`.
 *   - NIT y ciudad viven dentro de `businesses.settings` (jsonb). Se hace MERGE:
 *     solo se tocan esas dos llaves, el resto de ajustes queda intacto.
 *   No requiere ningún SQL nuevo: todas esas columnas ya tienen permiso de UPDATE.
 */

const PENDING_PREFIX = "vimdy:onboarding:identity-pending:v1:";

/** Esperas entre reintentos automáticos (ms). Después de la última se espera un disparador externo. */
const RETRY_DELAYS_MS = [2_000, 8_000, 30_000, 120_000] as const;

interface PendingIdentity {
  identity: BusinessIdentity;
  /** Sube cada vez que el usuario vuelve a guardar. Evita borrar un cambio nuevo al terminar una subida vieja. */
  rev: number;
}

export type IdentitySyncResult = "synced" | "nothing" | "failed";

/* ---------------------------------------------------------------------------
   Bandeja de pendientes (localStorage, con respaldo en memoria)
--------------------------------------------------------------------------- */

const pendingMemory = new Map<string, PendingIdentity>();

function pendingKey(businessId: string): string {
  return `${PENDING_PREFIX}${encodeURIComponent(businessId)}`;
}

function sanitizePending(raw: unknown): PendingIdentity | null {
  if (!raw || typeof raw !== "object") return null;
  const candidate = raw as { identity?: unknown; rev?: unknown };
  const identity = candidate.identity as Record<string, unknown> | undefined;
  if (!identity || typeof identity !== "object") return null;
  if (typeof identity.name !== "string" || typeof identity.taxId !== "string") return null;
  if (typeof identity.city !== "string" || !isOnboardingCurrency(identity.currency)) return null;

  const rev = typeof candidate.rev === "number" && Number.isFinite(candidate.rev) ? candidate.rev : 0;
  return {
    identity: {
      name: normalizeBusinessName(identity.name),
      taxId: normalizeTaxId(identity.taxId),
      currency: identity.currency,
      city: normalizeCity(identity.city)
    },
    rev
  };
}

function readPending(businessId: string): PendingIdentity | null {
  try {
    const raw = window.localStorage.getItem(pendingKey(businessId));
    if (raw) {
      const parsed = sanitizePending(JSON.parse(raw));
      if (parsed) return parsed;
    }
  } catch {
    // Almacenamiento bloqueado o dato dañado: se usa la memoria de la sesión.
  }
  return pendingMemory.get(businessId) ?? null;
}

function writePending(businessId: string, pending: PendingIdentity): void {
  pendingMemory.set(businessId, pending);
  try {
    window.localStorage.setItem(pendingKey(businessId), JSON.stringify(pending));
  } catch {
    // Sin almacenamiento local: queda en memoria mientras la pestaña siga abierta.
  }
}

function clearPending(businessId: string): void {
  pendingMemory.delete(businessId);
  try {
    window.localStorage.removeItem(pendingKey(businessId));
  } catch {
    // No-op.
  }
}

/** ¿Hay datos de identidad que aún no se han subido a Supabase? */
export function hasPendingBusinessIdentity(businessId: string): boolean {
  return readPending(businessId) !== null;
}

/* ---------------------------------------------------------------------------
   Paso 2 — aplicar en este dispositivo (instantáneo)
--------------------------------------------------------------------------- */

/**
 * Deja la identidad disponible en TODA la app sin esperar a la red:
 * stores en memoria y caché de ajustes del dispositivo. Es idempotente.
 */
export function applyBusinessIdentityLocally(businessId: string, identity: BusinessIdentity): void {
  businessStore.update({
    name: identity.name,
    nit: identity.taxId,
    city: identity.city,
    currency: identity.currency
  });
  companyConfigStore.update({ currency: identity.currency });

  try {
    // Mismo cálculo que usa Configuración: el caché queda idéntico a lo que
    // se guardaría desde allí, así el próximo arranque pinta estos datos al instante.
    const row = buildBusinessSettingsUpdate(businessStore.get(), companyConfigStore.get());
    writeCachedBusinessSettings(businessId, row.settings);
  } catch {
    // El caché es opcional; los stores en memoria ya tienen los datos.
  }
}

/* ---------------------------------------------------------------------------
   Paso 3 — subir a Supabase (segundo plano)
--------------------------------------------------------------------------- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function pushIdentityToSupabase(businessId: string, identity: BusinessIdentity): Promise<void> {
  // Se lee lo que ya hay en `settings` para NO pisar otros ajustes (WhatsApp, meta diaria, etc.).
  const { data: current, error: readError } = await supabase
    .from("businesses")
    .select("settings")
    .eq("id", businessId)
    .maybeSingle();

  if (readError) throw new Error(readError.message || "No se pudieron leer los ajustes del negocio.");
  if (!current) {
    throw new Error("No se encontró el negocio o no tienes permiso para editarlo.");
  }

  const baseSettings = isRecord((current as { settings?: unknown }).settings)
    ? ((current as { settings: Record<string, unknown> }).settings)
    : {};

  const { data, error } = await supabase
    .from("businesses")
    .update({
      name: identity.name,
      currency: identity.currency,
      settings: { ...baseSettings, nit: identity.taxId, city: identity.city }
    })
    .eq("id", businessId)
    .select("id");

  if (error) throw new Error(error.message || "No se pudo guardar la identidad del negocio.");
  // RLS: sin permiso o plan vencido, Supabase responde sin error pero con 0 filas. Eso NO es "guardado".
  if (!data || data.length === 0) {
    throw new Error("No se guardó. Solo el administrador puede cambiar estos datos y el plan debe estar activo.");
  }
}

const inFlight = new Map<string, Promise<IdentitySyncResult>>();
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>();
const retryAttempts = new Map<string, number>();
/** Negocios que esta pestaña ya intentó sincronizar: a esos se les reintenta cuando vuelve internet. */
const knownBusinessIds = new Set<string>();
let onlineListenerAttached = false;

function cancelRetry(businessId: string): void {
  const timer = retryTimers.get(businessId);
  if (timer !== undefined) clearTimeout(timer);
  retryTimers.delete(businessId);
}

function scheduleRetry(businessId: string): void {
  if (retryTimers.has(businessId)) return;
  const attempt = retryAttempts.get(businessId) ?? 0;
  const delay = RETRY_DELAYS_MS[attempt];
  if (delay === undefined) return; // Se agotaron: esperará "volvió internet" o el próximo paso del asistente.

  retryAttempts.set(businessId, attempt + 1);
  const timer = setTimeout(() => {
    retryTimers.delete(businessId);
    void syncPendingBusinessIdentity(businessId);
  }, delay);
  retryTimers.set(businessId, timer);
}

function ensureOnlineListener(): void {
  if (onlineListenerAttached || typeof window === "undefined") return;
  onlineListenerAttached = true;
  window.addEventListener("online", () => {
    for (const businessId of Array.from(knownBusinessIds)) {
      if (!readPending(businessId)) continue;
      retryAttempts.set(businessId, 0);
      void syncPendingBusinessIdentity(businessId);
    }
  });
}

async function runSync(businessId: string): Promise<IdentitySyncResult> {
  let didSync = false;

  // Bucle: si el usuario guardó otra vez mientras subíamos, se sube la versión nueva.
  for (;;) {
    const pending = readPending(businessId);
    if (!pending) return didSync ? "synced" : "nothing";

    try {
      await pushIdentityToSupabase(businessId, pending.identity);
    } catch (error) {
      logWarning("[businessIdentity] No se pudo subir la identidad del negocio; se reintentará", {
        category: "sync",
        context: { businessId, error: String(error) }
      });
      scheduleRetry(businessId);
      return "failed";
    }

    didSync = true;
    const latest = readPending(businessId);
    if (!latest || latest.rev === pending.rev) {
      clearPending(businessId);
      retryAttempts.delete(businessId);
      cancelRetry(businessId);

      // Si una recarga en medio dejó datos viejos en pantalla, se vuelven a poner los confirmados.
      if (getCurrentBusinessId() === businessId) {
        applyBusinessIdentityLocally(businessId, pending.identity);
      }
      return "synced";
    }
  }
}

/**
 * Sube a Supabase lo que haya pendiente. Seguro de llamar muchas veces:
 * si ya hay una subida en curso, comparte su resultado; si no hay nada
 * pendiente, no hace nada. Nunca lanza.
 */
export function syncPendingBusinessIdentity(businessId: string): Promise<IdentitySyncResult> {
  if (!businessId) return Promise.resolve("nothing");

  const running = inFlight.get(businessId);
  if (running) return running;

  knownBusinessIds.add(businessId);
  ensureOnlineListener();
  const promise = runSync(businessId)
    .catch((): IdentitySyncResult => "failed")
    .finally(() => {
      inFlight.delete(businessId);
    });
  inFlight.set(businessId, promise);
  return promise;
}

/* ---------------------------------------------------------------------------
   API principal del paso
--------------------------------------------------------------------------- */

/**
 * Guarda la identidad del negocio, local primero:
 * valida → aplica al instante en el dispositivo → anota pendiente → sube en segundo plano.
 *
 * Devuelve en cuanto lo local está listo (no espera a la red). Lanza un
 * Error con mensaje en español SOLO si los datos no son válidos.
 */
export function saveBusinessIdentity(
  businessId: string,
  input: { name: string; taxId: string; currency: string; city: string }
): BusinessIdentity {
  if (!businessId) throw new Error("No hay un negocio activo. Vuelve a iniciar sesión.");

  const identity = buildBusinessIdentity(input);

  applyBusinessIdentityLocally(businessId, identity);

  const previousRev = readPending(businessId)?.rev ?? 0;
  writePending(businessId, { identity, rev: previousRev + 1 });

  retryAttempts.set(businessId, 0);
  cancelRetry(businessId);
  void syncPendingBusinessIdentity(businessId);

  return identity;
}