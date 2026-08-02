import { Table } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * TableLocalRepository
 * ---------------------------------------------------------------------------
 * Copia local (IndexedDB) del catálogo de Mesas. Mismo rol que
 * ProductLocalRepository/CategoryLocalRepository (Pasos 1.1–1.3) pero para
 * "tables": le permite a `TableRepository.findAll()` mostrar algo en
 * pantalla al instante, sin esperar a Supabase.
 *
 * Reutiliza el object store "tables" que ya existe en indexedDbCore.ts
 * (no hace falta subir DB_VERSION).
 */
export class TableLocalRepository extends IndexedDbRepository<Table> {
  protected storeName = "tables" as const;
}