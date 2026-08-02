import { Permission } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * PermissionRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "permissions" ya no viven solo en el navegador, viven
 * en la tabla `permissions` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class PermissionRepository extends SupabaseRepository<Permission> {
  protected tableName = "permissions" as const;
}