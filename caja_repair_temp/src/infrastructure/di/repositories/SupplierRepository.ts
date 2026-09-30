import { Supplier } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * SupplierRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "suppliers" ya no viven solo en el navegador, viven
 * en la tabla `suppliers` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class SupplierRepository extends SupabaseRepository<Supplier> {
  protected tableName = "suppliers" as const;
}