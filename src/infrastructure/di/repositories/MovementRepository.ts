import { InventoryMovement } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

/**
 * MovementRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository (Fase 1 — Blindar
 * VIMDY): los datos de "inventory_movements" ya no viven solo en el navegador, viven
 * en la tabla `inventory_movements` de Supabase (ver supabase/schema.sql), aislados
 * por negocio mediante Row Level Security y disponibles en cualquier
 * dispositivo donde el mismo negocio inicie sesión.
 */
export class MovementRepository extends SupabaseRepository<InventoryMovement> {
  protected tableName = "inventory_movements" as const;

  /**
   * CRÍTICO #3 del checklist de lanzamiento: Kardex de UN producto,
   * ordenado por fecha, usando las columnas generadas `movement_product_id`
   * y `movement_date` (ver hot_columns_migration.sql) en vez de traer TODOS
   * los movimientos del negocio con findAll() y filtrar en JavaScript.
   */
  public async findByProduct(productId: string): Promise<InventoryMovement[]> {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("movement_product_id", productId)
      .eq("branch_id", getCurrentBranchId())
      .order("movement_date", { ascending: false });

    if (error) throw new Error(`SUPABASE_FIND_BY_PRODUCT_FAILED (inventory_movements): ${error.message}`);

    return (data ?? []).map((row) => reviveDates(row.data as InventoryMovement));
  }

  /**
   * Movimientos de un tipo específico ('INCREASE' | 'DECREASE' | 'ADJUST')
   * dentro de un rango de fechas — pensado para reportes de mermas/compras.
   */
  public async findByTypeAndDateRange(
    type: InventoryMovement["type"],
    start: Date,
    end: Date
  ): Promise<InventoryMovement[]> {
    const { data, error } = await supabase
      .from("inventory_movements")
      .select("data")
      .eq("business_id", getCurrentBusinessId())
      .eq("branch_id", getCurrentBranchId())
      .eq("movement_type", type)
      .gte("movement_date", start.toISOString())
      .lte("movement_date", end.toISOString())
      .order("movement_date", { ascending: false });

    if (error) throw new Error(`SUPABASE_FIND_BY_TYPE_FAILED (inventory_movements): ${error.message}`);

    return (data ?? []).map((row) => reviveDates(row.data as InventoryMovement));
  }
}