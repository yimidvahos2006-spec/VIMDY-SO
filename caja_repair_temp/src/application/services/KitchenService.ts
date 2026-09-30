import { KitchenEngine } from '../../core/engines/KitchenEngine';
import { KitchenOrder } from '../../core/entities/Entities';

export class KitchenService {
  constructor(
    private readonly engine: KitchenEngine
  ) {}

  public async getOrders(): Promise<KitchenOrder[]> {
    return await this.engine.getActiveOrders();
  }

  public async getHistory(): Promise<KitchenOrder[]> {
    return await this.engine.getDeliveredOrders();
  }

  public async updateStatus(
    id: string,
    status: KitchenOrder['status']
  ): Promise<void> {
    await this.engine.updateStatus(id, status);
  }

  public async cancelOrder(id: string, reason: string, actorId: string): Promise<KitchenOrder> {
    return await this.engine.cancelOrder(id, reason, actorId);
  }

  public async saveOrder(order: KitchenOrder): Promise<void> {
    await this.engine.save(order);
  }
}