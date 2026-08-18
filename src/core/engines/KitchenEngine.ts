import { KitchenOrder } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { AuditEngine } from './AuditEngine';
import { vimdyCore } from '../VimdyCore';
import { getCurrentBusinessId, getCurrentBranchId } from '../../infrastructure/supabase/supabaseClient';

/** Motivos de cancelación permitidos desde la pantalla de Cocina. */
export const KITCHEN_CANCEL_REASONS = [
  'Cliente canceló',
  'Error',
  'Producto agotado',
  'Otro'
] as const;

export type KitchenCancelReason = (typeof KITCHEN_CANCEL_REASONS)[number];

export class KitchenEngine {
  constructor(
    private readonly repository: IRepository<KitchenOrder>,
    private readonly audit: AuditEngine
  ) {}

  public async getActiveOrders(): Promise<KitchenOrder[]> {
    const orders = await this.repository.findAll();
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return orders.filter(order => {
      if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return false;
      if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return false;
      return order.status !== 'ENTREGADO';
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
    const order = await this.repository.findById(id);

    if (!order) {
      throw new Error('ORDER_NOT_FOUND');
    }

    const updated: KitchenOrder = {
      ...order,
      status,
      // Se fija una sola vez, al momento real en que se marca ENTREGADO
      // (no se recalcula si por algún motivo updateStatus se vuelve a
      // llamar con ENTREGADO sobre una comanda que ya lo tenía).
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
   * Notifica al bus global de VIMDY. Cualquier componente puede
   * suscribirse con `useVimdyEvent("kitchen", handler)` para reaccionar
   * de inmediato cuando Caja, Meseros o Pedidos envían o actualizan una
   * comanda, sin necesidad de refrescar la página.
   */
  private emit(action: string, payload: unknown): void {
    vimdyCore.emit('kitchen', { action, payload });
  }
}