import { KitchenOrder } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * KitchenOrderRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "kitchen_orders" ya no viven solo en el navegador, viven
 * en la tabla `kitchen_orders` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class KitchenOrderRepository extends SupabaseRepository<KitchenOrder> {
  protected tableName = "kitchen_orders" as const;
}