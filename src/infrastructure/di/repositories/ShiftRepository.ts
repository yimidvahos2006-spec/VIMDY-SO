import { Shift } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * ShiftRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "shifts" ya no viven solo en el navegador, viven
 * en la tabla `shifts` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class ShiftRepository extends SupabaseRepository<Shift> {
  protected tableName = "shifts" as const;
}