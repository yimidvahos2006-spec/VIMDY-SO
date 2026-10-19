import { KitchenOrder } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { AuditEngine } from './AuditEngine';
import { vimdyCore } from '../VimdyCore';
import { getCurrentBusinessId, getCurrentBranchId } from '../../infrastructure/supabase/supabaseClient';
import type { KitchenOrderMoveTarget } from '../../infrastructure/di/repositories/KitchenOrderRepository';

interface KitchenOrderRepositoryPort extends IRepository<KitchenOrder> {
  /** Present on the production Supabase repository; writes through an RPC. */
  createAtomic?(order: KitchenOrder): Promise<KitchenOrder>;
  /** Present on the production Supabase repository; writes through an RPC. */
  transitionAtomic?(order: KitchenOrder, nextStatus: KitchenOrder['status'], cancelReason?: string): Promise<KitchenOrder>;
  /** Present on the production Supabase repository; writes through an RPC. */
  moveAtomic?(order: KitchenOrder, target: KitchenOrderMoveTarget): Promise<KitchenOrder>;
}

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
    private readonly repository: KitchenOrderRepositoryPort,
    // En producción, KitchenOrderRepository ejecuta RPC transaccionales que
    // auditan con auth.uid(). AuditEngine se usa solamente con repositorios
    // alternativos que no implementan las mutaciones atómicas.
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
    let persisted: KitchenOrder;

    if (typeof this.repository.createAtomic === 'function') {
      // El repositorio de producción ejecuta la RPC transaccional.
      persisted = await this.repository.createAtomic(order);
    } else {
      // Respeta IRepository para implementaciones alternativas. En producción,
      // KitchenOrderRepository siempre expone createAtomic y nunca cae aquí.
      await this.repository.save(order);
      const stored = await this.repository.findById(order.id);
      if (!stored) throw new Error('KITCHEN_ORDER_SAVE_NOT_CONFIRMED');
      persisted = stored;
    }

    this.emit('kitchen.order_created', persisted);
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
    status: KitchenOrder['status'],
    reason?: string
  ): Promise<void> {
    const order = await this.getById(id);
    if (!order) throw new Error('ORDER_NOT_FOUND');

    if (order.status === 'ENTREGADO' || order.status === 'CANCELADO') {
      // Incluso repetir el estado terminal se rechaza; en particular, un
      // doble clic sobre ENTREGADO no vuelve a escribir deliveredAt.
      throw new Error(`ORDER_LOCKED: la comanda ya está en estado "${order.status}" y no se puede modificar.`);
    }

    const allowed = this.validTransitions[order.status] ?? [];
    if (order.status !== status && !allowed.includes(status)) {
      throw new Error(`INVALID_STATUS_TRANSITION: no se puede cambiar de "${order.status}" a "${status}".`);
    }
    if (status === 'CANCELADO' && !reason?.trim()) {
      throw new Error('CANCEL_REASON_REQUIRED: hay que indicar un motivo de cancelación.');
    }

    const updated = await this.persistTransition(order, status, reason?.trim());
    this.emit('kitchen.status_updated', updated);
  }

  /** El historial de Cocina es append-only; no se habilita el borrado físico. */
  public async delete(_id: string): Promise<void> {
    throw new Error('KITCHEN_ORDER_DELETE_DISABLED: el historial de cocina no se borra.');
  }

  /**
   * Cancela una comanda desde Cocina. Nunca la borra: la RPC transaccional
   * actualiza la comanda, sus líneas relacionadas, trabajos pendientes de
   * impresión y la auditoría con el actor autenticado real.
   */
  public async cancelOrder(
    id: string,
    reason: string,
    actorId: string
  ): Promise<KitchenOrder> {
    const order = await this.getById(id);
    if (!order) throw new Error('ORDER_NOT_FOUND');
    if (order.status === 'ENTREGADO' || order.status === 'CANCELADO') {
      throw new Error(`ORDER_CANNOT_BE_CANCELLED: la comanda ya está en estado "${order.status}".`);
    }
    if (!reason.trim()) {
      throw new Error('CANCEL_REASON_REQUIRED: hay que indicar un motivo de cancelación.');
    }
    // actorId se conserva por compatibilidad de API; la base de datos no
    // confía en este valor de navegador y audita exclusivamente auth.uid().
    void actorId;
    const usesAtomicRpc = typeof this.repository.transitionAtomic === 'function';
    const updated = await this.persistTransition(order, 'CANCELADO', reason.trim());
    if (!usesAtomicRpc) {
      // Adaptadores de repositorio alternativos guardan su auditoría mediante
      // el repositorio configurado. La implementación Supabase no llega aquí:
      // la RPC escribe el actor real de auth.uid() dentro de la transacción.
      await this.audit.log(
        actorId,
        'KITCHEN_ORDER_CANCELLED',
        'kitchen',
        `Comanda ${id} cancelada: ${reason.trim()}`,
        id
      );
    }
    this.emit('kitchen.status_updated', updated);
    return updated;
  }

  /**
   * Re-apunta las comandas ya enviadas de una cuenta a otra mesa. La versión,
   * el cambio de mesa y la auditoría se validan en una RPC server-side.
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
        const updated = await this.persistMove(order, {
          tableId: to.id,
          orderId: to.orderId ?? order.orderId,
          origin: to.name,
          tableSessionId: toSession,
        });
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
        if (!current || !original.tableId) continue;
        const originalExtended = original as KitchenOrder & { tableSessionId?: string };
        const updated = await this.persistMove(current, {
          tableId: original.tableId,
          orderId: original.orderId,
          origin: original.origin,
          tableSessionId: originalExtended.tableSessionId,
        });
        this.emit('kitchen.status_updated', updated);
      } catch {
        // El llamador ya está manejando un fallo mayor; se mantiene mejor
        // esfuerzo al deshacer varias comandas sin sobrescribir su estado.
      }
    }
  }

  /**
   * Persiste un cambio de estado. El repositorio de producción siempre usa
   * transitionAtomic (RPC); el contrato IRepository se admite para otros
   * adaptadores que implementan save/update y mantienen su propia persistencia.
   * No hay fallback tras un error de la RPC, para evitar duplicar una operación.
   */
  private async persistTransition(
    order: KitchenOrder,
    nextStatus: KitchenOrder['status'],
    cancelReason?: string
  ): Promise<KitchenOrder> {
    if (typeof this.repository.transitionAtomic === 'function') {
      return this.repository.transitionAtomic(order, nextStatus, cancelReason);
    }

    const nextOrder: KitchenOrder = {
      ...order,
      status: nextStatus,
      ...(nextStatus === 'ENTREGADO'
        ? { deliveredAt: order.deliveredAt ?? new Date() }
        : {}),
      ...(nextStatus === 'CANCELADO' && cancelReason
        ? { cancelReason }
        : {}),
    };
    await this.repository.update(nextOrder);
    const stored = await this.repository.findById(order.id);
    if (!stored) throw new Error('KITCHEN_ORDER_UPDATE_NOT_CONFIRMED');
    return stored;
  }

  /**
   * Persiste la reasignación de mesa. En producción siempre se usa moveAtomic
   * para validar versión, sucursal y auditoría en PostgreSQL.
   */
  private async persistMove(
    order: KitchenOrder,
    target: KitchenOrderMoveTarget
  ): Promise<KitchenOrder> {
    if (typeof this.repository.moveAtomic === 'function') {
      return this.repository.moveAtomic(order, target);
    }

    const nextOrder = {
      ...order,
      tableId: target.tableId,
      orderId: target.orderId ?? order.orderId,
      origin: target.origin ?? order.origin,
      tableSessionId: target.tableSessionId,
    } as KitchenOrder;
    await this.repository.update(nextOrder);
    const stored = await this.repository.findById(order.id);
    if (!stored) throw new Error('KITCHEN_ORDER_MOVE_NOT_CONFIRMED');
    return stored;
  }

  /** Cancela las comandas abiertas de una cuenta, conservando motivo e historial. */
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

  private emit(action: string, payload: unknown): void {
    vimdyCore.emit('kitchen', { action, payload });
  }
}
