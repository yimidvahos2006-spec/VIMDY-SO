import { ObservableStore } from "../store/ObservableStore";
import { PendingTableOperation, PendingTableOperationType } from "./PendingTableOperation";
import { PendingTableOperationRepository } from "../../infrastructure/di/repositories/PendingTableOperationRepository";
import { OpenTableInput, CloseTableInput } from "../engines/TableEngine";

const repository = new PendingTableOperationRepository();

export interface PendingTableOperationsSnapshot {
  readonly items: PendingTableOperation[];
  /** false hasta que se hace la primera lectura de IndexedDB al arrancar. */
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingTableOperationsSnapshot = { items: [], loaded: false };

/**
 * pendingTableOperationsStore
 * ---------------------------------------------------------------------------
 * PASO 1.8 del plan offline: capa reactiva (ObservableStore) sobre
 * PendingTableOperationRepository — mismo patrón exacto que
 * pendingSalesStore/pendingInventoryAdjustmentsStore, aplicado a
 * aperturas/cierres de mesa en vez de ventas de mostrador o ajustes de
 * inventario.
 *
 * `enqueue()` lo llama offlineTable.ts cuando TableEngine.openTable()/
 * closeTable() falla por red; syncPendingTableOperations.ts usa
 * `list()`/`markSyncing()`/`markFailed()`/`remove()`; y cualquier pantalla
 * puede leer el snapshot (ver Paso 1.10, banner "offline elegante" en
 * Mesas) para mostrar cuántas operaciones faltan por sincronizar.
 *
 * Se auto-hidrata al importarse el módulo (igual que las otras dos colas).
 */
class PendingTableOperationsStore extends ObservableStore<PendingTableOperationsSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const items = await repository.findAll();
    this.publish({ items, loaded: true });
  }

  /**
   * Guarda una apertura o un cierre de mesa hecho offline en la cola
   * local. Para CLOSE, `closeInput.saleId` debe venir ya generado por el
   * llamador (ver nota de idempotencia en PendingTableOperation.ts).
   */
  async enqueue(params: {
    id: string;
    tableId: string;
    tableName: string;
    type: PendingTableOperationType;
    openInput?: OpenTableInput;
    closeInput?: CloseTableInput;
  }): Promise<PendingTableOperation> {
    const pendingOperation: PendingTableOperation = {
      id: params.id,
      tableId: params.tableId,
      tableName: params.tableName,
      type: params.type,
      openInput: params.openInput,
      closeInput: params.closeInput,
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0
    };

    await repository.save(pendingOperation);
    await this.refresh();

    return pendingOperation;
  }

  /** Antes de reintentar contra el servidor: marca "sincronizando" y suma un intento. */
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

  /** La operación ya se sincronizó de verdad contra Supabase: sale de la cola para siempre. */
  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  /** Operaciones que siguen esperando turno para sincronizarse (no las que ya están en curso). */
  syncable(): PendingTableOperation[] {
    return this.snapshot.items.filter((op) => op.status === "PENDING_SYNC");
  }

  list(): PendingTableOperation[] {
    return this.snapshot.items;
  }

  /** Cuántas operaciones hay en la cola en total. */
  count(): number {
    return this.snapshot.items.length;
  }
}

export const pendingTableOperationsStore = new PendingTableOperationsStore();