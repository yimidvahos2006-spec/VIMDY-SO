import { Category } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * CategoryLocalRepository
 * ---------------------------------------------------------------------------
 * Copia local (IndexedDB) del catálogo de Categorías. Mismo rol que
 * ProductLocalRepository (ver Paso 1.1/1.2) pero para "categories": le
 * permite a `CategoryRepository.findAll()` mostrar algo en pantalla al
 * instante, sin esperar a Supabase.
 *
 * Reutiliza el object store "categories" que ya existe en indexedDbCore.ts
 * desde la v2 (no hace falta subir DB_VERSION).
 */
export class CategoryLocalRepository extends IndexedDbRepository<Category> {
  protected storeName = "categories" as const;
}