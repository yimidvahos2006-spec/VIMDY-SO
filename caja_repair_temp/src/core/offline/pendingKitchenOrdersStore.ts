import { ObservableStore } from "../store/ObservableStore";
import { PendingKitchenOrder } from "./PendingKitchenOrder";
import { PendingKitchenOrderRepository } from "../../infrastructure/di/repositories/PendingKitchenOrderRepository";
import { KitchenOrder } from "../entities/Entities";
import { getCurrentBranchId, requireCurrentBusinessId } from "../../infrastructure/supabase/supabaseClient";

const repository = new PendingKitchenOrderRepository();

export interface PendingKitchenOrdersSnapshot {
  readonly items: PendingKitchenOrder[];
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingKitchenOrdersSnapshot = { items: [], loaded: false };

class PendingKitchenOrdersStore extends ObservableStore<PendingKitchenOrdersSnapshot> {
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

  async findSyncable(): Promise<PendingKitchenOrder[]> {
    return repository.findSyncable();
  }

  async enqueue(order: KitchenOrder): Promise<PendingKitchenOrder> {
    const existing = await repository.findById(order.id);

    const pendingKitchenOrder: PendingKitchenOrder = {
      id: order.id,
      order,
      status: "PENDING_SYNC",
      queuedAt: existing?.queuedAt ?? new Date(),
      attempts: existing?.attempts ?? 0,
      lastAttemptAt: existing?.lastAttemptAt,
      lastError: existing?.lastError,
      businessId: requireCurrentBusinessId(),
      branchId: getCurrentBranchId() ?? ""
    };

    await repository.save(pendingKitchenOrder);
    await this.refresh();

    return pendingKitchenOrder;
  }

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

  async requeue(id: string): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({ ...current, status: "PENDING_SYNC" });
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  async recoverStuckSyncing(): Promise<void> {
    const items = await repository.findAll();
    const stuck = items.filter((item) => item.status === "SYNCING");

    if (stuck.length === 0) return;

    await Promise.all(
      stuck.map((item) => repository.update({ ...item, status: "PENDING_SYNC" }))
    );

    await this.refresh();
  }

  syncable(): PendingKitchenOrder[] {
    return this.snapshot.items.filter((item) => item.status === "PENDING_SYNC");
  }

  list(): PendingKitchenOrder[] {
    return this.snapshot.items;
  }

  count(): number {
    return this.snapshot.items.length;
  }

  async clear(): Promise<void> {
    await repository.clear();
    await this.refresh();
  }
}

export const pendingKitchenOrdersStore = new PendingKitchenOrdersStore();
