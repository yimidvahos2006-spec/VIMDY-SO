import { PendingSale } from "../../../core/offline/PendingSale";
import { IndexedDbRepository } from "./IndexedDbRepository";

/**
 * PendingSaleRepository
 * ---------------------------------------------------------------------------
 * A propósito NO se migra a Supabase, igual que SessionRepository: esta
 * es la cola de ventas cobradas SIN internet en ESTE dispositivo,
 * mientras esperan poder sincronizarse de verdad. Es, por definición,
 * el dato que todavía no llegó a Supabase — el día que llega, se borra
 * de aquí (ver Parte 4), nunca se "migra".
 */
export class PendingSaleRepository extends IndexedDbRepository<PendingSale> {
  protected storeName = "pendingSales" as const;

  /** Solo las que siguen esperando o fallaron — no las que están sincronizando ahora mismo. */
  public async findSyncable(): Promise<PendingSale[]> {
    const all = await this.findAll();
    return all
      .filter((sale) => sale.status === "PENDING_SYNC")
      .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
  }
}