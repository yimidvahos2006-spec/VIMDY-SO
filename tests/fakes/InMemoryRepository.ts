// tests/fakes/InMemoryRepository.ts
/* ===========================================================================
   InMemoryRepository<T>
   ---------------------------------------------------------------------------
   Doble de prueba de IRepository<T> para los tests de humo (CRÍTICO #7 del
   checklist de lanzamiento). Nada de esto habla con Supabase: guarda todo
   en un Map en memoria, así que los tests corren en milisegundos y sin
   depender de que haya internet o un proyecto de Supabase configurado.

   A propósito replica el mismo comportamiento de bloqueo optimista
   (CRÍTICO #6) que ya tiene SupabaseRepository: si alguien intenta
   `update()` un registro con una `version` que ya no es la más reciente,
   lanza OptimisticLockError en vez de pisar el cambio. Así, los engines
   que se prueban con este fake quedan probados con el MISMO contrato que
   tendrán en producción, no con uno más permisivo.

   Uso típico dentro de un test:

     const shifts = new InMemoryRepository<Shift>();
     const shiftEngine = new ShiftEngine(shifts, cashEngine);
=========================================================================== */

import { IRepository } from "../../src/infrastructure/di/repositories/IRepository";
import { OptimisticLockError } from "../../src/core/errors/OptimisticLockError";

export class InMemoryRepository<T extends { id: string; version?: number }>
  implements IRepository<T>
{
  private readonly rows = new Map<string, T>();

  constructor(private readonly entityName: string = "entity") {}

  /** Clona profundo para que los tests no puedan mutar el "disco" por accidente. */
  private clone(item: T): T {
    return structuredClone(item);
  }

  public async findAll(): Promise<T[]> {
    return Array.from(this.rows.values()).map((row) => this.clone(row));
  }

  public async findById(id: string): Promise<T | null> {
    const row = this.rows.get(id);
    return row ? this.clone(row) : null;
  }

  public async findMany(ids: string[]): Promise<T[]> {
    return ids
      .map((id) => this.rows.get(id))
      .filter((row): row is T => row !== undefined)
      .map((row) => this.clone(row));
  }

  public async save(item: T): Promise<void> {
    this.rows.set(item.id, this.clone({ ...item, version: item.version ?? 1 }));
  }

  public async saveMany(items: T[]): Promise<void> {
    for (const item of items) {
      await this.save(item);
    }
  }

  public async update(item: T): Promise<void> {
    const current = this.rows.get(item.id);

    if (!current) {
      throw new Error("ITEM_NOT_FOUND");
    }

    const expectedVersion = item.version ?? current.version ?? 1;

    if ((current.version ?? 1) !== expectedVersion) {
      // Mismo comportamiento que SupabaseRepository.update() en producción
      // (ver CRÍTICO #6): la versión que trae `item` ya no es la vigente.
      throw new OptimisticLockError(this.entityName, item.id);
    }

    this.rows.set(item.id, this.clone({ ...item, version: expectedVersion + 1 }));
  }

  public async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  public async deleteMany(ids: string[]): Promise<void> {
    for (const id of ids) {
      this.rows.delete(id);
    }
  }

  public async exists(id: string): Promise<boolean> {
    return this.rows.has(id);
  }

  public async count(): Promise<number> {
    return this.rows.size;
  }

  /** Solo para armar datos iniciales en un test sin pasar por save(). */
  public seed(item: T): void {
    this.rows.set(item.id, this.clone({ ...item, version: item.version ?? 1 }));
  }
}