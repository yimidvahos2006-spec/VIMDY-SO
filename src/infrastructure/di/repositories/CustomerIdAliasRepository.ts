import type { CustomerIdAlias } from "../../../core/offline/customerIdAliases";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * CustomerIdAliasRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que las colas Pending*: el mapa
 * "id local -> id canónico" solo tiene sentido en el dispositivo que creó el
 * cliente offline. `id` (keyPath) es el id LOCAL, así que registrar el mismo
 * alias dos veces es un simple put (idempotente).
 *
 * Se filtra por negocio automáticamente (IndexedDbRepository.matchesScope usa
 * `businessId`); `branchId` no se guarda a propósito: los UUID son únicos y
 * el alias debe seguir resolviendo aunque cambie la sucursal activa.
 */
export class CustomerIdAliasRepository extends IndexedDbRepository<CustomerIdAlias> {
  protected storeName = "customerIdAliases" as const;
}