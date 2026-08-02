import { PendingTableOperation } from "../../../core/offline/PendingTableOperation";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * PendingTableOperationRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que PendingSaleRepository /
 * PendingInventoryAdjustmentRepository: esta es la cola de aperturas/cierres
 * de mesa hechos SIN internet en ESTE dispositivo, mientras esperan poder
 * sincronizarse de verdad. Es, por definición, el dato que todavía no llegó
 * a Supabase — el día que llega, se borra de aquí, nunca se "migra".
 */
export class PendingTableOperationRepository extends IndexedDbRepository<PendingTableOperation> {
  protected storeName = "pendingTableOperations" as const;

  /** Solo las que siguen esperando o fallaron — no las que están sincronizando ahora mismo. */
  public async findSyncable(): Promise<PendingTableOperation[]> {
    const all = await this.findAll();
    return all.filter((op) => op.status === "PENDING_SYNC");
  }
}