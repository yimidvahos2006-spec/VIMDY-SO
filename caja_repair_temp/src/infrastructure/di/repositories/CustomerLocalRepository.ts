import { Customer } from "../../../core/entities/Entities";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * CustomerLocalRepository
 * ---------------------------------------------------------------------------
 * Copia local (IndexedDB) del catálogo de Clientes. Mismo rol que
 * ProductLocalRepository/CategoryLocalRepository/TableLocalRepository
 * (Pasos 1.1–1.4) pero para "customers": le permite a
 * `CustomerRepository.findAll()` mostrar algo en pantalla al instante, sin
 * esperar a Supabase.
 *
 * Reutiliza el object store "customers" que ya existe en indexedDbCore.ts
 * (no hace falta subir DB_VERSION).
 */
export class CustomerLocalRepository extends IndexedDbRepository<Customer> {
  protected storeName = "customers" as const;
}