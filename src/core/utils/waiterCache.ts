import type { Waiter } from "../entities/Entities";

/* ===========================================================================
   waiterCache
   ---------------------------------------------------------------------------
   Copia local, por negocio, de la lista de meseros. Sirve para que la
   pantalla de Meseros abra al instante (stale-while-revalidate): se pinta con
   lo último que se vio y la red confirma por detrás.

   Se usa localStorage (síncrono, disponible antes del primer render) porque
   es una lista pequeña; mismo criterio que la caché de ajustes del negocio.
   Un mesero "ligero" no tiene correo ni contraseña (ver WaiterRepository),
   así que no hay nada sensible que guardar. La verdad sigue siendo Supabase.
=========================================================================== */

const CACHE_PREFIX = "vimdy:cache:waiters:v1:";

/** Una foto en data: URL puede pesar cientos de KB: no se guarda en la caché. */
const MAX_PHOTO_URL_LENGTH = 500;

function cacheKey(businessId: string): string {
  return `${CACHE_PREFIX}${businessId}`;
}

/** Guarda la lista de este negocio. Nunca lanza (la caché es opcional). */
export function writeCachedWaiters(businessId: string | null | undefined, waiters: readonly Waiter[]): void {
  try {
    if (typeof window === "undefined" || !businessId) return;
    const slim = waiters.map((waiter) => ({
      id: waiter.id,
      name: waiter.name,
      active: waiter.active,
      createdAt: waiter.createdAt instanceof Date ? waiter.createdAt.toISOString() : waiter.createdAt,
      ...(waiter.photoUrl && waiter.photoUrl.length <= MAX_PHOTO_URL_LENGTH ? { photoUrl: waiter.photoUrl } : {})
    }));
    window.localStorage.setItem(cacheKey(businessId), JSON.stringify(slim));
  } catch {
    // Cupo lleno o modo privado estricto: no es crítico.
  }
}

/** Meseros guardados en este dispositivo, o null si no hay (o están dañados). */
export function readCachedWaiters(businessId: string | null | undefined): Waiter[] | null {
  try {
    if (typeof window === "undefined" || !businessId) return null;
    const raw = window.localStorage.getItem(cacheKey(businessId));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;

    const waiters: Waiter[] = [];
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") return null; // lista dañada: se descarta completa
      const row = entry as Record<string, unknown>;
      if (typeof row.id !== "string" || typeof row.name !== "string" || typeof row.active !== "boolean") return null;
      const createdAt = new Date(typeof row.createdAt === "string" ? row.createdAt : 0);
      waiters.push({
        id: row.id,
        name: row.name,
        active: row.active,
        createdAt: Number.isNaN(createdAt.getTime()) ? new Date(0) : createdAt,
        ...(typeof row.photoUrl === "string" ? { photoUrl: row.photoUrl } : {})
      });
    }
    return waiters;
  } catch {
    return null;
  }
}