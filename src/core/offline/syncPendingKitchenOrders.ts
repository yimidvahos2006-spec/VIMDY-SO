import { container } from "../../infrastructure/di/CompositionRoot";
import { connectionStore } from "../store/connectionStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import {
  isNetworkFailure
} from "../services/offlineSale";
import {
  pendingKitchenOrdersStore,
  PENDING_KITCHEN_SYNC_LEASE_MS
} from "./pendingKitchenOrdersStore";
import type { PendingKitchenOrder } from "./PendingKitchenOrder";
import type { KitchenOrder } from "../entities/Entities";
import { logError } from "../../infrastructure/logging/opsLogger";
import { vimdyCore } from "../VimdyCore";
import {
  getCurrentBusinessId,
  getCurrentBranchId
} from "../../infrastructure/supabase/supabaseClient";
import {
  MAX_OFFLINE_ATTEMPTS,
  isBusinessError
} from "./offlineConstants";

type WebLockLike = {
  request<T>(
    name: string,
    options: {
      mode: "exclusive";
      signal?: AbortSignal;
    },
    callback: () => Promise<T>
  ): Promise<T>;
};

type SyncRuntimeContext = Readonly<{
  businessId: string;
  branchId: string;
}>;

export type KitchenSyncLifecycleStatus =
  | "PENDING_SYNC"
  | "SYNCING"
  | "SUCCESS"
  | "FAILED"
  | "PERMANENT_FAILURE"
  | "ABORTED"
  | "CONTEXT_MISMATCH";

export interface KitchenSyncLifecycleEvent {
  readonly status: KitchenSyncLifecycleStatus;
  readonly pendingId: string;
  readonly businessId: string;
  readonly branchId: string;
  readonly attempts: number;
  readonly at: Date;
  readonly error?: string;
}

type KitchenSyncLifecycleListener = (
  event: KitchenSyncLifecycleEvent
) => void;

const lifecycleListeners = new Set<KitchenSyncLifecycleListener>();
const retryDueAtByKey = new Map<string, number>();

let syncPromise: Promise<void> | null = null;
let runAbortController: AbortController | null = null;
let runGeneration = 0;
let schedulerRunning = false;
let unsubscribeConnection: (() => void) | null = null;
let unsubscribePendingKitchenOrders: (() => void) | null = null;
let schedulerTimer: ReturnType<typeof setTimeout> | null = null;
let processLocalLockHeld = false;

const RETRY_BASE_DELAY_MS = 1000;
const RETRY_MAX_DELAY_MS = 5 * 60 * 1000;
const RETRY_MIN_JITTER_DELAY_MS = 250;
const MAX_TIMER_DELAY_MS = 2_147_000_000;

class SyncAbortedError extends Error {
  constructor() {
    super("OFFLINE_KITCHEN_SYNC_ABORTED");
    this.name = "SyncAbortedError";
  }
}

class SyncContextChangedError extends Error {
  constructor(
    expected: SyncRuntimeContext,
    actualBusinessId: string | undefined,
    actualBranchId: string | undefined
  ) {
    super(
      `CONTEXT_MISMATCH: cambió el contexto durante la sincronización. Esperado ${expected.businessId}/${expected.branchId}, actual ${actualBusinessId ?? "null"}/${actualBranchId ?? "null"}.`
    );
    this.name = "SyncContextChangedError";
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : String(error);
}

function getWebLocks(): WebLockLike | null {
  if (typeof navigator === "undefined") {
    return null;
  }

  const maybeNavigator = navigator as Navigator & {
    locks?: WebLockLike;
  };

  return maybeNavigator.locks ?? null;
}

function canUseProcessLocalLockFallback(): boolean {
  const maybeProcess = (
    globalThis as typeof globalThis & {
      process?: {
        env?: Record<string, string | undefined>;
      };
    }
  ).process;

  return maybeProcess?.env?.NODE_ENV === "test";
}

function getKitchenOperationKey(
  order: KitchenOrder
): string {
  const extended =
    order as KitchenOrder & {
      sendOperationId?: string;
    };

  if (extended.sendOperationId?.trim()) {
    return `send:${extended.sendOperationId.trim()}`;
  }

  return `order:${order.id}`;
}

function getCurrentContext(): SyncRuntimeContext | null {
  const businessId = getCurrentBusinessId();
  const branchId = getCurrentBranchId();

  if (!businessId || !branchId) {
    return null;
  }

  return {
    businessId,
    branchId
  };
}

function assertContextUnchanged(
  expected: SyncRuntimeContext
): void {
  const actualBusinessId =
    getCurrentBusinessId();
  const actualBranchId =
    getCurrentBranchId();

  if (
    actualBusinessId !== expected.businessId ||
    actualBranchId !== expected.branchId
  ) {
    throw new SyncContextChangedError(
      expected,
      actualBusinessId,
      actualBranchId
    );
  }
}

function throwIfAborted(
  signal: AbortSignal
): void {
  if (signal.aborted) {
    throw new SyncAbortedError();
  }
}

function assertRunActive(
  signal: AbortSignal,
  generation: number,
  context?: SyncRuntimeContext
): void {
  throwIfAborted(signal);

  if (
    runAbortController?.signal !== signal ||
    runGeneration !== generation
  ) {
    throw new SyncAbortedError();
  }

  if (context) {
    assertContextUnchanged(context);
  }
}

async function awaitWithGuards<T>(
  promise: Promise<T>,
  signal: AbortSignal,
  generation: number,
  context?: SyncRuntimeContext
): Promise<T> {
  const result = await promise;
  assertRunActive(signal, generation, context);
  return result;
}

function emitLifecycleEvent(
  event: KitchenSyncLifecycleEvent
): void {
  for (const listener of lifecycleListeners) {
    try {
      listener(event);
    } catch (listenerError) {
      logError(listenerError, {
        category: "offline",
        context: {
          pendingId: event.pendingId,
          eventStatus: event.status
        }
      });
    }
  }

  vimdyCore.emit("sync", event);
}

export function subscribeKitchenSyncLifecycle(
  listener: KitchenSyncLifecycleListener
): () => void {
  lifecycleListeners.add(listener);

  return () => {
    lifecycleListeners.delete(listener);
  };
}

function emitState(
  status: KitchenSyncLifecycleStatus,
  pending: Pick<
    PendingKitchenOrder,
    "id" | "businessId" | "branchId" | "attempts"
  >,
  error?: string
): void {
  emitLifecycleEvent({
    status,
    pendingId: pending.id,
    businessId: pending.businessId,
    branchId: pending.branchId,
    attempts: pending.attempts,
    at: new Date(),
    ...(error ? { error } : {})
  });
}

function isSameScope(
  pending: PendingKitchenOrder,
  context: SyncRuntimeContext
): boolean {
  return (
    pending.businessId === context.businessId &&
    pending.branchId === context.branchId
  );
}

function getRetryKey(
  pending: PendingKitchenOrder
): string {
  return `${pending.id}:${pending.attempts}:${pending.lastAttemptAt?.getTime() ?? 0}`;
}

function calculateExponentialBackoff(
  attempts: number
): number {
  const normalizedAttempts = Math.max(1, attempts);
  const exponential = Math.min(
    RETRY_MAX_DELAY_MS,
    RETRY_BASE_DELAY_MS *
      2 ** (normalizedAttempts - 1)
  );

  const jittered = Math.floor(
    exponential *
      (0.5 + Math.random() * 0.5)
  );

  return Math.max(
    RETRY_MIN_JITTER_DELAY_MS,
    Math.min(
      RETRY_MAX_DELAY_MS,
      jittered
    )
  );
}

function getNextRetryAt(
  pending: PendingKitchenOrder
): number {
  if (!pending.lastAttemptAt) {
    return pending.queuedAt.getTime();
  }

  const retryKey = getRetryKey(pending);
  const existing = retryDueAtByKey.get(retryKey);

  if (existing !== undefined) {
    return existing;
  }

  const dueAt =
    pending.lastAttemptAt.getTime() +
    calculateExponentialBackoff(
      pending.attempts
    );

  retryDueAtByKey.set(
    retryKey,
    dueAt
  );

  return dueAt;
}

function clearRetrySchedule(
  pendingId: string
): void {
  for (const key of retryDueAtByKey.keys()) {
    if (key.startsWith(`${pendingId}:`)) {
      retryDueAtByKey.delete(key);
    }
  }
}

function clearSchedulerTimer(): void {
  if (schedulerTimer !== null) {
    clearTimeout(schedulerTimer);
    schedulerTimer = null;
  }
}

function getNextLeaseWakeAt(
  items: PendingKitchenOrder[]
): number | null {
  let nextWake: number | null = null;

  for (const item of items) {
    if (item.status !== "SYNCING") {
      continue;
    }

    const leaseAt =
      (item.lastAttemptAt?.getTime() ??
        item.queuedAt.getTime()) +
      PENDING_KITCHEN_SYNC_LEASE_MS;

    if (
      nextWake === null ||
      leaseAt < nextWake
    ) {
      nextWake = leaseAt;
    }
  }

  return nextWake;
}

function scheduleNextWake(): void {
  clearSchedulerTimer();

  if (!schedulerRunning) {
    return;
  }

  const items = pendingKitchenOrdersStore.list();

  if (items.length === 0) {
    return;
  }

  let nextWakeAt: number | null = null;

  for (const pending of items) {
    if (pending.status === "PENDING_SYNC") {
      const retryAt = getNextRetryAt(pending);

      if (
        nextWakeAt === null ||
        retryAt < nextWakeAt
      ) {
        nextWakeAt = retryAt;
      }
    }
  }

  const leaseWakeAt =
    getNextLeaseWakeAt(items);

  if (
    leaseWakeAt !== null &&
    (nextWakeAt === null ||
      leaseWakeAt < nextWakeAt)
  ) {
    nextWakeAt = leaseWakeAt;
  }

  if (nextWakeAt === null) {
    return;
  }

  const delay = Math.max(
    0,
    Math.min(
      MAX_TIMER_DELAY_MS,
      nextWakeAt - Date.now()
    )
  );

  schedulerTimer = setTimeout(() => {
    schedulerTimer = null;

    if (!schedulerRunning) {
      return;
    }

    triggerIfNeeded();
  }, delay);
}

function getKitchenSyncLockName(
  context: SyncRuntimeContext
): string {
  return [
    "vimdy",
    "kitchen-sync",
    encodeURIComponent(
      context.businessId
    ),
    encodeURIComponent(
      context.branchId
    )
  ].join(":");
}

async function withKitchenSyncLock<T>(
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number,
  operation: () => Promise<T>
): Promise<T> {
  const lockName =
    getKitchenSyncLockName(context);
  const locks = getWebLocks();

  if (locks) {
    return locks.request(
      lockName,
      {
        mode: "exclusive",
        signal
      },
      async () => {
        assertRunActive(
          signal,
          generation,
          context
        );

        const result =
          await operation();

        assertRunActive(
          signal,
          generation,
          context
        );

        return result;
      }
    );
  }

  if (!canUseProcessLocalLockFallback()) {
    throw new Error(
      "ATOMIC_CLAIM_UNAVAILABLE: el navegador no expone Web Locks; se bloquea la sincronización para evitar duplicados entre pestañas."
    );
  }

  while (processLocalLockHeld) {
    throwIfAborted(signal);

    await new Promise<void>(
      (resolve, reject) => {
        let settled = false;

        const cleanup = () => {
          signal.removeEventListener(
            "abort",
            onAbort
          );
        };

        const onAbort = () => {
          if (settled) {
            return;
          }

          settled = true;
          clearTimeout(timer);
          cleanup();
          reject(
            new SyncAbortedError()
          );
        };

        const timer = setTimeout(() => {
          if (settled) {
            return;
          }

          settled = true;
          cleanup();
          resolve();
        }, 25);

        signal.addEventListener(
          "abort",
          onAbort,
          { once: true }
        );
      }
    );
  }

  processLocalLockHeld = true;

  try {
    assertRunActive(
      signal,
      generation,
      context
    );

    const result =
      await operation();

    assertRunActive(
      signal,
      generation,
      context
    );

    return result;
  } finally {
    processLocalLockHeld = false;
  }
}

async function reconcileAlreadyPersisted(
  pending: PendingKitchenOrder,
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number
): Promise<boolean> {
  assertRunActive(
    signal,
    generation,
    context
  );

  const kitchenEngine =
    container.kitchenEngine.get();

  const existing =
    await awaitWithGuards(
      kitchenEngine.getById(
        pending.id
      ),
      signal,
      generation,
      context
    );

  if (existing) {
    return true;
  }

  const orderId =
    pending.order.orderId;

  if (!orderId) {
    return false;
  }

  const existingByOrder =
    await awaitWithGuards(
      kitchenEngine.getByOrderId(
        orderId
      ),
      signal,
      generation,
      context
    );

  const operationKey =
    getKitchenOperationKey(
      pending.order
    );

  return existingByOrder.some(
    (candidate) =>
      getKitchenOperationKey(
        candidate
      ) === operationKey
  );
}

async function syncOne(
  pending: PendingKitchenOrder,
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number
): Promise<void> {
  assertRunActive(
    signal,
    generation,
    context
  );

  if (!isSameScope(pending, context)) {
    throw new SyncContextChangedError(
      context,
      pending.businessId,
      pending.branchId
    );
  }

  if (
    pending.order.businessId &&
    pending.order.businessId !==
      context.businessId
  ) {
    throw new SyncContextChangedError(
      context,
      pending.order.businessId,
      pending.order.branchId ?? undefined
    );
  }

  if (
    pending.order.branchId &&
    pending.order.branchId !==
      context.branchId
  ) {
    throw new SyncContextChangedError(
      context,
      pending.order.businessId ??
        context.businessId,
      pending.order.branchId
    );
  }

  const alreadyPersisted =
    await reconcileAlreadyPersisted(
      pending,
      context,
      signal,
      generation
    );

  if (alreadyPersisted) {
    return;
  }

  assertRunActive(
    signal,
    generation,
    context
  );

  await awaitWithGuards(
    container.kitchenEngine
      .get()
      .save(pending.order),
    signal,
    generation,
    context
  );
}

async function recoverExpiredClaims(
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number
): Promise<void> {
  assertRunActive(
    signal,
    generation,
    context
  );

  await awaitWithGuards(
    pendingKitchenOrdersStore.refresh(),
    signal,
    generation,
    context
  );

  const cutoff =
    Date.now() - PENDING_KITCHEN_SYNC_LEASE_MS;

  const expired = pendingKitchenOrdersStore
    .list()
    .filter((item) => {
      if (item.status !== "SYNCING") {
        return false;
      }

      if (!isSameScope(item, context)) {
        return false;
      }

      const claimedAt =
        item.lastAttemptAt?.getTime() ??
        item.queuedAt.getTime();

      return claimedAt < cutoff;
    });

  for (const item of expired) {
    assertRunActive(
      signal,
      generation,
      context
    );

    await awaitWithGuards(
      pendingKitchenOrdersStore.requeue(
        item.id,
        "SYNC_LEASE_EXPIRED"
      ),
      signal,
      generation,
      context
    );
  }

  assertRunActive(
    signal,
    generation,
    context
  );
}

async function claimPendingOrder(
  pending: PendingKitchenOrder,
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number
): Promise<PendingKitchenOrder | null> {
  assertRunActive(
    signal,
    generation,
    context
  );

  const freshQueue =
    await awaitWithGuards(
      pendingKitchenOrdersStore
        .findSyncable(),
      signal,
      generation,
      context
    );

  const latest =
    freshQueue.find(
      (item) =>
        item.id === pending.id
    );

  if (!latest) {
    return null;
  }

  if (!isSameScope(latest, context)) {
    return null;
  }

  /**
   * Claim check atómico:
   * - este módulo solo llega aquí mientras mantiene el Web Lock exclusivo
   *   del negocio/sucursal;
   * - se vuelve a leer la fila justo antes de markSyncing();
   * - después de escribir SYNCING se comprueba el estado resultante.
   *
   * Dos pestañas que usen este módulo no pueden ejecutar simultáneamente
   * este bloque para la misma empresa/sucursal, por lo que solo una puede
   * observar PENDING_SYNC y convertirla en SYNCING.
   */
  const started =
    await awaitWithGuards(
      pendingKitchenOrdersStore
        .markSyncing(latest.id),
      signal,
      generation,
      context
    );

  if (!started) {
    return null;
  }

  assertRunActive(
    signal,
    generation,
    context
  );

  const claimed =
    pendingKitchenOrdersStore
      .list()
      .find(
        (item) =>
          item.id === latest.id
      );

  if (
    !claimed ||
    claimed.status !== "SYNCING" ||
    !isSameScope(
      claimed,
      context
    )
  ) {
    return null;
  }

  emitState(
    "SYNCING",
    claimed
  );

  return claimed;
}

async function processPendingOrder(
  pending: PendingKitchenOrder,
  context: SyncRuntimeContext,
  signal: AbortSignal,
  generation: number
): Promise<
  | "SUCCESS"
  | "REQUEUED"
  | "PERMANENT_FAILURE"
  | "FAILED"
  | "SKIPPED"
> {
  const claimed =
    await claimPendingOrder(
      pending,
      context,
      signal,
      generation
    );

  if (!claimed) {
    return "SKIPPED";
  }

  try {
    await syncOne(
      claimed,
      context,
      signal,
      generation
    );

    assertRunActive(
      signal,
      generation,
      context
    );

    emitState(
      "SUCCESS",
      claimed
    );

    await awaitWithGuards(
      pendingKitchenOrdersStore
        .remove(claimed.id),
      signal,
      generation,
      context
    );

    clearRetrySchedule(
      claimed.id
    );

    return "SUCCESS";
  } catch (error) {
    const message =
      errorMessage(error);

    if (
      signal.aborted ||
      error instanceof SyncAbortedError
    ) {
      emitState(
        "ABORTED",
        claimed,
        message
      );

      return "SKIPPED";
    }

    if (
      error instanceof
      SyncContextChangedError
    ) {
      emitState(
        "CONTEXT_MISMATCH",
        claimed,
        message
      );

      logError(
        "Sincronización de cocina abortada por cambio de contexto; la fila queda protegida por lease para reconciliación posterior.",
        {
          category: "offline",
          context: {
            pendingId: claimed.id,
            businessId:
              claimed.businessId,
            branchId:
              claimed.branchId,
            attempts:
              claimed.attempts,
            error: message
          }
        }
      );

      return "SKIPPED";
    }

    if (
      !isSameScope(
        claimed,
        context
      )
    ) {
      emitState(
        "CONTEXT_MISMATCH",
        claimed,
        "CONTEXT_MISMATCH: la sesión cambió antes de resolver el resultado de la operación."
      );

      return "SKIPPED";
    }

    if (
      isNetworkFailure(error)
    ) {
      await awaitWithGuards(
        pendingKitchenOrdersStore
          .requeue(
            claimed.id,
            message
          ),
        signal,
        generation,
        context
      );

      emitState(
        "PENDING_SYNC",
        claimed,
        message
      );

      logError(
        "Fallo de red al sincronizar comanda offline",
        {
          category: "offline",
          context: {
            pendingId:
              claimed.id,
            businessId:
              claimed.businessId,
            branchId:
              claimed.branchId,
            attempts:
              claimed.attempts,
            retryDelayMs:
              calculateExponentialBackoff(
                claimed.attempts
              ),
            error: message
          }
        }
      );

      return "REQUEUED";
    }

    if (
      isBusinessError(error)
    ) {
      await awaitWithGuards(
        pendingKitchenOrdersStore
          .markPermanentFailure(
            claimed.id,
            message
          ),
        signal,
        generation,
        context
      );

      clearRetrySchedule(
        claimed.id
      );

      emitState(
        "PERMANENT_FAILURE",
        claimed,
        message
      );

      logError(
        "Error de negocio al sincronizar comanda offline",
        {
          category: "offline",
          context: {
            pendingId:
              claimed.id,
            businessId:
              claimed.businessId,
            branchId:
              claimed.branchId,
            error: message
          }
        }
      );

      return "PERMANENT_FAILURE";
    }

    await awaitWithGuards(
      pendingKitchenOrdersStore
        .markFailed(
          claimed.id,
          message
        ),
      signal,
      generation,
      context
    );

    clearRetrySchedule(
      claimed.id
    );

    emitState(
      "FAILED",
      claimed,
      message
    );

    logError(
      "Error no recuperable al sincronizar comanda offline",
      {
        category: "offline",
        context: {
          pendingId:
            claimed.id,
          businessId:
            claimed.businessId,
          branchId:
            claimed.branchId,
          attempts:
            claimed.attempts,
          error: message
        }
      }
    );

    return "FAILED";
  }
}

async function runSync(
  signal: AbortSignal,
  generation: number
): Promise<void> {
  try {
    if (
      !connectionStore.isOnline()
    ) {
      clearSchedulerTimer();
      return;
    }

    const context =
      getCurrentContext();

    if (!context) {
      clearSchedulerTimer();
      return;
    }

    assertRunActive(
      signal,
      generation,
      context
    );

    await recoverExpiredClaims(
      context,
      signal,
      generation
    );

    const queue =
      await awaitWithGuards(
        pendingKitchenOrdersStore
          .findSyncable(),
        signal,
        generation,
        context
      );

    if (queue.length === 0) {
      scheduleNextWake();
      return;
    }

    let syncedCount = 0;
    let failedCount = 0;
    let transientFailure = false;

    for (const pending of queue) {
      assertRunActive(
        signal,
        generation,
        context
      );

      if (
        !connectionStore.isOnline()
      ) {
        break;
      }

      if (
        !isSameScope(
          pending,
          context
        )
      ) {
        continue;
      }

      if (
        pending.attempts >=
        MAX_OFFLINE_ATTEMPTS
      ) {
        await awaitWithGuards(
          pendingKitchenOrdersStore
            .markPermanentFailure(
              pending.id,
              "MAX_ATTEMPTS_REACHED"
            ),
          signal,
          generation,
          context
        );

        clearRetrySchedule(
          pending.id
        );

        emitState(
          "PERMANENT_FAILURE",
          pending,
          "MAX_ATTEMPTS_REACHED"
        );

        failedCount += 1;
        continue;
      }

      const nextRetryAt =
        getNextRetryAt(pending);

      if (
        nextRetryAt > Date.now()
      ) {
        continue;
      }

      const result =
        await processPendingOrder(
          pending,
          context,
          signal,
          generation
        );

      if (result === "SUCCESS") {
        syncedCount += 1;
        continue;
      }

      if (
        result ===
          "PERMANENT_FAILURE" ||
        result === "FAILED"
      ) {
        failedCount += 1;
        continue;
      }

      if (
        result === "REQUEUED"
      ) {
        transientFailure = true;
        break;
      }
    }

    if (syncedCount > 0) {
      try {
        await awaitWithGuards(
          productCatalogStore.refresh(),
          signal,
          generation,
          context
        );
      } catch (error) {
        if (
          error instanceof SyncAbortedError ||
          error instanceof SyncContextChangedError ||
          signal.aborted
        ) {
          throw error;
        }

        logError(
          "No se pudo refrescar el catálogo tras sincronizar comandas offline",
          {
            category: "offline",
            context: {
              error: errorMessage(error),
              businessId: context.businessId,
              branchId: context.branchId
            }
          }
        );
      }

      assertRunActive(
        signal,
        generation,
        context
      );

      vimdyCore.emit("kitchen", {
        action:
          "offline_sync_success",
        syncedCount,
        businessId:
          context.businessId,
        branchId:
          context.branchId
      });

      toast.success(
        syncedCount === 1
          ? "1 comanda sin conexión se sincronizó correctamente."
          : `${syncedCount} comandas sin conexión se sincronizaron correctamente.`
      );
    }

    if (failedCount > 0) {
      toast.error(
        failedCount === 1
          ? "1 comanda sin conexión quedó para revisión manual."
          : `${failedCount} comandas sin conexión quedaron para revisión manual.`
      );
    }

    if (transientFailure) {
      scheduleNextWake();
      return;
    }

    scheduleNextWake();
  } catch (error) {
    if (
      error instanceof
        SyncAbortedError ||
      signal.aborted
    ) {
      return;
    }

    if (
      error instanceof
      SyncContextChangedError
    ) {
      logError(
        "La sincronización de cocina se detuvo porque cambió el contexto activo.",
        {
          category: "offline",
          context: {
            error: error.message
          }
        }
      );
      return;
    }

    logError(
      "Error inesperado en el scheduler de cocina offline",
      {
        category: "offline",
        context: {
          error: errorMessage(error)
        }
      }
    );

    scheduleNextWake();
  }
}

export async function syncPendingKitchenOrders(): Promise<void> {
  if (syncPromise) {
    return syncPromise;
  }

  const initialContext =
    getCurrentContext();

  if (!initialContext) {
    return;
  }

  if (!runAbortController) {
    runAbortController =
      new AbortController();
    runGeneration += 1;
  }

  const controller =
    runAbortController;
  const generation =
    runGeneration;

  const promise =
    withKitchenSyncLock(
      initialContext,
      controller.signal,
      generation,
      () =>
        runSync(
          controller.signal,
          generation
        )
    )
      .catch((error) => {
        if (
          error instanceof
            SyncAbortedError ||
          controller.signal.aborted ||
          String(error).includes(
            "AbortError"
          )
        ) {
          return;
        }

        logError(
          "No se pudo adquirir el lock de sincronización de cocina",
          {
            category: "offline",
            context: {
              businessId:
                initialContext.businessId,
              branchId:
                initialContext.branchId,
              error:
                errorMessage(error)
            }
          }
        );
      })
      .finally(() => {
        if (
          syncPromise === promise
        ) {
          syncPromise = null;
        }

        if (schedulerRunning) {
          scheduleNextWake();
        }
      });

  syncPromise = promise;
  return promise;
}

function triggerIfNeeded(): void {
  if (!schedulerRunning) {
    return;
  }

  if (!connectionStore.isOnline()) {
    clearSchedulerTimer();
    return;
  }

  if (!getCurrentContext()) {
    clearSchedulerTimer();
    return;
  }

  void syncPendingKitchenOrders();
}

export function startOfflineKitchenSync(): void {
  if (schedulerRunning) {
    triggerIfNeeded();
    return;
  }

  schedulerRunning = true;
  runGeneration += 1;
  runAbortController =
    new AbortController();

  clearSchedulerTimer();

  unsubscribeConnection =
    connectionStore.subscribe(
      triggerIfNeeded
    );

  unsubscribePendingKitchenOrders =
    pendingKitchenOrdersStore.subscribe(
      triggerIfNeeded
    );

  triggerIfNeeded();
}

export async function stopOfflineKitchenSync(): Promise<void> {
  schedulerRunning = false;
  runGeneration += 1;

  unsubscribeConnection?.();
  unsubscribePendingKitchenOrders?.();

  unsubscribeConnection = null;
  unsubscribePendingKitchenOrders = null;

  clearSchedulerTimer();

  const controller =
    runAbortController;
  const inFlight = syncPromise;

  controller?.abort();
  runAbortController = null;

  if (!inFlight) {
    return;
  }

  try {
    await inFlight;
  } catch (error) {
    if (
      !(error instanceof
        SyncAbortedError) &&
      !String(error).includes(
        "AbortError"
      )
    ) {
      logError(error, {
        category: "offline",
        context: {
          phase:
            "stopOfflineKitchenSync"
        }
      });
    }
  }
}
