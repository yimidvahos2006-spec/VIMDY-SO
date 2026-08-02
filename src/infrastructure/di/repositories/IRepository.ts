/**
 * `version`, si la entidad la trae (ver Entities.ts), es lo que habilita
 * el bloqueo optimista (CRÍTICO #6 del checklist). Es opcional a propósito:
 * no todas las entidades la declaran (ej. Session, que vive solo en
 * IndexedDb local y no tiene concurrencia real que resolver).
 */
export interface IRepository<T extends { id: string; version?: number }> {
  findAll(): Promise<T[]>;

  findById(id: string): Promise<T | null>;

  findMany(ids: string[]): Promise<T[]>;

  /** Crea o reemplaza sin exigir versión — úsalo solo para creación. */
  save(item: T): Promise<void>;

  saveMany(items: T[]): Promise<void>;

  /**
   * Actualiza un registro EXISTENTE. Si la entidad declara `version`, la
   * implementación (ver SupabaseRepository) exige que siga siendo la
   * misma que la base de datos tiene en este momento — si alguien más
   * ya guardó un cambio sobre este mismo registro, lanza
   * OptimisticLockError en vez de pisarlo. El patrón esperado en cada
   * engine sigue siendo el mismo de siempre (leer con findById/getX,
   * armar el objeto modificado, llamar a update) — el bloqueo optimista
   * es automático, no requiere que el llamador haga nada distinto.
   */
  update(item: T): Promise<void>;

  delete(id: string): Promise<void>;

  deleteMany(ids: string[]): Promise<void>;

  exists(id: string): Promise<boolean>;

  count(): Promise<number>;
}