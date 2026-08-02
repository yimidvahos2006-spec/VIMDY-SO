import { IRepository } from "./IRepository";
import { supabase, getCurrentBusinessId } from "../../supabase/supabaseClient";
import { OptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { DuplicateNameError } from "../../../core/errors/DuplicateNameError";

/**
 * Detecta strings con forma de fecha ISO (ej. "2026-07-17T22:49:42.499Z")
 * y las revive como objetos Date reales. JSON/JSONB no tiene tipo Date
 * nativo — se guarda como string y hay que reconstruirlo al leer, igual
 * que ya pasa "gratis" con IndexedDB (que sí preserva Date de forma nativa).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;

export function reviveDates<T>(value: T): T {
  if (typeof value === "string" && ISO_DATE_RE.test(value)) {
    return new Date(value) as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map(reviveDates) as unknown as T;
  }
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      result[key] = reviveDates(val);
    }
    return result as T;
  }
  return value;
}

/**
 * SupabaseRepository
 * ---------------------------------------------------------------------------
 * Reemplazo directo de IndexedDbRepository con la MISMA interfaz pública
 * (IRepository<T>): cualquier engine que ya recibe un repositorio por
 * inyección de dependencias (ver CompositionRoot.ts) sigue funcionando
 * sin cambios — solo cambia qué implementación concreta se le pasa.
 *
 * Cada subclase concreta solo define `tableName` (el nombre de tabla en
 * supabase/schema.sql), igual que las subclases de IndexedDbRepository
 * solo definían `storeName`.
 *
 * El filtro por negocio (business_id) se aplica automáticamente en cada
 * consulta — además de la Row Level Security del servidor, que es la
 * verdadera barrera de seguridad. Esta capa es solo conveniencia.
 */
export abstract class SupabaseRepository<T extends { id: string; version?: number }>
  implements IRepository<T>
{
  protected abstract readonly tableName: string;

  private table() {
    return supabase.from(this.tableName);
  }

  /**
   * Quita `version` del objeto antes de guardarlo dentro de la columna
   * `data jsonb`: la versión vive SOLO en su propia columna (fuente de
   * verdad para el bloqueo optimista), nunca duplicada dentro del jsonb.
   */
  private stripVersion(item: T): Record<string, unknown> {
    const { version: _version, ...rest } = item as unknown as Record<string, unknown>;
    return rest;
  }

  /** Reconstruye la entidad tipada a partir de una fila `{ data, version }`. */
  private reviveRow(row: { data: unknown; version: number }): T {
    return { ...reviveDates(row.data as T), version: row.version } as T;
  }

  public async findAll(): Promise<T[]> {
    const { data, error } = await this.table()
      .select("data, version")
      .eq("business_id", getCurrentBusinessId());

    if (error) throw new Error(`SUPABASE_FIND_ALL_FAILED (${this.tableName}): ${error.message}`);

    return (data ?? []).map((row) => this.reviveRow(row));
  }

  public async findById(id: string): Promise<T | null> {
    const { data, error } = await this.table()
      .select("data, version")
      .eq("business_id", getCurrentBusinessId())
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`SUPABASE_FIND_BY_ID_FAILED (${this.tableName}): ${error.message}`);

    return data ? this.reviveRow(data) : null;
  }

  public async findMany(ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.table()
      .select("data, version")
      .eq("business_id", getCurrentBusinessId())
      .in("id", ids);

    if (error) throw new Error(`SUPABASE_FIND_MANY_FAILED (${this.tableName}): ${error.message}`);

    return (data ?? []).map((row) => this.reviveRow(row));
  }

  public async save(item: T): Promise<void> {
    const { error } = await this.table().upsert({
      id: item.id,
      business_id: getCurrentBusinessId(),
      data: this.stripVersion(item),
      // save() es para CREAR (o reemplazar sin condición). Si el objeto ya
      // traía versión (ej. un re-save intencional) se respeta esa; si es
      // nuevo, arranca en 1 — nunca queda en NULL.
      version: item.version ?? 1,
      updated_at: new Date().toISOString()
    });

    if (error) {
      // 23505 = "unique_violation" en Postgres. Hoy solo `categories` tiene
      // un índice único de nombre (ver categories_dedupe_migration.sql),
      // pero cualquier tabla que lo tenga en el futuro cae en el mismo
      // camino sin tener que tocar este archivo otra vez.
      if (error.code === "23505") {
        const name = (item as unknown as { name?: string }).name ?? item.id;
        throw new DuplicateNameError(this.tableName, name);
      }
      throw new Error(`SUPABASE_SAVE_FAILED (${this.tableName}): ${error.message}`);
    }
  }

  public async saveMany(items: T[]): Promise<void> {
    if (items.length === 0) return;

    const businessId = getCurrentBusinessId();
    const rows = items.map((item) => ({
      id: item.id,
      business_id: businessId,
      data: this.stripVersion(item),
      version: item.version ?? 1,
      updated_at: new Date().toISOString()
    }));

    const { error } = await this.table().upsert(rows);

    if (error) throw new Error(`SUPABASE_SAVE_MANY_FAILED (${this.tableName}): ${error.message}`);
  }

  /**
   * Actualiza un registro EXISTENTE con bloqueo optimista (CRÍTICO #6 del
   * checklist): el UPDATE solo se aplica si la fila sigue en la misma
   * `version` que el llamador leyó por última vez (normalmente vía
   * findById/getX dentro del propio engine, justo antes de armar el
   * objeto modificado — el patrón que YA usan todos los engines). Si
   * alguien más guardó primero sobre el mismo registro, la condición
   * `eq("version", expectedVersion)` no encuentra filas, el UPDATE afecta
   * 0 filas, y se lanza OptimisticLockError en vez de pisar ese cambio.
   */
  public async update(item: T): Promise<void> {
    let expectedVersion = item.version;

    // Caso raro: el objeto llegó sin version (ej. código viejo que todavía
    // no pasaba por un findById de esta versión del repositorio). Se
    // resuelve con una lectura extra — sigue siendo más seguro que asumir
    // "1" a ciegas y arriesgar un falso conflicto o un falso éxito.
    if (expectedVersion === undefined) {
      const current = await this.findById(item.id);
      if (!current) throw new Error("ITEM_NOT_FOUND");
      expectedVersion = current.version ?? 1;
    }

    const newVersion = expectedVersion + 1;

    const { data, error } = await this.table()
      .update({
        data: this.stripVersion(item),
        version: newVersion,
        updated_at: new Date().toISOString()
      })
      .eq("business_id", getCurrentBusinessId())
      .eq("id", item.id)
      .eq("version", expectedVersion)
      .select("id");

    if (error) {
      if (error.code === "23505") {
        const name = (item as unknown as { name?: string }).name ?? item.id;
        throw new DuplicateNameError(this.tableName, name);
      }
      throw new Error(`SUPABASE_UPDATE_FAILED (${this.tableName}): ${error.message}`);
    }

    if (!data || data.length === 0) {
      // 0 filas afectadas: o el registro ya no existe, o cambió de
      // versión bajo nuestros pies. Se distingue con una lectura extra
      // (solo pasa en el camino de error, nunca en el caso feliz).
      const stillExists = await this.findById(item.id);

      if (!stillExists) {
        throw new Error("ITEM_NOT_FOUND");
      }

      throw new OptimisticLockError(this.tableName, item.id);
    }
  }

  public async delete(id: string): Promise<void> {
    const { error } = await this.table()
      .delete()
      .eq("business_id", getCurrentBusinessId())
      .eq("id", id);

    if (error) throw new Error(`SUPABASE_DELETE_FAILED (${this.tableName}): ${error.message}`);
  }

  public async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const { error } = await this.table()
      .delete()
      .eq("business_id", getCurrentBusinessId())
      .in("id", ids);

    if (error) throw new Error(`SUPABASE_DELETE_MANY_FAILED (${this.tableName}): ${error.message}`);
  }

  public async exists(id: string): Promise<boolean> {
    const item = await this.findById(id);
    return item !== null;
  }

  public async count(): Promise<number> {
    const { count, error } = await this.table()
      .select("id", { count: "exact", head: true })
      .eq("business_id", getCurrentBusinessId());

    if (error) throw new Error(`SUPABASE_COUNT_FAILED (${this.tableName}): ${error.message}`);

    return count ?? 0;
  }
}