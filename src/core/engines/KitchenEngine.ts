import { KitchenOrder } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { AuditEngine } from './AuditEngine';
import { vimdyCore } from '../VimdyCore';
import { getCurrentBusinessId, getCurrentBranchId } from '../../infrastructure/supabase/supabaseClient';

/** Motivos de cancelación permitidos desde la pantalla de Cocina. */
export const KITCHEN_CANCEL_REASONS = [
  'kitchen.cancel.reason.clientCanceled',
  'kitchen.cancel.reason.error',
  'kitchen.cancel.reason.outOfStock',
  'kitchen.cancel.reason.other'
] as const;

export type KitchenCancelReason = (typeof KITCHEN_CANCEL_REASONS)[number];

export class KitchenEngine {
  constructor(
    private readonly repository: IRepository<KitchenOrder>,
    private readonly audit: AuditEngine
  ) {}

  private readonly validTransitions: Record<string, readonly string[]> = {
    PENDIENTE: ["EN_PREPARACION", "CANCELADO"],
    EN_PREPARACION: ["LISTO", "CANCELADO"],
    LISTO: ["ENTREGADO", "CANCELADO"],
    ENTREGADO: [],
    CANCELADO: []
  };

  public async getActiveOrders(): Promise<KitchenOrder[]> {
    const orders = await this.repository.findAll();
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return orders.filter(order => {
      if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return false;
      if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return false;
      return order.status !== "ENTREGADO" && order.status !== "CANCELADO";
    });
  }

  public async getDeliveredOrders(): Promise<KitchenOrder[]> {
    const orders = await this.repository.findAll();
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return orders
      .filter(order => {
        if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return false;
        if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return false;
        return order.status === 'ENTREGADO';
      })
      .sort((a, b) => {
        const aTime = new Date(a.deliveredAt ?? a.createdAt).getTime();
        const bTime = new Date(b.deliveredAt ?? b.createdAt).getTime();
        return bTime - aTime;
      });
  }

  public async getAll(): Promise<KitchenOrder[]> {
    const orders = await this.repository.findAll();
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return orders.filter(order => {
      if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return false;
      if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return false;
      return true;
    });
  }

  public async getById(id: string): Promise<KitchenOrder | null> {
    const order = await this.repository.findById(id);
    if (!order) return null;

    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();
    if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return null;
    if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return null;

    return order;
  }

  public async save(order: KitchenOrder): Promise<void> {
    await this.repository.save(order);
    this.emit('kitchen.order_created', order);
  }

  public async getByTableId(tableId: string): Promise<KitchenOrder[]> {
    const orders = await this.getAll();
    return orders.filter(order => order.tableId === tableId);
  }

  public async getByOrderId(orderId: string): Promise<KitchenOrder[]> {
    const orders = await this.getAll();
    return orders.filter(order => order.orderId === orderId);
  }

  public async updateStatus(
    id: string,
    status: KitchenOrder['status']
  ): Promise<void> {
    const order = await this.getById(id);

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    if (order.status === 'ENTREGADO' || order.status === 'CANCELADO') {
      throw new Error(
        `ORDER_LOCKED: la comanda ya está en estado "${order.status}" y no se puede modificar.`
      );
    }

    const allowed = this.validTransitions[order.status] ?? [];
    if (!allowed.includes(status)) {
      throw new Error(
        `INVALID_STATUS_TRANSITION: no se puede cambiar de "${order.status}" a "${status}".`
      );
    }

    const updated: KitchenOrder = {
      ...order,
      status,
      deliveredAt:
        status === 'ENTREGADO'
          ? order.deliveredAt ?? new Date()
          : order.deliveredAt
    };

    await this.repository.update(updated);
    this.emit('kitchen.status_updated', updated);
  }

  public async delete(id: string): Promise<void> {
    await this.repository.delete(id);
    this.emit('kitchen.order_deleted', { id });
  }

  /**
   * Cancela una comanda desde Cocina. Nunca la borra (nunca llama a
   * `delete`): solo cambia su estado a CANCELADO y guarda el motivo, para
   * que siga apareciendo en el historial general con su razón visible.
   * Todo queda además en AuditEngine, de solo-anexado, por si el registro
   * en la propia comanda alguna vez se necesita contrastar.
   */
  public async cancelOrder(
    id: string,
    reason: string,
    actorId: string
  ): Promise<KitchenOrder> {
    const order = await this.repository.findById(id);

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    if (order.status === 'ENTREGADO' || order.status === 'CANCELADO') {
      throw new Error(
        `ORDER_CANNOT_BE_CANCELLED: la comanda ya está en estado "${order.status}".`
      );
    }

    if (!reason.trim()) {
      throw new Error('CANCEL_REASON_REQUIRED: hay que indicar un motivo de cancelación.');
    }

    const updated: KitchenOrder = {
      ...order,
      status: 'CANCELADO',
      cancelReason: reason.trim()
    };

    await this.repository.update(updated);

    await this.audit.log(
      actorId,
      'KITCHEN_ORDER_CANCELLED',
      'kitchen',
      `Comanda #${order.orderNumber ?? order.id.slice(0, 8)} (${order.origin ?? "Pedido"}) cancelada: ${reason.trim()}`,
      order.id
    );

    this.emit('kitchen.status_updated', updated);

    return updated;
  }

  /**
   * Re-apunta las comandas YA enviadas de una cuenta a otra mesa (al unir o
   * transferir). Sin esto, la mesa destino no sabe qué se mandó ya a cocina y
   * lo vuelve a enviar todo. Cocina además pasa a mostrar el nombre nuevo.
   *
   * Solo se mueven las comandas de la cuenta activa de `from` (mismo pedido o
   * misma sesión). Las canceladas se quedan como historial de la mesa vieja.
   * Devuelve una función para deshacer el movimiento si un paso posterior falla.
   */
  public async moveTableOrders(input: {
    from: { id: string; orderId?: string; openOperationId?: string; openedAt?: Date | string };
    to: { id: string; name: string; orderId?: string; openOperationId?: string };
  }): Promise<{ moved: number; undo: () => Promise<void> }> {
    const { from, to } = input;
    const fromSession = from.openOperationId ?? from.orderId ?? from.id;
    const toSession = to.openOperationId ?? to.orderId ?? to.id;
    const openedAt = from.openedAt ? new Date(from.openedAt).getTime() : null;

    const candidates = (await this.getByTableId(from.id)).filter((order) => {
      if (order.status === 'CANCELADO') return false;
      const extended = order as KitchenOrder & { tableSessionId?: string };
      if (from.orderId && order.orderId) return order.orderId === from.orderId;
      if (extended.tableSessionId) return extended.tableSessionId === fromSession;
      if (openedAt !== null) return new Date(order.createdAt).getTime() >= openedAt;
      return false;
    });

    const originals: KitchenOrder[] = [];
    try {
      for (const order of candidates) {
        const updated = {
          ...order,
          tableId: to.id,
          orderId: to.orderId ?? order.orderId,
          origin: to.name,
          tableSessionId: toSession
        } as KitchenOrder;
        await this.repository.update(updated);
        originals.push(order);
        this.emit('kitchen.status_updated', updated);
      }
    } catch (error) {
      await this.restoreMoved(originals);
      throw error;
    }

    return {
      moved: originals.length,
      undo: () => this.restoreMoved(originals)
    };
  }

  private async restoreMoved(originals: KitchenOrder[]): Promise<void> {
    for (const original of originals) {
      try {
        const current = await this.repository.findById(original.id);
        await this.repository.update({ ...original, version: current?.version ?? original.version } as KitchenOrder);
        this.emit('kitchen.status_updated', original);
      } catch {
        // Mejor esfuerzo: el llamador ya está manejando un fallo mayor.
      }
    }
  }

  /**
   * Cancela las comandas de cocina de una cuenta que todavía no se entregó.
   * Se usa al cancelar el pedido de una mesa para que cocina deje de preparar.
   */
  public async cancelOpenOrdersForTable(
    tableId: string,
    reason: string,
    actorId: string,
    scope: { orderId?: string; openedAt?: Date | string } = {}
  ): Promise<number> {
    const openedAt = scope.openedAt ? new Date(scope.openedAt).getTime() : null;
    const orders = (await this.getByTableId(tableId)).filter((order) => {
      if (order.status === 'ENTREGADO' || order.status === 'CANCELADO') return false;
      if (scope.orderId && order.orderId) return order.orderId === scope.orderId;
      if (openedAt !== null) return new Date(order.createdAt).getTime() >= openedAt;
      return true;
    });

    for (const order of orders) {
      await this.cancelOrder(order.id, reason, actorId);
    }
    return orders.length;
  }

  /** ¿Ya salió comida entregada de esta cuenta? Se usa para proteger la cancelación. */
  public async hasDeliveredOrders(
    tableId: string,
    scope: { orderId?: string; openedAt?: Date | string } = {}
  ): Promise<boolean> {
    const openedAt = scope.openedAt ? new Date(scope.openedAt).getTime() : null;
    return (await this.getByTableId(tableId)).some((order) => {
      if (order.status !== 'ENTREGADO') return false;
      if (scope.orderId && order.orderId) return order.orderId === scope.orderId;
      if (openedAt !== null) return new Date(order.createdAt).getTime() >= openedAt;
      return true;
    });
  }

  /**
   * Notifica al bus global de VIMDY. Cualquier componente puede
   * suscribirse con `useVimdyEvent("kitchen", handler)` para reaccionar
   * de inmediato cuando Caja, Meseros o Pedidos envían o actualizan una
   * comanda, sin necesidad de refrescar la página.
   */
  private emit(action: string, payload: unknown): void {
    vimdyCore.emit('kitchen', { action, payload });
  }
}