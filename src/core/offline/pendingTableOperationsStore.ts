import { ObservableStore } from "../store/ObservableStore";
import {
  PendingTableConflict,
  PendingTableOperation,
  PendingTableOperationType,
  PendingTableStateSnapshot
} from "./PendingTableOperation";
import { BlockedTable, blockedTableIds, blockedTablesFrom } from "./tableConflictRules";
import {
  applyLineOperation,
  computeTableTotals,
  lineOperationFromPending
} from "./tableLineRules";
import { PendingTableOperationRepository } from "../../infrastructure/di/repositories/PendingTableOperationRepository";
import {
  OpenTableInput,
  CloseTableInput
} from "../engines/TableEngine";
import { Table } from "../entities/Entities";
import { TableLocalRepository } from "../../infrastructure/di/repositories/TableLocalRepository";
import { productCatalogStore } from "../store/productCatalogStore";
import { companyConfigStore } from "../store/companyConfigStore";
import {
  getCurrentBranchId,
  requireCurrentBusinessId
} from "../../infrastructure/supabase/supabaseClient";

const repository = new PendingTableOperationRepository();
const tableLocalRepository = new TableLocalRepository();

export interface PendingTableOperationsSnapshot {
  readonly items: PendingTableOperation[];
  readonly loaded: boolean;
}

const EMPTY_SNAPSHOT: PendingTableOperationsSnapshot = {
  items: [],
  loaded: false
};

function snapshotTable(table: Table): PendingTableStateSnapshot {
  return {
    status: table.status,
    peopleCount: table.peopleCount,
    waiterId: table.waiterId,
    customerId: table.customerId,
    notes: table.notes,
    items: table.items.map((item) => ({ ...item })),
    subtotal: Number(table.subtotal ?? 0),
    tax: Number(table.tax ?? 0),
    discount: Number(table.discount ?? 0),
    total: Number(table.total ?? 0),
    openOperationId: table.openOperationId
  };
}

function buildExpectedAfter(
  table: Table,
  params: {
    type: PendingTableOperationType;
    openInput?: OpenTableInput;
    closeInput?: CloseTableInput;
    addItemInput?: PendingTableOperation["addItemInput"];
    removeItemInput?: PendingTableOperation["removeItemInput"];
    updateQuantityInput?: PendingTableOperation["updateQuantityInput"];
    updateNoteInput?: PendingTableOperation["updateNoteInput"];
    sendToKitchenInput?: { priority?: string };
  },
  normalizedOpenInput?: OpenTableInput,
  normalizedCloseInput?: CloseTableInput
): PendingTableStateSnapshot | undefined {
  const current = snapshotTable(table);

  if (params.type === "OPEN") {
    const input = normalizedOpenInput ?? params.openInput;
    return {
      ...current,
      status: "BUSY",
      peopleCount: input?.peopleCount ?? table.peopleCount ?? 0,
      waiterId: input?.waiterId ?? table.waiterId,
      customerId: input?.customerId ?? table.customerId,
      notes: input?.notes ?? table.notes,
      openOperationId: input?.operationId
    };
  }

  if (params.type === "CLOSE") {
    return {
      status: "FREE",
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      notes: undefined,
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      openOperationId: undefined
    };
  }

  const lineOperation = lineOperationFromPending(params, (productId) =>
    productCatalogStore.getById(productId)
  );

  if (lineOperation) {
    const items = applyLineOperation(table.items, lineOperation);
    return {
      ...current,
      items,
      ...computeTableTotals(
        items,
        companyConfigStore.get().tax,
        Number(table.discount ?? 0)
      )
    };
  }

  if (params.type === "SEND_TO_KITCHEN") {
    return {
      ...current,
      status: "CUENTA_SOLICITADA"
    };
  }

  return undefined;
}

class PendingTableOperationsStore extends ObservableStore<PendingTableOperationsSnapshot> {
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

  async findSyncable(): Promise<PendingTableOperation[]> {
    return repository.findSyncable();
  }

  async enqueue(params: {
    id: string;
    tableId: string;
    tableName: string;
    type: PendingTableOperationType;
    openInput?: OpenTableInput;
    closeInput?: CloseTableInput;
    addItemInput?: PendingTableOperation["addItemInput"];
    removeItemInput?: PendingTableOperation["removeItemInput"];
    updateQuantityInput?: PendingTableOperation["updateQuantityInput"];
    updateNoteInput?: PendingTableOperation["updateNoteInput"];
    sendToKitchenInput?: { priority?: string };
  }): Promise<PendingTableOperation> {
    if (!params.id) {
      throw new Error(
        "PENDING_TABLE_OPERATION_REQUIRES_ID: la operación de mesa necesita un id."
      );
    }

    const existing = await repository.findById(params.id);

    // Paso 4: una mesa con conflicto de significado no admite operaciones
    // nuevas hasta que Caja/Admin la audite; si no, el mesero seguiría
    // apilando cambios sobre una cuenta que el servidor ya no reconoce.
    if (!existing && (await this.isTableBlocked(params.tableId))) {
      throw new Error(
        `TABLE_BLOCKED_BY_CONFLICT: la mesa "${params.tableName}" tiene cambios sin conexión en revisión por Caja. No se pueden encolar más cambios.`
      );
    }

    const normalizedOpenInput =
      params.type === "OPEN" && params.openInput
        ? {
            ...params.openInput,
            operationId:
              params.openInput.operationId ??
              existing?.openInput?.operationId ??
              params.id
          }
        : params.openInput;

    const normalizedCloseInput =
      params.type === "CLOSE" && params.closeInput
        ? {
            ...params.closeInput,
            saleId:
              params.closeInput.saleId ??
              existing?.closeInput?.saleId ??
              params.id
          }
        : params.closeInput;

    let expectedBefore: PendingTableStateSnapshot | undefined;
    let expectedAfter: PendingTableStateSnapshot | undefined;

    if (typeof indexedDB !== "undefined") {
      const localTable = await tableLocalRepository.findById(
        params.tableId
      );

      if (localTable) {
        expectedBefore = snapshotTable(localTable);
        expectedAfter = buildExpectedAfter(
          localTable,
          params,
          normalizedOpenInput,
          normalizedCloseInput
        );
      }
    }

    const pendingOperation: PendingTableOperation = {
      id: params.id,
      tableId: params.tableId,
      tableName: params.tableName,
      type: params.type,
      openInput: normalizedOpenInput,
      closeInput: normalizedCloseInput,
      addItemInput: params.addItemInput,
      removeItemInput: params.removeItemInput,
      updateQuantityInput: params.updateQuantityInput,
      updateNoteInput: params.updateNoteInput,
      sendToKitchenInput: params.sendToKitchenInput,
      expectedBefore: existing?.expectedBefore ?? expectedBefore,
      expectedAfter: existing?.expectedAfter ?? expectedAfter,
      status: "PENDING_SYNC",
      queuedAt: existing?.queuedAt ?? new Date(),
      attempts: existing?.attempts ?? 0,
      lastAttemptAt: existing?.lastAttemptAt,
      lastError: existing?.lastError,
      businessId:
        existing?.businessId ??
        (() => {
          try {
            return requireCurrentBusinessId();
          } catch {
            return "";
          }
        })(),
      branchId:
        existing?.branchId ??
        (() => {
          try {
            return getCurrentBranchId() ?? "";
          } catch {
            return "";
          }
        })()
    };

    await repository.save(pendingOperation);
    await this.refresh();

    return pendingOperation;
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

  /**
   * Conflicto de significado (Paso 4). La operación queda guardada tal cual,
   * sin reintentos (`findSyncable` solo devuelve PENDING_SYNC) y sin borrarse,
   * para que Caja/Admin la audite. Bloquea las demás operaciones de la mesa.
   */
  async markConflict(id: string, conflict: PendingTableConflict): Promise<void> {
    const current = await repository.findById(id);
    if (!current) return;

    await repository.update({
      ...current,
      status: "CONFLICT",
      conflict,
      lastError: conflict.detail,
      lastAttemptAt: new Date()
    });
    await this.refresh();
  }

  /** Ids de las mesas bloqueadas, leídos de la cola persistida (no de la copia en memoria). */
  async loadBlockedTableIds(): Promise<Set<string>> {
    return blockedTableIds(await repository.findAll());
  }

  async isTableBlocked(tableId: string): Promise<boolean> {
    return (await this.loadBlockedTableIds()).has(tableId);
  }

  /** Mesas bloqueadas según la copia en memoria (para la UI). */
  blockedTables(): BlockedTable[] {
    return blockedTablesFrom(this.snapshot.items);
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

    await repository.update({
      ...current,
      status: "PENDING_SYNC"
    });
    await this.refresh();
  }

  async remove(id: string): Promise<void> {
    await repository.delete(id);
    await this.refresh();
  }

  async recoverStuckSyncing(): Promise<void> {
    const items = await repository.findAll();
    const stuck = items.filter((op) => op.status === "SYNCING");

    if (stuck.length === 0) return;

    await Promise.all(
      stuck.map((op) =>
        repository.update({ ...op, status: "PENDING_SYNC" })
      )
    );

    await this.refresh();
  }

  /** Operaciones listas para sincronizar: pendientes y de mesas SIN conflicto. */
  syncable(): PendingTableOperation[] {
    const blocked = blockedTableIds(this.snapshot.items);
    return this.snapshot.items.filter(
      (op) => op.status === "PENDING_SYNC" && !blocked.has(op.tableId)
    );
  }

  list(): PendingTableOperation[] {
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

export const pendingTableOperationsStore =
  new PendingTableOperationsStore();