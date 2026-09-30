import { PendingKitchenOrder } from "../../../core/offline/PendingKitchenOrder";
import { IndexedDbRepository } from "./IndexedDbRepository";

export class PendingKitchenOrderRepository extends IndexedDbRepository<PendingKitchenOrder> {
  protected storeName = "pendingKitchenOrders" as const;

  public async findSyncable(): Promise<PendingKitchenOrder[]> {
    const all = await this.findAll();
    return all
      .filter((item) => item.status === "PENDING_SYNC")
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
  }
}
