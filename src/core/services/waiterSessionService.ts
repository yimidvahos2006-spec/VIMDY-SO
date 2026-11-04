import type { Waiter } from "../entities/Entities";

/* ===========================================================================
   waiterSessionService
   ---------------------------------------------------------------------------
   Guarda QUÉ mesero está atendiendo en ESTE dispositivo (tablet del salón).
   No es un login: el mesero "ligero" no tiene correo ni contraseña (ver
   WaiterEngine). Es solo memoria local para que una recarga o una caída del
   Wi-Fi no obligue a volver a tocar la tarjeta.

   Reglas:
     - Una sesión por negocio y por dispositivo (clave con el businessId).
     - Vence a las 12 h: si la tablet se queda con "Juan" de ayer, los pedidos
       de hoy no deben quedar a su nombre sin que nadie lo haya elegido.
     - Solo se restaura si el mesero sigue existiendo y activo en la lista.
     - Lee el formato anterior (solo el id como texto) para que nadie pierda
       su sesión al desplegar esto.
     - Nunca lanza: si el almacenamiento falla, la app sigue sin recordar.

   Es lógica sin React; el almacenamiento y el reloj se inyectan para poder
   probarla con vitest en entorno node.
=========================================================================== */

/** Duración máxima de una sesión de mesero en un mismo dispositivo. */
export const WAITER_SESSION_MAX_AGE_MS = 12 * 60 * 60 * 1000;

/** Misma clave que usaba Meseros.tsx, así el formato anterior se sigue leyendo. */
const KEY_PREFIX = "vimdy.meseros.activeWaiter.";

const STORAGE_VERSION = 1;

interface StoredWaiterSession {
  readonly v: number;
  readonly waiterId: string;
  /** Milisegundos desde epoch en que se tocó la tarjeta. */
  readonly startedAt: number;
}

/** Lo mínimo que se necesita de localStorage (permite inyectar uno falso). */
export interface WaiterSessionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface WaiterSessionServiceOptions {
  /** Por defecto `window.localStorage`; null si no existe (SSR, tests, modo privado estricto). */
  storage?: WaiterSessionStorage | null;
  now?: () => number;
  maxAgeMs?: number;
}

export interface WaiterSessionService {
  /** Guarda al mesero que acaba de tocar su tarjeta. */
  start(businessId: string | null | undefined, waiterId: string): void;
  /** Borra la sesión (botón "Cambiar de mesero"). */
  end(businessId: string | null | undefined): void;
  /** Id guardado y vigente, o null (si venció o está dañado, se limpia). */
  getWaiterId(businessId: string | null | undefined): string | null;
  /**
   * El mesero guardado, solo si sigue en `waiters` y está activo. Es solo
   * lectura: quien llama decide cuándo borrar la sesión (con `end`), porque
   * una lista en caché puede no incluir todavía a un mesero recién creado.
   */
  resolve(businessId: string | null | undefined, waiters: readonly Waiter[]): Waiter | null;
}

function storageKey(businessId: string | null | undefined): string {
  return `${KEY_PREFIX}${businessId ?? "default"}`;
}

function defaultStorage(): WaiterSessionStorage | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    // Acceder a localStorage puede lanzar en modo privado estricto.
    return null;
  }
}

function parseStored(raw: string, now: number): StoredWaiterSession | null {
  const text = raw.trim();
  if (!text) return null;

  // Formato anterior: el valor es directamente el id del mesero.
  if (!text.startsWith("{")) {
    return { v: STORAGE_VERSION, waiterId: text, startedAt: now };
  }

  try {
    const parsed: unknown = JSON.parse(text);
    if (!parsed || typeof parsed !== "object") return null;
    const row = parsed as Record<string, unknown>;
    if (typeof row.waiterId !== "string" || !row.waiterId) return null;
    if (typeof row.startedAt !== "number" || !Number.isFinite(row.startedAt)) return null;
    return { v: STORAGE_VERSION, waiterId: row.waiterId, startedAt: row.startedAt };
  } catch {
    return null;
  }
}

export function createWaiterSessionService(
  options: WaiterSessionServiceOptions = {}
): WaiterSessionService {
  const now = options.now ?? Date.now;
  const maxAgeMs = options.maxAgeMs ?? WAITER_SESSION_MAX_AGE_MS;
  // `undefined` = usar el del navegador; `null` = sin almacenamiento a propósito.
  const resolveStorage = (): WaiterSessionStorage | null =>
    options.storage === undefined ? defaultStorage() : options.storage;

  function remove(key: string): void {
    try {
      resolveStorage()?.removeItem(key);
    } catch {
      /* no es crítico */
    }
  }

  function read(businessId: string | null | undefined): StoredWaiterSession | null {
    const key = storageKey(businessId);
    try {
      const raw = resolveStorage()?.getItem(key);
      if (!raw) return null;

      const current = now();
      const session = parseStored(raw, current);
      if (!session) {
        remove(key); // dañado
        return null;
      }

      const age = current - session.startedAt;
      // age < 0: el reloj del dispositivo se movió hacia atrás; no es confiable.
      if (age < 0 || age >= maxAgeMs) {
        remove(key);
        return null;
      }

      // Formato anterior: se reescribe ya con fecha, para que también venza.
      if (!raw.trim().startsWith("{")) {
        resolveStorage()?.setItem(key, JSON.stringify(session));
      }
      return session;
    } catch {
      return null;
    }
  }

  return {
    start(businessId, waiterId) {
      if (!waiterId) return;
      const session: StoredWaiterSession = {
        v: STORAGE_VERSION,
        waiterId,
        startedAt: now()
      };
      try {
        resolveStorage()?.setItem(storageKey(businessId), JSON.stringify(session));
      } catch {
        /* almacenamiento lleno o bloqueado: se sigue sin recordar */
      }
    },

    end(businessId) {
      remove(storageKey(businessId));
    },

    getWaiterId(businessId) {
      return read(businessId)?.waiterId ?? null;
    },

    resolve(businessId, waiters) {
      const session = read(businessId);
      if (!session) return null;

      return waiters.find((w) => w.id === session.waiterId && w.active) ?? null;
    }
  };
}

/** Instancia lista para la app (usa el localStorage del navegador). */
export const waiterSessionService: WaiterSessionService = createWaiterSessionService();