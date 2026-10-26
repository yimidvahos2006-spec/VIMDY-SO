import { PendingPurchase } from "../../../core/offline/PendingPurchase";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * PendingPurchaseRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que PendingSaleRepository y
 * PendingInventoryAdjustmentRepository: esta es la cola de compras hechas en
 * ESTE dispositivo que todavía no se confirmaron en el servidor. Es, por
 * definición, el dato que aún no llegó a Supabase — el día que llega, se borra
 * de aquí, nunca se "migra".
 */
export class PendingPurchaseRepository extends IndexedDbRepository<PendingPurchase> {
  protected storeName = "pendingPurchases" as const;

  /** Solo las que siguen esperando turno — no las que están sincronizando ahora mismo. */
  public async findSyncable(): Promise<PendingPurchase[]> {
    const all = await this.findAll();
    return all
      .filter((purchase) => purchase.status === "PENDING_SYNC")
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
  }
}