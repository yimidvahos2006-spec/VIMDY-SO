import type { InventoryCountSession } from "../../../core/inventoryCount/inventoryCountLogic";
import { SupabaseRepository } from "./SupabaseRepository";

/** Sesiones de conteo de inventario (tabla `inventory_count_sessions`). */
export class InventoryCountRepository extends SupabaseRepository<InventoryCountSession> {
  protected tableName = "inventory_count_sessions" as const;
}