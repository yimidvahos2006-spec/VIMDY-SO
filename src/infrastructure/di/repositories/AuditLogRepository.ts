import { AuditLog } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * AuditLogRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "audit_logs" ya no viven solo en el navegador, viven
 * en la tabla `audit_logs` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class AuditLogRepository extends SupabaseRepository<AuditLog> {
  protected tableName = "audit_logs" as const;
}