// src/infrastructure/cache/scopedLocalCache.ts
import { openDatabase, STORE_NAMES } from "../di/repositories/indexedDbCore";

/* ===========================================================================
   scopedLocalCache
   ---------------------------------------------------------------------------
   Caché de LISTAS en IndexedDB, aislado por negocio. Sirve para que
   pantallas como Equipo y Roles abran al instante con lo último que se vio,
   mientras la red confirma por detrás (ver core/utils/staleWhileRevalidate).

   Diseño (por qué no se reutiliza IndexedDbRepository):
     - Los ids de rol son "ADMIN", "CAJERO"... y se repiten entre negocios.
       Aquí cada fila se guarda con llave compuesta `${businessId}:${id}`,
       así dos negocios en el mismo equipo jamás se pisan.
     - Una lectura o escritura SOLO toca las filas de su propio negocio.
     - Filas viejas de versiones anteriores de la app (formato distinto, sin
       `businessId`) se ignoran al leer y se eliminan al escribir.
     - Una fila "meta" distingue "lista vacía guardada" de "nunca se guardó".

   Es solo un caché de lectura: la fuente de verdad sigue siendo Supabase
   (con su RLS). Nunca se guardan contraseñas: Auth las maneja el servidor.
=========================================================================== */

type CacheStoreName = Extract<(typeof STORE_NAMES)[number], "users" | "roles">;

export interface CacheRow<T> {
  id: string;
  businessId: string;
  savedAt: number;
  /** Presente en las filas de datos. */
  item?: T;
  /** true en la fila que marca "este negocio ya guardó su lista". */
  meta?: true;
}

const META_ID = "__meta__";

function rowKey(businessId: string, itemId: string): string {
  return `${businessId}:${itemId}`;
}

function isOwnFormat(row: unknown): row is CacheRow<unknown> {
  if (!row || typeof row !== "object") return false;
  const r = row as Record<string, unknown>;
  return typeof r.businessId === "string" && typeof r.id === "string" && (r.meta === true || "item" in r);
}

/** Arma las filas a guardar para un negocio (incluye la fila meta). Puro, para tests. */
export function buildCacheRows<T extends { id: string }>(
  businessId: string,
  items: readonly T[],
  now: number
): CacheRow<T>[] {
  const rows: CacheRow<T>[] = items.map((item) => ({
    id: rowKey(businessId, item.id),
    businessId,
    savedAt: now,
    item
  }));
  rows.push({ id: rowKey(businessId, META_ID), businessId, savedAt: now, meta: true });
  return rows;
}

/**
 * Saca de las filas guardadas la lista de UN negocio. Devuelve null si ese
 * negocio nunca guardó su lista (no hay fila meta). Puro, para tests.
 */
export function pickCachedItems<T>(businessId: string, rows: readonly unknown[]): T[] | null {
  let hasMeta = false;
  const items: T[] = [];

  for (const row of rows) {
    if (!isOwnFormat(row) || row.businessId !== businessId) continue;
    if (row.meta === true) {
      hasMeta = true;
      continue;
    }
    if (row.item !== undefined) items.push(row.item as T);
  }

  return hasMeta ? items : null;
}

function requestToPromise<R>(request: IDBRequest<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Error de almacenamiento local."));
  });
}

export class ScopedLocalCache<T extends { id: string }> {
  constructor(private readonly storeName: CacheStoreName) {}

  /** Lista guardada de este negocio, o null si nunca se guardó. */
  public async read(businessId: string): Promise<T[] | null> {
    const db = await openDatabase();
    const store = db.transaction(this.storeName, "readonly").objectStore(this.storeName);
    const rows = await requestToPromise(store.getAll());
    return pickCachedItems<T>(businessId, rows);
  }

  /** Reemplaza la lista de este negocio (y limpia filas viejas de formato antiguo). */
  public async write(businessId: string, items: readonly T[]): Promise<void> {
    const db = await openDatabase();
    const tx = db.transaction(this.storeName, "readwrite");
    const store = tx.objectStore(this.storeName);

    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error("Error de almacenamiento local."));
      tx.onabort = () => reject(tx.error ?? new Error("Escritura local cancelada."));
    });

    const existing = await requestToPromise(store.getAll());
    for (const row of existing as unknown[]) {
      const legacy = !isOwnFormat(row);
      const sameBusiness = !legacy && (row as CacheRow<unknown>).businessId === businessId;
      if (legacy || sameBusiness) {
        store.delete((row as { id: string }).id);
      }
    }

    for (const row of buildCacheRows(businessId, items, Date.now())) {
      store.put(row);
    }

    await done;
  }
}