import { Waiter } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * WaiterRepository
 * ---------------------------------------------------------------------------
 * Tabla genérica `waiters` (ver supabase/schema.sql), aislada por negocio
 * con RLS igual que el resto. Guarda solo meseros "ligeros" (id, nombre,
 * activo) — nada de correo ni contraseña, porque no inician sesión.
 */
export class WaiterRepository extends SupabaseRepository<Waiter> {
  protected tableName = "waiters" as const;
}