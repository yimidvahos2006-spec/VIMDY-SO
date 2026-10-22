import { IRepository } from "./IRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";
import { OptimisticLockError } from "../../../core/errors/OptimisticLockError";
import { DuplicateNameError } from "../../../core/errors/DuplicateNameError";

/**
 * Detecta strings con forma de fecha ISO (ej. "2026-07-17T22:49:42.499Z")
 * y las revive como objetos Date reales. JSON/JSONB no tiene tipo Date
 * nativo — se guarda como string y hay que reconstruirlo al leer, igual
 * que ya pasa "gratis" con IndexedDB (que sí preserva Date de forma nativa).
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

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

  /**
   * Por defecto cada tabla se filtra por negocio Y sucursal. Las tablas que
   * son del negocio completo (ej. categorías) lo ponen en false: se filtran
   * solo por negocio y se guardan sin sucursal (branch_id = null), así no
   * "desaparecen" si la sucursal activa cambia o aún no estaba definida.
   */
  protected readonly scopeByBranch: boolean = true;

  private table() {
    return supabase.from(this.tableName);
  }

  private applyScope(query: any) {
    const businessId = getCurrentBusinessId();
    const branchId = this.scopeByBranch ? getCurrentBranchId() : undefined;
    if (!businessId || typeof businessId !== "string" || businessId.trim() === "") return query;
    let scoped = query.eq("business_id", businessId);

    if (branchId) {
      scoped = scoped.eq("branch_id", branchId);
    }

    return scoped;
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

  /** Sucursal con la que se guarda la fila (null si la tabla es del negocio completo). */
  private resolveBranchId(item: T): string | null | undefined {
    if (!this.scopeByBranch) return null;
    return (item as unknown as { branchId?: string | null }).branchId ?? getCurrentBranchId();
  }

  /** Reconstruye la entidad tipada a partir de una fila `{ data, version }`. */
  protected reviveRow(row: { data: unknown; version: number }): T {
    return { ...reviveDates(row.data as T), version: row.version } as T;
  }

  /**
   * Trae TODAS las filas del negocio/sucursal. Supabase corta cada consulta en
   * 1000 filas, asi que se pide por paginas ordenadas por id. Si una pagina
   * falla, se lanza el error: nunca se devuelve una lista incompleta (el
   * cache del equipo se reemplaza con esta lista y quedaria truncado).
   */
  public async findAll(): Promise<T[]> {
    const PAGE_SIZE = 1000;
    const MAX_PAGES = 200; // tope de seguridad: 200.000 filas
    const rows: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await this.applyScope(
        this.table().select("data, version")
      )
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) throw new Error(`SUPABASE_FIND_ALL_FAILED (${this.tableName}): ${error.message}`);

      const batch = (data ?? []) as Array<{ data: unknown; version: number }>;
      for (const row of batch) rows.push(this.reviveRow(row));
      if (batch.length < PAGE_SIZE) return rows;
    }

    throw new Error(`SUPABASE_FIND_ALL_TOO_MANY_ROWS (${this.tableName}): mas de ${PAGE_SIZE * MAX_PAGES} filas`);
  }

  /**
   * Igual que findAll(), pero pide al servidor SOLO las filas cuyo campo
   * `data->>field` es igual a `value` (ej. los movimientos de un turno, o
   * los turnos con status OPEN). Mismo alcance por negocio/sucursal que
   * findAll(). Pagina de a 1000 y ordena por id para que nunca se pierdan
   * filas por el tope de 1000 de la API.
   */
  public async findByDataField(field: string, value: string): Promise<T[]> {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(field)) {
      throw new Error(`SUPABASE_FIND_BY_FIELD_INVALID_FIELD (${this.tableName})`);
    }

    const PAGE_SIZE = 1000;
    const MAX_PAGES = 200; // tope de seguridad: 200.000 filas
    const rows: T[] = [];

    for (let page = 0; page < MAX_PAGES; page += 1) {
      const from = page * PAGE_SIZE;
      const { data, error } = await this.applyScope(
        this.table().select("data, version")
      )
        .eq(`data->>${field}`, value)
        .order("id", { ascending: true })
        .range(from, from + PAGE_SIZE - 1);

      if (error) {
        throw new Error(`SUPABASE_FIND_BY_FIELD_FAILED (${this.tableName}): ${error.message}`);
      }

      const batch = (data ?? []) as Array<{ data: unknown; version: number }>;
      for (const row of batch) rows.push(this.reviveRow(row));
      if (batch.length < PAGE_SIZE) break;
    }

    return rows;
  }

  public async findById(id: string): Promise<T | null> {
    if (!id) return null;

    const { data, error } = await this.applyScope(
      this.table().select("data, version")
    )
      .eq("id", id)
      .maybeSingle();

    if (error) throw new Error(`SUPABASE_FIND_BY_ID_FAILED (${this.tableName}): ${error.message}`);

    return data ? this.reviveRow(data) : null;
  }

  public async findMany(ids: string[]): Promise<T[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.applyScope(
      this.table().select("data, version")
    )
      .in("id", ids);

    if (error) throw new Error(`SUPABASE_FIND_MANY_FAILED (${this.tableName}): ${error.message}`);

    return (data ?? []).map((row: { data: unknown; version: number }) => this.reviveRow(row));
  }

  public async save(item: T): Promise<void> {
    if (!item.id || typeof item.id !== "string") {
      throw new Error(`ITEM_MISSING_ID: no se puede guardar ${this.tableName} sin id`);
    }

    const businessId = getCurrentBusinessId();
    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay un negocio activo. No se puede guardar.");
    }

    const scopeBranchId = this.resolveBranchId(item);

    const { error } = await this.table().upsert({
      id: item.id,
      business_id: businessId,
      branch_id: scopeBranchId,
      data: this.stripVersion(item),
      version: item.version ?? 1,
      updated_at: new Date().toISOString()
    });

    if (error) {
      if (error.code === "23505") {
        const name = (item as unknown as { name?: string }).name ?? item.id;
        throw new DuplicateNameError(this.tableName, name);
      }
      throw new Error(`SUPABASE_SAVE_FAILED (${this.tableName}): ${error.message}`);
    }
  }

  public async saveMany(items: T[]): Promise<void> {
    if (items.length === 0) return;

    for (const item of items) {
      if (!item.id || typeof item.id !== "string") {
        throw new Error(`ITEM_MISSING_ID: no se puede guardar ${this.tableName} sin id`);
      }
    }

    const businessId = getCurrentBusinessId();
    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay un negocio activo. No se puede guardar.");
    }

    const rows = items.map((item) => ({
      id: item.id,
      business_id: businessId,
      branch_id: this.resolveBranchId(item),
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
    if (!item.id || typeof item.id !== "string") {
      throw new Error(`ITEM_MISSING_ID: no se puede actualizar ${this.tableName} sin id`);
    }

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

    const { data, error } = await this.applyScope(
      this.table().update({
        data: this.stripVersion(item),
        version: newVersion,
        updated_at: new Date().toISOString()
      })
    )
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
    const { error } = await this.applyScope(this.table().delete())
      .eq("id", id);

    if (error) throw new Error(`SUPABASE_DELETE_FAILED (${this.tableName}): ${error.message}`);
  }

  public async deleteMany(ids: string[]): Promise<void> {
    if (ids.length === 0) return;

    const { error } = await this.applyScope(this.table().delete())
      .in("id", ids);

    if (error) throw new Error(`SUPABASE_DELETE_MANY_FAILED (${this.tableName}): ${error.message}`);
  }

  public async exists(id: string): Promise<boolean> {
    const item = await this.findById(id);
    return item !== null;
  }

  public async count(): Promise<number> {
    const { count, error } = await this.applyScope(
      this.table().select("id", { count: "exact", head: true })
    );

    if (error) throw new Error(`SUPABASE_COUNT_FAILED (${this.tableName}): ${error.message}`);

    return count ?? 0;
  }
}