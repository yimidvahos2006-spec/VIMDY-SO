import type { KitchenOrder } from "../../../core/entities/Entities";
import { SupabaseRepository } from "./SupabaseRepository";
import { getCurrentBranchId, getCurrentBusinessId, supabase } from "../../supabase/supabaseClient";

interface KitchenRpcResult {
  success?: boolean;
  idempotent?: boolean;
  error?: string;
  order?: Record<string, unknown>;
  version?: number;
}

export interface KitchenOrderMoveTarget {
  tableId: string;
  orderId?: string;
  origin?: string;
  tableSessionId?: string;
}

/**
 * KitchenOrderRepository
 * ---------------------------------------------------------------------------
 * Las tablas de cocina son de solo lectura para el cliente. Todas las
 * escrituras pasan por RPC de Postgres con autorización, sucursal y versión
 * validadas en el servidor. No se permite fallback a INSERT/UPDATE/DELETE
 * directo aunque una política futura conceda accidentalmente esos permisos.
 */
export class KitchenOrderRepository extends SupabaseRepository<KitchenOrder> {
  protected tableName = "kitchen_orders" as const;

  public override async save(order: KitchenOrder): Promise<void> {
    await this.createAtomic(order);
  }

  public override async update(_order: KitchenOrder): Promise<void> {
    throw new Error("KITCHEN_DIRECT_UPDATE_DISABLED: usa una mutación atómica de cocina.");
  }

  public override async delete(_id: string): Promise<void> {
    throw new Error("KITCHEN_ORDER_DELETE_DISABLED: el historial de cocina no se borra desde el cliente.");
  }

  public async createAtomic(order: KitchenOrder): Promise<KitchenOrder> {
    const { businessId, branchId } = this.requireContext(order);
    const { data, error } = await supabase.rpc("create_kitchen_order_atomic", {
      p_business_id: businessId,
      p_branch_id: branchId,
      p_order: order as any,
    });

    if (error) {
      throw new Error(`KITCHEN_CREATE_RPC_FAILED (${error.code ?? "UNKNOWN"}): ${error.message}`);
    }
    return this.parseRpcOrder(data as KitchenRpcResult, "KITCHEN_CREATE_RPC_INVALID_RESPONSE");
  }

  public async transitionAtomic(
    order: KitchenOrder,
    nextStatus: KitchenOrder["status"],
    cancelReason?: string,
  ): Promise<KitchenOrder> {
    const { businessId, branchId } = this.requireContext(order);
    const expectedVersion = await this.requireExpectedVersion(order);
    const { data, error } = await supabase.rpc("update_kitchen_order_status_atomic", {
      p_business_id: businessId,
      p_branch_id: branchId,
      p_order_id: order.id,
      p_expected_version: expectedVersion,
      p_new_status: nextStatus,
      p_cancel_reason: cancelReason?.trim() || null,
    });

    if (error) {
      throw new Error(`KITCHEN_STATUS_RPC_FAILED (${error.code ?? "UNKNOWN"}): ${error.message}`);
    }
    return this.parseRpcOrder(data as KitchenRpcResult, "KITCHEN_STATUS_RPC_INVALID_RESPONSE");
  }

  public async moveAtomic(
    order: KitchenOrder,
    target: KitchenOrderMoveTarget,
  ): Promise<KitchenOrder> {
    const { businessId, branchId } = this.requireContext(order);
    const expectedVersion = await this.requireExpectedVersion(order);
    if (!target.tableId) {
      throw new Error("KITCHEN_TARGET_TABLE_REQUIRED");
    }

    const { data, error } = await supabase.rpc("move_kitchen_order_atomic", {
      p_business_id: businessId,
      p_branch_id: branchId,
      p_order_id: order.id,
      p_expected_version: expectedVersion,
      p_target_table_id: target.tableId,
      p_target_order_id: target.orderId || null,
      p_target_origin: target.origin || null,
      p_target_table_session_id: target.tableSessionId || null,
    });

    if (error) {
      throw new Error(`KITCHEN_MOVE_RPC_FAILED (${error.code ?? "UNKNOWN"}): ${error.message}`);
    }
    return this.parseRpcOrder(data as KitchenRpcResult, "KITCHEN_MOVE_RPC_INVALID_RESPONSE");
  }

  private requireContext(order: KitchenOrder): { businessId: string; branchId: string } {
    const businessId = order.businessId || getCurrentBusinessId();
    const branchId = order.branchId || getCurrentBranchId();
    if (!businessId || !branchId) {
      throw new Error("KITCHEN_CONTEXT_REQUIRED: falta el negocio o la sucursal activa.");
    }
    return { businessId, branchId };
  }

  private async requireExpectedVersion(order: KitchenOrder): Promise<number> {
    if (Number.isInteger(order.version) && (order.version as number) > 0) {
      return order.version as number;
    }
    const current = await this.findById(order.id);
    if (!current) throw new Error("KITCHEN_ORDER_NOT_FOUND");
    if (!Number.isInteger(current.version) || (current.version as number) < 1) {
      throw new Error("KITCHEN_ORDER_VERSION_MISSING");
    }
    return current.version as number;
  }

  private parseRpcOrder(result: KitchenRpcResult | null, errorCode: string): KitchenOrder {
    if (!result || result.success !== true || !result.order || typeof result.order !== "object") {
      const detail = result?.error ? `: ${result.error}` : "";
      throw new Error(`${errorCode}${detail}`);
    }
    const version = Number(result.version);
    if (!Number.isInteger(version) || version < 1) {
      throw new Error(`${errorCode}: versión ausente o inválida.`);
    }

    const raw = result.order;
    const createdAt = this.parseDate(raw.createdAt, "createdAt");
    const deliveredAt = raw.deliveredAt == null || raw.deliveredAt === ""
      ? undefined
      : this.parseDate(raw.deliveredAt, "deliveredAt");
    return {
      ...raw,
      version,
      createdAt,
      ...(deliveredAt ? { deliveredAt } : {}),
    } as unknown as KitchenOrder;
  }

  private parseDate(value: unknown, fieldName: string): Date {
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(String(value ?? ""));
    if (Number.isNaN(date.getTime())) {
      throw new Error(`KITCHEN_RPC_INVALID_DATE: ${fieldName} no es una fecha válida.`);
    }
    return date;
  }
}
