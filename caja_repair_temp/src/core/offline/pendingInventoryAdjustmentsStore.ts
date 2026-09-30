import { ObservableStore } from "../store/ObservableStore";
import {
  PendingInventoryAdjustment,
  PendingInventoryAdjustmentType
} from "./PendingInventoryAdjustment";
import { PendingInventoryAdjustmentRepository } from "../../infrastructure/di/repositories/PendingInventoryAdjustmentRepository";
import { LossCategory } from "../entities/Entities";
import { getCurrentBranchId, requireCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";

const repository = new PendingInventoryAdjustmentRepository();

export interface PendingInventoryAdjustmentsSnapshot {
  readonly items: PendingInventoryAdjustment[];
  /** false hasta que se hace la primera lectura de IndexedDB al arrancar. */
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingInventoryAdjustmentsSnapshot = { items: [], loaded: false };

/**
 * pendingInventoryAdjustmentsStore
 * ---------------------------------------------------------------------------
 * PASO 1.7 del plan offline: capa reactiva (ObservableStore) sobre
 * PendingInventoryAdjustmentRepository — mismo patrón exacto que
 * pendingSalesStore, aplicado a ajustes de inventario en vez de ventas.
 *
 * `enqueue()` lo llama offlineInventory.ts (equivalente a offlineSale.ts)
 * cuando InventoryEngine.increaseStock()/decreaseStock() falla por red;
 * syncPendingInventoryAdjustments.ts usa `list()`/`markSyncing()`/
 * `markFailed()`/`remove()`; y cualquier pantalla puede leer el snapshot
 * (ver usePendingInventoryAdjustmentsQueue.ts) para mostrar cuántos ajustes
 * faltan por sincronizar.
 *
 * Se auto-hidrata al importarse el módulo (igual que pendingSalesStore).
 */
class PendingInventoryAdjustmentsStore extends ObservableStore<PendingInventoryAdjustmentsSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
    if (typeof indexedDB !== "undefined") {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const items = await repository.findAll();
    this.publish({ items, loaded: true });
  }

  /** Vuelve a leer directamente de la cola persistida para obtener solo los pendientes. */
  async findSyncable(): Promise<PendingInventoryAdjustment[]> {
    return repository.findSyncable();
  }

  /**
   * Guarda un ajuste de inventario hecho offline en la cola local. `id` es
   * la misma clave de idempotencia que viaja hasta
   * InventoryEngine.increaseStock()/decreaseStock() como `movementId` (ver
   * checklist de idempotencia en PendingInventoryAdjustment.ts).
   */
  async enqueue(params: {
    id: string;
    productId: string;
    productName: string;
    type: PendingInventoryAdjustmentType;
    quantity: number;
    reason: string;
    performedBy?: string;
    supplierId?: string;
    purchasePrice?: number;
    lossCategory?: LossCategory;
  }): Promise<PendingInventoryAdjustment> {
    const existing = await repository.findById(params.id);

    const pendingAdjustment: PendingInventoryAdjustment = {
      id: params.id,
      productId: params.productId,
      productName: params.productName,
      type: params.type,
      quantity: params.quantity,
      reason: params.reason,
      performedBy: params.performedBy,
      supplierId: params.supplierId,
      purchasePrice: params.purchasePrice,
      lossCategory: params.lossCategory,
      status: "PENDING_SYNC",
      queuedAt: existing?.queuedAt ?? new Date(),
      attempts: existing?.attempts ?? 0,
      lastAttemptAt: existing?.lastAttemptAt,
      lastError: existing?.lastError,
      businessId: requireCurrentBusinessId(),
      branchId: getCurrentBranchId() ?? ""
    };

    await repository.save(pendingAdjustment);
    await this.refresh();

    return pendingAdjustment;
  }

  /** Antes de reintentar contra el servidor: marca "sincronizando" y suma un intento. */
  async markSyncing(id: string): Promise<boolean> {
    const current = await repository.findById(id);
    if (!current) return false;

    await repository.update({
      ...current,
      status: "SYNCING",
      attempts: current.attempts + 1,
      lastAttemptAt: new Date()
    });
    await this.refresh();
    return true;
  }

  /** El intento de sincronización falló: registra el motivo y lo saca del ciclo automático. */
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

  /** Error permanente de negocio: ya no se reintentará automáticamente. */
  async markPermanentFailure(id: string, error: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({
      ...current,
      status: "PERMANENT_FAILURE",
      lastError: error,
      lastAttemptAt: new Date()
    });
    await this.refresh();
  }

  /** Vuelve a dejarlo disponible para el próximo ciclo de sincronización (ej. reintento manual). */
  async requeue(id: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({ ...current, status: "PENDING_SYNC" });
    await this.refresh();
  }

  /** El ajuste ya se sincronizó de verdad contra Supabase: sale de la cola para siempre. */
  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  /** Vuelve a poner en cola los ajustes que quedaron en SYNCING por un cierre/recarga abrupta. */
  async recoverStuckSyncing(): Promise<void> {
    const items = await repository.findAll();
    const stuck = items.filter((adjustment) => adjustment.status === "SYNCING");

    if (stuck.length === 0) return;

    await Promise.all(
      stuck.map((adjustment) =>
        repository.update({ ...adjustment, status: "PENDING_SYNC" })
      )
    );

    await this.refresh();
  }

  /** Ajustes que siguen esperando turno para sincronizarse (no los que ya están en curso). */
  syncable(): PendingInventoryAdjustment[] {
    return this.snapshot.items.filter((adjustment) => adjustment.status === "PENDING_SYNC");
  }

  list(): PendingInventoryAdjustment[] {
    return this.snapshot.items;
  }

  /** Cuántos ajustes hay en la cola en total. */
  count(): number {
    return this.snapshot.items.length;
  }

  async clear(): Promise<void> {
    await repository.clear();
    await this.refresh();
  }
}

export const pendingInventoryAdjustmentsStore = new PendingInventoryAdjustmentsStore();