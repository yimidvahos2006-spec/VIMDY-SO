import { PurchaseOrder } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";

/**
 * PurchaseOrderRepository
 * ---------------------------------------------------------------------------
 * PASO 2.7 (Compras Inteligentes) — persiste las órdenes de compra en la
 * tabla `purchase_orders` de Supabase (creada por el generador genérico en
 * supabase/schema.sql, igual que `suppliers`), aisladas por negocio vía RLS.
 * Nunca se borran filas: cancelar/posponer solo cambia el campo `status`.
 */
export class PurchaseOrderRepository extends SupabaseRepository<PurchaseOrder> {
  protected tableName = "purchase_orders" as const;
}