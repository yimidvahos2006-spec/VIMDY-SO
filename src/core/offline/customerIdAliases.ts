import { CustomerIdAliasRepository } from "../../infrastructure/di/repositories/CustomerIdAliasRepository";
import {
  getCurrentBusinessId
} from "../../infrastructure/supabase/supabaseClient";
import { logWarning } from "../../infrastructure/logging/opsLogger";

/**
 * customerIdAliases
 * ---------------------------------------------------------------------------
 * PASO 2 del plan offline: mapa de IDs locales -> IDs canónicos del servidor.
 *
 * PROBLEMA QUE RESUELVE
 * Un cliente creado offline nace con un id local (crypto.randomUUID()). Hoy
 * ese id ES el canónico (CustomerRepository.save() hace upsert por id), pero
 * en cuanto el servidor pueda resolver ese cliente a OTRO id (p. ej. ya
 * existía uno con el mismo documento/teléfono), todo lo que quedó en cola
 * apuntando al id local (ventas, aperturas de mesa) debe redirigirse al id
 * canónico, y un reintento de la sincronización del cliente NO debe volver a
 * crearlo. Este módulo es esa fuente de verdad, persistida en IndexedDB
 * (store "customerIdAliases") para sobrevivir a recargas del navegador.
 *
 * REGLAS
 * - La clave es el id local; el valor es el id canónico. Es idempotente:
 *   registrar el mismo par dos veces no hace nada.
 * - Un id local solo puede apuntar a UN canónico. Si llega otro distinto se
 *   lanza CUSTOMER_ALIAS_CONFLICT: reasignarlo en silencio podría dejar
 *   ventas repartidas entre dos clientes.
 * - Se siguen cadenas (A -> B -> C) con tope y detección de ciclos.
 * - Los alias son por negocio (se filtran por getCurrentBusinessId()).
 */

export interface CustomerIdAlias {
  /** Id LOCAL (keyPath del store). */
  readonly id: string;
  /** Id canónico asignado por el servidor. */
  readonly canonicalId: string;
  readonly businessId: string;
  readonly createdAt: Date;
}

const repository = new CustomerIdAliasRepository();

/** Máximo de saltos al seguir una cadena de alias (A -> B -> C ...). */
const MAX_ALIAS_HOPS = 5;

/** Los alias se conservan este tiempo para cubrir ventas/mesas aún en cola. */
export const CUSTOMER_ALIAS_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let cache = new Map<string, CustomerIdAlias>();
let cacheBusinessId: string | null = null;
let loadPromise: Promise<void> | null = null;

function invalidateIfBusinessChanged(): void {
  const current = getCurrentBusinessId() ?? null;
  if (current !== cacheBusinessId) {
    cache = new Map();
    cacheBusinessId = current;
    loadPromise = null;
  }
}

/**
 * Carga los alias del negocio actual desde IndexedDB al caché en memoria.
 * Seguro de llamar muchas veces: reutiliza la misma carga en curso. Si
 * IndexedDB falla, el caché queda vacío y el sistema se comporta como antes
 * del Paso 2 (cada id se resuelve a sí mismo).
 */
export function loadCustomerIdAliases(): Promise<void> {
  invalidateIfBusinessChanged();

  if (loadPromise) return loadPromise;

  loadPromise = (async () => {
    try {
      const rows = await repository.findAll();
      const next = new Map<string, CustomerIdAlias>(cache);
      for (const row of rows) next.set(row.id, row);
      cache = next;
    } catch (error) {
      loadPromise = null;
      logWarning("[customerIdAliases] No se pudieron leer los alias locales", {
        category: "offline",
        context: { error: String(error) }
      });
    }
  })();

  return loadPromise;
}

function follow(id: string): string {
  const seen = new Set<string>([id]);
  let current = id;

  for (let hop = 0; hop < MAX_ALIAS_HOPS; hop += 1) {
    const next = cache.get(current)?.canonicalId;
    if (!next || seen.has(next)) return current;
    seen.add(next);
    current = next;
  }

  return current;
}

/**
 * Versión síncrona: solo mira el caché en memoria (llamar antes a
 * loadCustomerIdAliases()). Devuelve el mismo id si no hay alias.
 */
export function peekCanonicalCustomerId(id: string): string;
export function peekCanonicalCustomerId(id: undefined): undefined;
export function peekCanonicalCustomerId(id: string | undefined): string | undefined;
export function peekCanonicalCustomerId(id: string | undefined): string | undefined {
  if (!id) return id;
  invalidateIfBusinessChanged();
  return follow(id);
}

/** Devuelve el id canónico del cliente (o el mismo id si nunca fue aliasado). */
export async function resolveCustomerId(id: string): Promise<string>;
export async function resolveCustomerId(id: undefined): Promise<undefined>;
export async function resolveCustomerId(id: string | undefined): Promise<string | undefined>;
export async function resolveCustomerId(id: string | undefined): Promise<string | undefined> {
  if (!id) return id;
  await loadCustomerIdAliases();
  return follow(id);
}

/** true si este id local ya fue resuelto a un id canónico distinto. */
export function hasCustomerIdAlias(localId: string): boolean {
  invalidateIfBusinessChanged();
  return follow(localId) !== localId;
}

/**
 * Registra "localId -> canonicalId". Idempotente. Si localId === canonicalId
 * no hace nada (no hay nada que redirigir).
 *
 * @throws CUSTOMER_ALIAS_INVALID si falta un id o no hay negocio activo.
 * @throws CUSTOMER_ALIAS_CONFLICT si localId ya apunta a otro canónico, o si
 *         el alias cerraría un ciclo.
 */
export async function registerCustomerIdAlias(
  localId: string,
  canonicalId: string
): Promise<void> {
  if (!localId || !canonicalId) {
    throw new Error("CUSTOMER_ALIAS_INVALID: falta el id local o el canónico.");
  }

  if (localId === canonicalId) return;

  const businessId = getCurrentBusinessId();
  if (!businessId) {
    throw new Error("CUSTOMER_ALIAS_INVALID: no hay negocio activo.");
  }

  await loadCustomerIdAliases();

  const existing = cache.get(localId);
  if (existing) {
    if (existing.canonicalId === canonicalId) return;
    throw new Error(
      `CUSTOMER_ALIAS_CONFLICT: el cliente local ${localId} ya apunta a ${existing.canonicalId}; no se puede reasignar a ${canonicalId}.`
    );
  }

  // Un ciclo ocurre si el canónico ya resuelve de vuelta al id local.
  if (follow(canonicalId) === localId) {
    throw new Error(
      `CUSTOMER_ALIAS_CONFLICT: ${localId} -> ${canonicalId} cerraría un ciclo.`
    );
  }

  const alias: CustomerIdAlias = {
    id: localId,
    canonicalId,
    businessId,
    createdAt: new Date()
  };

  await repository.save(alias);
  cache = new Map(cache).set(localId, alias);
}

/**
 * Elimina alias más viejos que `maxAgeMs`. Se llama al iniciar la
 * sincronización de clientes; nunca lanza (limpiar es best-effort).
 */
export async function pruneCustomerIdAliases(
  maxAgeMs: number = CUSTOMER_ALIAS_TTL_MS
): Promise<number> {
  try {
    await loadCustomerIdAliases();
    const limit = Date.now() - maxAgeMs;
    const expired = [...cache.values()].filter(
      (alias) => alias.createdAt.getTime() < limit
    );

    if (expired.length === 0) return 0;

    await repository.deleteMany(expired.map((alias) => alias.id));

    const next = new Map(cache);
    for (const alias of expired) next.delete(alias.id);
    cache = next;

    return expired.length;
  } catch (error) {
    logWarning("[customerIdAliases] No se pudo limpiar alias antiguos", {
      category: "offline",
      context: { error: String(error) }
    });
    return 0;
  }
}

/** Borra todos los alias del negocio actual (pruebas / reinicio manual). */
export async function clearCustomerIdAliases(): Promise<void> {
  await repository.clear();
  cache = new Map();
  loadPromise = null;
}