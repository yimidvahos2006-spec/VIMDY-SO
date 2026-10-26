// src/infrastructure/cache/CachedList.ts
import { ScopedLocalCache } from "./scopedLocalCache";
import { getCurrentBusinessId } from "../supabase/supabaseClient";
import { connectionStore } from "../../core/store/connectionStore";
import { logWarning } from "../logging/opsLogger";

/* ===========================================================================
   CachedList
   ---------------------------------------------------------------------------
   Capa de lectura rápida para listas pequeñas del negocio (equipo, roles):

     - Memoria con vigencia corta (TTL): si tres pantallas piden la misma
       lista en el mismo segundo, se hace UNA sola petición.
     - Petición en vuelo compartida: dos llamadas simultáneas esperan la
       misma respuesta en vez de lanzar dos.
     - Persistencia en IndexedDB por negocio: sirve para abrir al instante
       (readCached) y para seguir mostrando datos sin internet.
     - `invalidate()` descarta memoria y cualquier respuesta que estuviera
       en camino (una respuesta anterior a un cambio nunca se guarda como
       si fuera la actual).

   Solo cachea LECTURAS. Las escrituras siguen yendo directo al servidor;
   después de escribir, el repositorio llama a `invalidate()`.
=========================================================================== */

export interface ListPersistence<T> {
  read(businessId: string): Promise<T[] | null>;
  write(businessId: string, items: readonly T[]): Promise<void>;
}

export interface CachedListOptions<T extends { id: string }> {
  /** Nombre solo para los logs. */
  label: string;
  /** Trae la lista fresca desde el servidor. */
  fetchRemote: () => Promise<T[]>;
  /** Dónde se guarda en disco. Por defecto IndexedDB por negocio. */
  persistence: ListPersistence<T>;
  /** Cuánto tiempo (ms) se reutiliza la lista en memoria. Por defecto 15 s. */
  ttlMs?: number;
  /** Inyectables para pruebas. */
  getBusinessId?: () => string | null | undefined;
  isOnline?: () => boolean;
  now?: () => number;
}

interface MemoryEntry<T> {
  businessId: string;
  at: number;
  data: T[];
}

interface InflightEntry<T> {
  businessId: string;
  promise: Promise<T[]>;
}

export class CachedList<T extends { id: string }> {
  private memory: MemoryEntry<T> | null = null;
  private inflight: InflightEntry<T> | null = null;
  private generation = 0;

  private readonly ttlMs: number;
  private readonly getBusinessId: () => string | null | undefined;
  private readonly isOnline: () => boolean;
  private readonly now: () => number;

  constructor(private readonly options: CachedListOptions<T>) {
    this.ttlMs = options.ttlMs ?? 15_000;
    this.getBusinessId = options.getBusinessId ?? getCurrentBusinessId;
    this.isOnline = options.isOnline ?? (() => connectionStore.isOnline());
    this.now = options.now ?? (() => Date.now());
  }

  /** Lista para uso normal: memoria reciente si hay, si no la red (con caché de respaldo). */
  public async get(): Promise<T[]> {
    const businessId = this.getBusinessId();
    const memory = this.memory;
    if (businessId && memory && memory.businessId === businessId && this.now() - memory.at < this.ttlMs) {
      return [...memory.data];
    }
    return this.getFresh();
  }

  /** Siempre consulta al servidor (comparte la petición si ya hay una en camino). */
  public getFresh(): Promise<T[]> {
    const businessId = this.getBusinessId();

    if (this.inflight && this.inflight.businessId === (businessId ?? "")) {
      return this.inflight.promise.then((data) => [...data]);
    }

    const generation = this.generation;
    const promise = this.load(businessId, generation).finally(() => {
      if (this.inflight?.promise === promise) this.inflight = null;
    });
    this.inflight = { businessId: businessId ?? "", promise };
    return promise.then((data) => [...data]);
  }

  /** Último dato guardado (memoria o disco), sin tocar la red. null si no hay. */
  public async readCached(): Promise<T[] | null> {
    const businessId = this.getBusinessId();
    if (!businessId) return null;

    if (this.memory && this.memory.businessId === businessId) {
      return [...this.memory.data];
    }

    try {
      return await this.options.persistence.read(businessId);
    } catch (error) {
      logWarning(`[CachedList:${this.options.label}] No se pudo leer el caché local`, {
        category: "offline",
        context: { error: String(error) }
      });
      return null;
    }
  }

  /** Descarta memoria y respuestas en camino. Llamar después de cualquier escritura. */
  public invalidate(): void {
    this.generation += 1;
    this.memory = null;
    this.inflight = null;
  }

  private async load(businessId: string | null | undefined, generation: number): Promise<T[]> {
    // Sin internet no se espera a una petición que va a fallar: se usa el caché.
    if (!this.isOnline()) {
      const offline = await this.readCached();
      if (offline) return offline;
    }

    try {
      const fresh = await this.options.fetchRemote();

      if (businessId && generation === this.generation) {
        this.memory = { businessId, at: this.now(), data: fresh };
        void this.options.persistence.write(businessId, fresh).catch((error) => {
          logWarning(`[CachedList:${this.options.label}] No se pudo guardar el caché local`, {
            category: "offline",
            context: { error: String(error) }
          });
        });
      }

      return fresh;
    } catch (error) {
      const fallback = await this.readCached();
      if (fallback) {
        logWarning(`[CachedList:${this.options.label}] Falló la red, se usa el caché local`, {
          category: "offline",
          context: { error: String(error) }
        });
        return fallback;
      }
      throw error;
    }
  }
}

/** Persistencia por defecto: IndexedDB aislado por negocio. */
export function indexedDbPersistence<T extends { id: string }>(
  storeName: "users" | "roles"
): ListPersistence<T> {
  const cache = new ScopedLocalCache<T>(storeName);
  return {
    read: (businessId) => cache.read(businessId),
    write: (businessId, items) => cache.write(businessId, items)
  };
}