import { ObservableStore } from "./ObservableStore";
import type { PendingKitchenOrder } from "../offline/PendingKitchenOrder";
import type { KitchenOrder } from "../entities/Entities";
import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import {
  getCurrentBranchId,
  requireCurrentBusinessId
} from "../../infrastructure/supabase/supabaseClient";

export interface PendingKitchenOrderRepositoryPort
  extends IRepository<PendingKitchenOrder> {
  findSyncable(): Promise<PendingKitchenOrder[]>;
  clear(): Promise<void>;
}

/**
 * Cuánto tiempo debe pasar antes de considerar un SYNCING abandonado.
 *
 * No recuperamos inmediatamente un registro SYNCING: otra pestaña puede
 * estar ejecutando una petición legítima. Si el navegador murió durante
 * esa petición, después de este TTL la operación vuelve a la cola.
 */
export const PENDING_KITCHEN_SYNC_LEASE_MS = 2 * 60 * 1000;

export interface PendingKitchenOrdersSnapshot {
  readonly items: PendingKitchenOrder[];
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingKitchenOrdersSnapshot = {
  items: [],
  loaded: false
};

function getStableKitchenOperationKey(order: KitchenOrder): string {
  const orderId = order.id.trim();

  if (!orderId) {
    throw new Error(
      "PENDING_KITCHEN_ORDER_REQUIRES_ID: la comanda debe tener una identidad persistente."
    );
  }

  return `order:${orderId}`;
}

function sortQueue(
  items: PendingKitchenOrder[]
): PendingKitchenOrder[] {
  return [...items].sort((a, b) => {
    const queuedDiff =
      a.queuedAt.getTime() -
      b.queuedAt.getTime();

    if (queuedDiff !== 0) {
      return queuedDiff;
    }

    return a.id.localeCompare(b.id);
  });
}

/**
 * Store observable de comandas de cocina pendientes.
 *
 * La única dependencia de infraestructura que requiere es el repositorio,
 * recibido explícitamente por constructor. El store NO conoce su implementación
 * concreta ni instancia repositorios/engines por cuenta propia.
 */
export class PendingKitchenOrdersStore extends ObservableStore<PendingKitchenOrdersSnapshot> {
  constructor(
    private readonly repository: PendingKitchenOrderRepositoryPort
  ) {
    super(EMPTY_SNAPSHOT);

    if (typeof indexedDB !== "undefined") {
      void this.refresh();
    }
  }

  async refresh(): Promise<void> {
    const items = sortQueue(
      await this.repository.findAll()
    );

    this.publish({
      items,
      loaded: true
    });
  }

  async findSyncable(): Promise<PendingKitchenOrder[]> {
    return sortQueue(
      await this.repository.findSyncable()
    );
  }

  /**
   * Encola una comanda una sola vez.
   *
   * La clave primaria del store sigue siendo order.id. La identidad estable
   * de la operación se valida antes de acceder a persistencia para evitar que
   * una comanda sin identidad persistente entre en la cola offline.
   */
  async enqueue(
    order: KitchenOrder
  ): Promise<PendingKitchenOrder> {
    const businessId = requireCurrentBusinessId();
    const branchId = getCurrentBranchId();

    if (!branchId) {
      throw new Error(
        "CONTEXT_MISMATCH: no existe una sucursal activa para guardar la comanda offline."
      );
    }

    getStableKitchenOperationKey(order);

    const existing =
      await this.repository.findById(order.id);

    if (existing) {
      const refreshed: PendingKitchenOrder = {
        ...existing,
        order,
        status: "PENDING_SYNC",
        businessId,
        branchId,
        queuedAt: existing.queuedAt,
        attempts: existing.attempts,
        lastAttemptAt: existing.lastAttemptAt,
        lastError: existing.lastError
      };

      await this.repository.save(refreshed);
      await this.refresh();
      return refreshed;
    }

    const pendingKitchenOrder: PendingKitchenOrder = {
      id: order.id,
      order,
      status: "PENDING_SYNC",
      queuedAt: new Date(),
      attempts: 0,
      lastAttemptAt: undefined,
      lastError: undefined,
      businessId,
      branchId
    };

    await this.repository.save(
      pendingKitchenOrder
    );

    await this.refresh();

    return pendingKitchenOrder;
  }

  async markSyncing(
    id: string
  ): Promise<boolean> {
    const current =
      await this.repository.findById(id);

    if (!current || current.status !== "PENDING_SYNC") {
      return false;
    }

    await this.repository.update({
      ...current,
      status: "SYNCING",
      attempts: current.attempts + 1,
      lastAttemptAt: new Date(),
      lastError: undefined
    });

    await this.refresh();

    return true;
  }

  async markFailed(
    id: string,
    error: string
  ): Promise<void> {
    const current =
      await this.repository.findById(id);

    if (!current) {
      return;
    }

    await this.repository.update({
      ...current,
      status: "FAILED",
      lastError: error,
      lastAttemptAt: new Date()
    });

    await this.refresh();
  }

  async markPermanentFailure(
    id: string,
    error: string
  ): Promise<void> {
    const current =
      await this.repository.findById(id);

    if (!current) {
      return;
    }

    await this.repository.update({
      ...current,
      status: "PERMANENT_FAILURE",
      lastError: error,
      lastAttemptAt: new Date()
    });

    await this.refresh();
  }

  async requeue(
    id: string,
    error?: string
  ): Promise<void> {
    const current =
      await this.repository.findById(id);

    if (!current) {
      return;
    }

    await this.repository.update({
      ...current,
      status: "PENDING_SYNC",
      ...(error !== undefined
        ? { lastError: error }
        : {})
    });

    await this.refresh();
  }

  async remove(
    id: string
  ): Promise<void> {
    await this.repository.delete(id);
    await this.refresh();
  }

  /**
   * Recupera solamente leases realmente abandonados.
   *
   * Esto evita el riesgo de que una segunda pestaña vea un SYNCING reciente,
   * lo vuelva a PENDING y termine enviando dos veces la misma comanda.
   */
  async recoverStuckSyncing(
    now = Date.now()
  ): Promise<void> {
    const items =
      await this.repository.findAll();

    const cutoff =
      now - PENDING_KITCHEN_SYNC_LEASE_MS;

    const stuck = items.filter((item) => {
      if (item.status !== "SYNCING") {
        return false;
      }

      if (!item.lastAttemptAt) {
        return true;
      }

      return (
        item.lastAttemptAt.getTime() <
        cutoff
      );
    });

    if (stuck.length === 0) {
      return;
    }

    for (const item of stuck) {
      await this.repository.update({
        ...item,
        status: "PENDING_SYNC",
        lastError:
          item.lastError ??
          "SYNC_LEASE_EXPIRED"
      });
    }

    await this.refresh();
  }

  syncable(): PendingKitchenOrder[] {
    return sortQueue(
      this.snapshot.items.filter(
        (item) =>
          item.status === "PENDING_SYNC"
      )
    );
  }

  list(): PendingKitchenOrder[] {
    return [...this.snapshot.items];
  }

  count(): number {
    return this.snapshot.items.length;
  }

  async clear(): Promise<void> {
    await this.repository.clear();
    await this.refresh();
  }
}

type PendingKitchenOrdersStoreResolver = () => PendingKitchenOrdersStore;

let pendingKitchenOrdersStoreResolver: PendingKitchenOrdersStoreResolver | null = null;
let resolvedPendingKitchenOrdersStore: PendingKitchenOrdersStore | null = null;

/**
 * Registra el resolver controlado por CompositionRoot.
 *
 * El store no conoce CompositionRoot ni una implementación concreta del
 * repositorio. La composición central instala este resolver una única vez;
 * el singleton exportado debajo delega siempre sobre la instancia que el
 * CompositionRoot cachea perezosamente.
 */
export function registerPendingKitchenOrdersStoreResolver(
  resolver: PendingKitchenOrdersStoreResolver
): void {
  if (
    pendingKitchenOrdersStoreResolver &&
    pendingKitchenOrdersStoreResolver !== resolver
  ) {
    throw new Error(
      "PENDING_KITCHEN_ORDERS_STORE_RESOLVER_ALREADY_REGISTERED"
    );
  }

  pendingKitchenOrdersStoreResolver = resolver;
}

export function getPendingKitchenOrdersStore(): PendingKitchenOrdersStore {
  if (resolvedPendingKitchenOrdersStore) {
    return resolvedPendingKitchenOrdersStore;
  }

  if (!pendingKitchenOrdersStoreResolver) {
    throw new Error(
      "PENDING_KITCHEN_ORDERS_STORE_NOT_COMPOSED"
    );
  }

  resolvedPendingKitchenOrdersStore =
    pendingKitchenOrdersStoreResolver();

  return resolvedPendingKitchenOrdersStore;
}

/**
 * Singleton público estable.
 *
 * La identidad exportada es única durante toda la vida del módulo. La
 * instancia concreta de PendingKitchenOrdersStore se crea y cachea únicamente
 * en CompositionRoot; este façade permite conservar el contrato de importación
 * nombrada sin introducir un ciclo store -> CompositionRoot.
 */
export const pendingKitchenOrdersStore = new Proxy(
  Object.create(PendingKitchenOrdersStore.prototype) as PendingKitchenOrdersStore,
  {
    get(_target, property) {
      const instance = getPendingKitchenOrdersStore();
      const value = Reflect.get(instance, property, instance);

      return typeof value === "function"
        ? value.bind(instance)
        : value;
    },
    set(_target, property, value) {
      const instance = getPendingKitchenOrdersStore();
      return Reflect.set(instance, property, value, instance);
    },
    has(_target, property) {
      const instance = getPendingKitchenOrdersStore();
      return property in instance;
    },
    ownKeys() {
      const instance = getPendingKitchenOrdersStore();
      return Reflect.ownKeys(instance);
    },
    getOwnPropertyDescriptor(_target, property) {
      const instance = getPendingKitchenOrdersStore();
      return Reflect.getOwnPropertyDescriptor(instance, property);
    }
  }
);
