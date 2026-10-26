import { PurchaseOrder } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { supabase, getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

/** Lo que llegó de un producto en una recepción. */
export interface PurchaseReceiptLine {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice?: number;
}

/**
 * PurchaseOrderRepository
 * ---------------------------------------------------------------------------
 * PASO 2.7 (Compras Inteligentes) — persiste las órdenes de compra en la
 * tabla `purchase_orders` de Supabase (creada por el generador genérico en
 * supabase/schema.sql, igual que `suppliers`), aisladas por negocio vía RLS.
 * Nunca se borran filas: cancelar/posponer solo cambia el campo `status`.
 *
 * Recibir mercancía NO se hace desde el navegador sumando stock producto por
 * producto: lo hace la función del servidor `receive_purchase_order_atomic`,
 * que en UNA sola transacción suma el stock, escribe el kardex y actualiza la
 * orden (PARCIAL o COMPRADO). Repetir la misma operación no duplica stock.
 */
export class PurchaseOrderRepository extends SupabaseRepository<PurchaseOrder> {
  protected tableName = "purchase_orders" as const;

  public async receive(params: {
    purchaseOrderId: string;
    operationId: string;
    items?: readonly PurchaseReceiptLine[];
    note?: string;
    performedBy?: string;
  }): Promise<{ status: string; idempotent: boolean }> {
    const { data, error } = await supabase.rpc("receive_purchase_order_atomic", {
      p_operation_id: params.operationId,
      p_purchase_order_id: params.purchaseOrderId,
      p_received_items: params.items
        ? params.items.map((item) => ({
            productId: item.productId,
            quantity: item.quantity,
            ...(item.unitPrice !== undefined ? { unitPrice: item.unitPrice } : {})
          }))
        : null,
      p_note: params.note ?? null,
      p_performed_by: params.performedBy ?? null
    });

    if (error) {
      throw new Error(error.message || "PURCHASE_RECEIVE_FAILED");
    }

    const result = (data ?? {}) as { status?: string; idempotent?: boolean };
    return { status: String(result.status ?? ""), idempotent: result.idempotent === true };
  }

  /**
   * Flujo B — compra directa (factura / nota de entrega, sin orden previa).
   * El servidor crea la orden y la recibe con el MISMO motor del flujo A
   * (`receive_purchase_order_atomic`) dentro de una sola transacción.
   */
  public async recordDirect(params: {
    operationId: string;
    supplierId: string;
    items: readonly PurchaseReceiptLine[];
    invoiceNumber?: string;
    note?: string;
    performedBy?: string;
  }): Promise<{ status: string; idempotent: boolean; purchaseOrderId: string }> {
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay una empresa o sucursal activa.");
    }

    const { data, error } = await supabase.rpc("record_direct_purchase_atomic", {
      p_operation_id: params.operationId,
      p_business_id: businessId,
      p_branch_id: branchId,
      p_supplier_id: params.supplierId,
      p_items: params.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      })),
      p_invoice_number: params.invoiceNumber ?? null,
      p_note: params.note ?? null,
      p_performed_by: params.performedBy ?? null
    });

    if (error) {
      throw new Error(error.message || "PURCHASE_DIRECT_FAILED");
    }

    const result = (data ?? {}) as { status?: string; idempotent?: boolean; purchaseOrderId?: string };
    return {
      status: String(result.status ?? ""),
      idempotent: result.idempotent === true,
      purchaseOrderId: String(result.purchaseOrderId ?? "")
    };
  }
}