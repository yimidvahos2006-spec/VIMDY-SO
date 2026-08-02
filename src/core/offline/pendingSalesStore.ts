import { ObservableStore } from "../store/ObservableStore";
import { PendingSale, QueuedSalePayment } from "./PendingSale";
import { PendingSaleRepository } from "../../infrastructure/di/repositories/PendingSaleRepository";
import { CreateSaleInput } from "../engines/SalesEngine";

const repository = new PendingSaleRepository();

export interface PendingSalesSnapshot {
  readonly items: PendingSale[];
  /** false hasta que se hace la primera lectura de IndexedDB al arrancar. */
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingSalesSnapshot = { items: [], loaded: false };

/**
 * pendingSalesStore
 * ---------------------------------------------------------------------------
 * Parte 2 del plan de ventas offline: capa reactiva (ObservableStore, igual
 * que productCatalogStore sobre InventoryEngine) sobre PendingSaleRepository.
 * La Parte 3 (processSale offline) llama a `enqueue()`, la Parte 4
 * (sincronización) usa `list()`/`markSyncing()`/`markFailed()`/`remove()`,
 * y la Parte 5 (banner del cajero) lee el snapshot para saber cuántas
 * ventas faltan por sincronizar sin tener que preguntar a IndexedDB cada
 * vez que se pinta la pantalla.
 *
 * Se auto-hidrata al importarse el módulo (igual que connectionStore):
 * si el cajero cerró la pestaña con ventas pendientes, el contador
 * arranca mostrando el número correcto desde el primer render.
 */
class PendingSalesStore extends ObservableStore<PendingSalesSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const items = await repository.findAll();
    this.publish({ items, loaded: true });
  }

  /**
   * Guarda una venta cobrada offline en la cola local. Llamar UNA sola
   * vez por intento de cobro offline — `createSaleInput.id` es la misma
   * clave de idempotencia que ya viaja hasta SalesEngine.createSale(),
   * así que reintentar el mismo cobro (mismo id) sobrescribe el mismo
   * registro en vez de duplicarlo en la cola.
   */
  async enqueue(params: {
    createSaleInput: CreateSaleInput;
    payment?: QueuedSalePayment;
    cashierName?: string;
  }): Promise<PendingSale> {
    if (!params.createSaleInput.id) {
      throw new Error(
        "PENDING_SALE_REQUIRES_ID: createSaleInput.id es obligatorio para encolar una venta offline (es la clave de idempotencia, ver checklist crítico #4)."
      );
    }

    const pendingSale: PendingSale = {
      id: params.createSaleInput.id,
      createSaleInput: params.createSaleInput,
      payment: params.payment,
      cashierName: params.cashierName,
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0
    };

    await repository.save(pendingSale);
    await this.refresh();

    return pendingSale;
  }

  /** Antes de reintentar contra el servidor (Parte 4): marca "sincronizando" y suma un intento. */
  async markSyncing(id: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({
      ...current,
      status: "SYNCING",
      attempts: current.attempts + 1,
      lastAttemptAt: new Date()
    });
    await this.refresh();
  }

  /** El intento de sincronización falló: registra el motivo y la saca del ciclo automático. */
  async markFailed(id: string, error: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({
      ...current,
      status: "FAILED",
      lastError: error,
      lastAttemptAt: new Date()
    });
    await this.refresh();
  }

  /** Vuelve a dejarla disponible para el próximo ciclo de sincronización (ej. reintento manual). */
  async requeue(id: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({ ...current, status: "PENDING_SYNC" });
    await this.refresh();
  }

  /** La venta ya se sincronizó de verdad contra Supabase: sale de la cola para siempre. */
  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  /** Ventas que siguen esperando turno para sincronizarse (no las que ya están en curso). */
  syncable(): PendingSale[] {
    return this.snapshot.items.filter((sale) => sale.status === "PENDING_SYNC");
  }

  list(): PendingSale[] {
    return this.snapshot.items;
  }

  /** Cuántas ventas hay en la cola en total (para el banner de la Parte 5). */
  count(): number {
    return this.snapshot.items.length;
  }
}

export const pendingSalesStore = new PendingSalesStore();