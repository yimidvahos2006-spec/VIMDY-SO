import { Category } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * Caché local de categorías para los flujos offline.
 * La seguridad/autoridad de negocio sigue estando en CategoryRepository + Supabase.
 */
export class CategoryLocalRepository extends IndexedDbRepository<Category> {
  protected storeName = "categories" as const;
}
