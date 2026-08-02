import { CashMovement } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * CashMovementRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "cash_movements" ya no viven solo en el navegador, viven
 * en la tabla `cash_movements` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class CashMovementRepository extends SupabaseRepository<CashMovement> {
  protected tableName = "cash_movements" as const;
}