import { PendingInventoryAdjustment } from "../../../core/offline/PendingInventoryAdjustment";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * PendingInventoryAdjustmentRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que PendingSaleRepository: esta
 * es la cola de ajustes de inventario hechos SIN internet en ESTE
 * dispositivo, mientras esperan poder sincronizarse de verdad. Es, por
 * definición, el dato que todavía no llegó a Supabase — el día que llega,
 * se borra de aquí, nunca se "migra".
 */
export class PendingInventoryAdjustmentRepository extends IndexedDbRepository<PendingInventoryAdjustment> {
  protected storeName = "pendingInventoryAdjustments" as const;

  /** Solo los que siguen esperando o fallaron — no los que están sincronizando ahora mismo. */
  public async findSyncable(): Promise<PendingInventoryAdjustment[]> {
    const all = await this.findAll();
    return all.filter((adjustment) => adjustment.status === "PENDING_SYNC");
  }
}