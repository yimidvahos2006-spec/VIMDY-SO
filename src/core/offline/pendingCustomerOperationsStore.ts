import { ObservableStore } from "../store/ObservableStore";
import { PendingCustomerOperation } from "./PendingCustomerOperation";
import { PendingCustomerOperationRepository } from "../../infrastructure/di/repositories/PendingCustomerOperationRepository";
import { Customer } from "../entities/Entities";

const repository = new PendingCustomerOperationRepository();

export interface PendingCustomerOperationsSnapshot {
  readonly items: PendingCustomerOperation[];
  /** false hasta que se hace la primera lectura de IndexedDB al arrancar. */
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingCustomerOperationsSnapshot = { items: [], loaded: false };

/**
 * pendingCustomerOperationsStore
 * ---------------------------------------------------------------------------
 * PASO 1.9 del plan offline: capa reactiva (ObservableStore) sobre
 * PendingCustomerOperationRepository — mismo patrón exacto que
 * pendingSalesStore/pendingInventoryAdjustmentsStore/
 * pendingTableOperationsStore, aplicado a clientes nuevos en vez de ventas
 * de mostrador, ajustes de inventario o aperturas/cierres de mesa.
 *
 * `enqueue()` lo llama offlineCustomer.ts cuando CustomerEngine.save()
 * falla por red (o directamente no hay conexión); syncPendingCustomerOperations.ts
 * usa `list()`/`markSyncing()`/`markFailed()`/`remove()`; y cualquier
 * pantalla puede leer el snapshot (ver Paso 1.10, banner "offline elegante"
 * en Clientes) para mostrar cuántos clientes faltan por sincronizar.
 *
 * Se auto-hidrata al importarse el módulo (igual que las otras tres colas).
 */
class PendingCustomerOperationsStore extends ObservableStore<PendingCustomerOperationsSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
    void this.refresh();
  }

  async refresh(): Promise<void> {
    const items = await repository.findAll();
    this.publish({ items, loaded: true });
  }

  /**
   * Guarda un cliente creado offline en la cola local. `customer.id` debe
   * venir ya generado por el llamador (crypto.randomUUID(), igual que hace
   * useCustomers.ts hoy para la creación online) — es la misma clave de
   * idempotencia que evita duplicar el cliente cuando esta operación se
   * sincronice de verdad.
   */
  async enqueue(customer: Customer): Promise<PendingCustomerOperation> {
    const pendingOperation: PendingCustomerOperation = {
      id: customer.id,
      customer,
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

  /** El cliente ya se sincronizó de verdad contra Supabase: sale de la cola para siempre. */
  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  /** Clientes que siguen esperando turno para sincronizarse (no los que ya están en curso). */
  syncable(): PendingCustomerOperation[] {
    return this.snapshot.items.filter((op) => op.status === "PENDING_SYNC");
  }

  list(): PendingCustomerOperation[] {
    return this.snapshot.items;
  }

  /** Cuántos clientes hay en la cola en total. */
  count(): number {
    return this.snapshot.items.length;
  }
}

export const pendingCustomerOperationsStore = new PendingCustomerOperationsStore();