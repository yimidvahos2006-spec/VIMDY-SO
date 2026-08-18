import { PendingCustomerOperation } from "../../../core/offline/PendingCustomerOperation";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * PendingCustomerOperationRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que PendingSaleRepository /
 * PendingInventoryAdjustmentRepository / PendingTableOperationRepository:
 * esta es la cola de clientes nuevos creados SIN internet en ESTE
 * dispositivo, mientras esperan poder sincronizarse de verdad. Es, por
 * definición, el dato que todavía no llegó a Supabase — el día que llega,
 * se borra de aquí, nunca se "migra".
 */
export class PendingCustomerOperationRepository extends IndexedDbRepository<PendingCustomerOperation> {
  protected storeName = "pendingCustomerOperations" as const;

  /** Solo las que siguen esperando o fallaron — no las que están sincronizando ahora mismo. */
  public async findSyncable(): Promise<PendingCustomerOperation[]> {
    const all = await this.findAll();
    return all
      .filter((operation) => operation.status === "PENDING_SYNC")
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
  }
}