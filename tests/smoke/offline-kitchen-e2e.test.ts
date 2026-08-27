// tests/smoke/offline-kitchen-e2e.test.ts
/* ===========================================================================
   SMOKE TEST — Cocina offline (cola local + sincronización)
   ---------------------------------------------------------------------------
   Cubre el flujo offline-first para comandas de cocina:

     1. Simula caída de red (navigator.onLine = false, Supabase inalcanzable).
     2. Crea una orden de cocina.
     3. Verifica que se encola en pending con estado PENDING_SYNC.
     4. Simula recuperación de red.
     5. Ejecuta sync.
     6. Verifica que la orden se envió a Supabase (kitchenEngine.save()).

   Usa engines reales con dobles de prueba en memoria, sin tocar Supabase.
   =========================================================================== */

import { describe, it, expect, beforeEach, vi } from "vitest";

import { KitchenOrder } from "../../src/core/entities/Entities";
import { KitchenEngine } from "../../src/core/engines/KitchenEngine";
import { AuditEngine } from "../../src/core/engines/AuditEngine";
import { InMemoryRepository } from "../fakes/InMemoryRepository";

let mockOnline = false;
let mockKitchenEngine: KitchenEngine;

vi.mock("../../src/infrastructure/di/CompositionRoot", () => ({
  container: {
    get productsReady() {
      return Promise.resolve();
    },
    get kitchenEngine() {
      return { get: () => mockKitchenEngine };
    }
  }
}));

vi.mock("../../src/infrastructure/supabase/supabaseClient", () => ({
  supabase: { from: vi.fn() },
  getCurrentBusinessId: vi.fn(() => "biz-1"),
  getCurrentBranchId: vi.fn(() => "branch-1"),
  requireCurrentBusinessId: vi.fn(() => "biz-1"),
  requireCurrentBranchId: vi.fn(() => "branch-1"),
  setCurrentBusinessId: vi.fn(),
  setCurrentBranchId: vi.fn(),
  checkSupabaseReachable: vi.fn()
}));

vi.mock("../../src/core/store/connectionStore", () => ({
  connectionStore: {
    isOnline: vi.fn(() => mockOnline),
    subscribe: vi.fn(() => () => {})
  }
}));

vi.mock("../../src/core/store/productCatalogStore", () => ({
  productCatalogStore: {
    refresh: vi.fn(() => Promise.resolve())
  }
}));

vi.mock("../../src/core/store/toastStore", () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn()
  }
}));

vi.mock("../../src/core/VimdyCore", () => ({
  vimdyCore: {
    emit: vi.fn()
  }
}));

vi.mock("../../src/infrastructure/logging/opsLogger", () => ({
  logError: vi.fn()
}));

vi.mock("../../src/infrastructure/di/repositories/PendingKitchenOrderRepository", () => {
  const store: any[] = [];

  return {
    PendingKitchenOrderRepository: class {
      async findAll() { return [...store]; }
      async findById(id: string) { return store.find((i) => i.id === id) || null; }
      async findSyncable() {
        return store
          .filter((i) => i.status === "PENDING_SYNC")
          .sort((a, b) => a.queuedAt.getTime() - b.queuedAt.getTime());
      }
      async save(item: any) {
        const idx = store.findIndex((i) => i.id === item.id);
        if (idx >= 0) store[idx] = item;
        else store.push(item);
      }
      async update(item: any) {
        const idx = store.findIndex((i) => i.id === item.id);
        if (idx >= 0) store[idx] = item;
      }
      async delete(id: string) {
        const idx = store.findIndex((i) => i.id === id);
        if (idx >= 0) store.splice(idx, 1);
      }
      async clear() { store.length = 0; }
    }
  };
});

import { queueKitchenOrderOffline } from "../../src/core/offline/offlineKitchen";
import { syncPendingKitchenOrders, startOfflineKitchenSync, stopOfflineKitchenSync } from "../../src/core/offline/syncPendingKitchenOrders";
import { pendingKitchenOrdersStore } from "../../src/core/offline/pendingKitchenOrdersStore";

const KITCHEN_ORDER: KitchenOrder = {
  id: "kitchen-order-e2e-1",
  items: [{ productId: "prod-burger", quantity: 1, price: 18000 }],
  status: "PENDIENTE",
  createdAt: new Date(),
  businessId: "biz-1",
  branchId: "branch-1"
};

describe("Smoke: cocina offline (cola local + sincronización)", () => {
  beforeEach(() => {
    mockOnline = false;
    pendingKitchenOrdersStore.clear();

    const repository = new InMemoryRepository<KitchenOrder>("kitchen_orders");
    mockKitchenEngine = new KitchenEngine(repository as any, new AuditEngine({} as any));
  });

  it("simula caída de red: la orden se encola en pending y no se pierde", async () => {
    mockOnline = false;

    await queueKitchenOrderOffline(KITCHEN_ORDER);

    const pending = pendingKitchenOrdersStore.list();
    expect(pending).toHaveLength(1);
    expect(pending[0].status).toBe("PENDING_SYNC");
    expect(pending[0].order.id).toBe(KITCHEN_ORDER.id);
    expect(pending[0].businessId).toBe("biz-1");
    expect(pending[0].branchId).toBe("branch-1");

    const saved = await mockKitchenEngine.getById(KITCHEN_ORDER.id);
    expect(saved).toBeNull();
  });

  it("simula recuperación de red: sync envía la orden a Supabase y la cola queda vacía", async () => {
    mockOnline = false;
    await queueKitchenOrderOffline(KITCHEN_ORDER);

    const pendingBefore = pendingKitchenOrdersStore.list();
    expect(pendingBefore).toHaveLength(1);

    mockOnline = true;
    await syncPendingKitchenOrders();

    const pendingAfter = pendingKitchenOrdersStore.list();
    expect(pendingAfter).toHaveLength(0);

    const saved = await mockKitchenEngine.getById(KITCHEN_ORDER.id);
    expect(saved).not.toBeNull();
    expect(saved!.id).toBe(KITCHEN_ORDER.id);
    expect(saved!.status).toBe("PENDIENTE");
  });

  it("startOfflineKitchenSync / stopOfflineKitchenSync no lanzan error", () => {
    expect(() => startOfflineKitchenSync()).not.toThrow();
    expect(() => stopOfflineKitchenSync()).not.toThrow();
  });
});
