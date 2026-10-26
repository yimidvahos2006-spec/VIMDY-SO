import { ObservableStore } from "../store/ObservableStore";
import {
  PendingPurchase,
  PendingPurchaseKind,
  buildPurchaseFingerprint,
  totalCostOf
} from "./PendingPurchase";
import type { PurchaseOrderItem } from "../entities/Entities";
import { PendingPurchaseRepository } from "../../infrastructure/di/repositories/PendingPurchaseRepository";
import { getCurrentBranchId, requireCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";

const repository = new PendingPurchaseRepository();

export interface PendingPurchasesSnapshot {
  readonly items: PendingPurchase[];
  /** false hasta que se hace la primera lectura de IndexedDB al arrancar. */
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingPurchasesSnapshot = { items: [], loaded: false };

/** Estados en los que la compra todavía no se confirmó ni se descartó: sirven para no duplicarla. */
const REUSABLE_STATUSES: readonly PendingPurchase["status"][] = ["PENDING_SYNC", "SYNCING", "FAILED"];

/**
 * pendingPurchasesStore
 * ---------------------------------------------------------------------------
 * Capa reactiva (ObservableStore) sobre PendingPurchaseRepository — mismo
 * patrón de pendingInventoryAdjustmentsStore, aplicado a Compras.
 *
 * `enqueue()` guarda la compra ANTES de llamar al servidor (patrón "outbox"):
 * así, aunque el navegador se cierre a mitad de la llamada, la compra y su
 * clave de idempotencia siguen en IndexedDB y el reintento usa el mismo id.
 *
 * Se auto-hidrata al importarse el módulo.
 */
class PendingPurchasesStore extends ObservableStore<PendingPurchasesSnapshot> {
  constructor() {
    super(EMPTY_SNAPSHOT);
    if (typeof indexedDB !== "undefined") {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const items = (await repository.findAll()).sort((a, b) => {
      const byDate = a.queuedAt.getTime() - b.queuedAt.getTime();
      return byDate !== 0 ? byDate : a.id.localeCompare(b.id);
    });
    this.publish({ items, loaded: true });
  }

  /** Lee directamente de la cola persistida solo las que esperan turno. */
  async findSyncable(): Promise<PendingPurchase[]> {
    return repository.findSyncable();
  }

  async findById(id: string): Promise<PendingPurchase | null> {
    return repository.findById(id);
  }

  /**
   * Busca una compra con el mismo contenido que todavía no se confirmó ni se
   * descartó. Si existe, quien registra debe REUSAR su id (su clave de
   * idempotencia) en vez de crear otra.
   */
  async findReusable(fingerprint: string): Promise<PendingPurchase | null> {
    const all = await repository.findAll();
    return (
      all.find(
        (purchase) =>
          purchase.fingerprint === fingerprint && REUSABLE_STATUSES.includes(purchase.status)
      ) ?? null
    );
  }

  /**
   * Guarda una compra en la cola local. `id` es la clave de idempotencia que
   * viaja al servidor (ver PendingPurchase.ts). Con `startSyncing` queda ya
   * como SYNCING (la va a enviar quien la registra ahora mismo) para que el
   * ciclo automático no la envíe al mismo tiempo.
   */
  async enqueue(params: {
    id: string;
    kind: PendingPurchaseKind;
    items: readonly PurchaseOrderItem[];
    supplierId?: string;
    invoiceNumber?: string;
    purchaseOrderId?: string;
    note?: string;
    performedBy?: string;
    summary: string;
    startSyncing?: boolean;
  }): Promise<PendingPurchase> {
    const existing = await repository.findById(params.id);
    const now = new Date();

    const pendingPurchase: PendingPurchase = {
      id: params.id,
      kind: params.kind,
      fingerprint: buildPurchaseFingerprint(params),
      items: params.items.map((item) => ({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: item.unitPrice
      })),
      supplierId: params.supplierId,
      invoiceNumber: params.invoiceNumber,
      purchaseOrderId: params.purchaseOrderId,
      note: params.note,
      performedBy: params.performedBy,
      summary: params.summary,
      totalCost: totalCostOf(params.items),
      status: params.startSyncing ? "SYNCING" : "PENDING_SYNC",
      queuedAt: existing?.queuedAt ?? now,
      attempts: (existing?.attempts ?? 0) + (params.startSyncing ? 1 : 0),
      lastAttemptAt: params.startSyncing ? now : existing?.lastAttemptAt,
      lastError: existing?.lastError,
      businessId: requireCurrentBusinessId(),
      branchId: getCurrentBranchId() ?? ""
    };

    await repository.save(pendingPurchase);
    await this.refresh();

    return pendingPurchase;
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

  /** El intento falló sin poder confirmarse: registra el motivo y la saca del ciclo automático. */
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

  /** Vuelve a dejarla disponible para el próximo ciclo (falló la red, o reintento manual). */
  async requeue(id: string, lastError?: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({
      ...current,
      status: "PENDING_SYNC",
      lastError: lastError ?? current.lastError
    });
    await this.refresh();
  }

  /** La compra ya quedó confirmada en Supabase (o se descartó por error de negocio): sale de la cola. */
  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  /** Vuelve a poner en cola las que quedaron en SYNCING por un cierre/recarga abrupta. */
  async recoverStuckSyncing(): Promise<void> {
    const items = await repository.findAll();
    const stuck = items.filter((purchase) => purchase.status === "SYNCING");

    if (stuck.length === 0) return;

    await Promise.all(
      stuck.map((purchase) => repository.update({ ...purchase, status: "PENDING_SYNC" }))
    );

    await this.refresh();
  }

  /** Compras que siguen esperando turno para sincronizarse (no las que ya están en curso). */
  syncable(): PendingPurchase[] {
    return this.snapshot.items.filter((purchase) => purchase.status === "PENDING_SYNC");
  }

  list(): PendingPurchase[] {
    return this.snapshot.items;
  }

  /** Cuántas compras hay en la cola en total. */
  count(): number {
    return this.snapshot.items.length;
  }

  async clear(): Promise<void> {
    await repository.clear();
    await this.refresh();
  }
}

export const pendingPurchasesStore = new PendingPurchasesStore();