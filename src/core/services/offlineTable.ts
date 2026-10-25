import { Table } from "../entities/Entities";
import { OpenTableInput, CloseTableInput, AddProductInput } from "../engines/TableEngine";
import { TableLocalRepository } from "../../infrastructure/di/repositories/TableLocalRepository";
import { pendingTableOperationsStore } from "../offline/pendingTableOperationsStore";
import { toast } from "../store/toastStore";
import { vimdyCore } from "../VimdyCore";
import { companyConfigStore } from "../store/companyConfigStore";
import type { PendingLineVariant } from "../offline/PendingTableOperation";
import {
  applyLineOperation,
  computeTableTotals,
  resolveRequiresKitchen,
  type TableLineOperation
} from "../offline/tableLineRules";

const local = new TableLocalRepository();

const OFFLINE_OPEN_MESSAGE =
  "Sin conexión: la apertura de la mesa quedó guardada en este dispositivo y se sincronizará sola cuando vuelva internet.";

const OFFLINE_CLOSE_MESSAGE =
  "Sin conexión: el cierre de la mesa quedó guardado en este dispositivo. El recibo se generará cuando vuelva internet.";

const OFFLINE_ITEM_MESSAGE =
  "Sin conexión: el cambio quedó guardado en este dispositivo y se sincronizará solo cuando vuelva internet.";

export async function queueOpenTableOffline(params: {
  table: Table;
  input: OpenTableInput;
}): Promise<Table> {
  const { table, input } = params;

  const queued = await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "OPEN",
    openInput: input
  });

  const optimistic: Table = {
    ...table,
    status: "BUSY",
    // Identidad de la cuenta: las operaciones que se encolen después
    // guardan este id (expectedBefore.openOperationId) y, al sincronizar, el
    // engine puede detectar si la mesa ya tiene OTRA cuenta.
    openOperationId: queued.openInput?.operationId ?? table.openOperationId,
    peopleCount: input.peopleCount ?? table.peopleCount ?? 0,
    waiterId: input.waiterId ?? table.waiterId,
    customerId: input.customerId ?? table.customerId,
    notes: input.notes ?? table.notes,
    openedAt: new Date(),
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(optimistic);
  }
  vimdyCore.emit("table", { action: "table.opened", table: optimistic });

  toast.warning(OFFLINE_OPEN_MESSAGE);

  return optimistic;
}

export async function queueCloseTableOffline(params: {
  table: Table;
  input: CloseTableInput;
}): Promise<Table> {
  const { table, input } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "CLOSE",
    closeInput: input
  });

  const freed: Table = {
    ...table,
    status: "FREE",
    peopleCount: 0,
    waiterId: undefined,
    customerId: undefined,
    items: [],
    subtotal: 0,
    tax: 0,
    discount: 0,
    total: 0,
    notes: undefined,
    openedAt: undefined,
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(freed);
  }
  vimdyCore.emit("table", { action: "table.closed", table: freed });

  toast.warning(OFFLINE_CLOSE_MESSAGE);

  return freed;
}

/**
 * Aplica una operación de línea al estado local con LAS MISMAS reglas que
 * usa el engine al sincronizar (tableLineRules.ts): lo que el mesero ve sin
 * internet es lo que quedará después de sincronizar.
 */
async function saveOptimisticItems(
  table: Table,
  operation: TableLineOperation
): Promise<Table> {
  const items = applyLineOperation(table.items, operation);
  const updated: Table = {
    ...table,
    items,
    ...computeTableTotals(items, companyConfigStore.get().tax, table.discount ?? 0),
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(updated);
  }
  vimdyCore.emit("table", { action: "table.updated", table: updated });

  toast.warning(OFFLINE_ITEM_MESSAGE);

  return updated;
}

export async function queueAddItemOffline(params: {
  table: Table;
  input: AddProductInput;
}): Promise<Table> {
  const { table, input } = params;
  const quantity = input.quantity ?? 1;

  // Se valida ANTES de encolar: una cantidad inválida nunca entra a la cola.
  const operation: TableLineOperation = {
    type: "ADD_ITEM",
    product: {
      id: input.product.id,
      price: input.product.price,
      requiresKitchen: resolveRequiresKitchen(input.product)
    },
    quantity,
    note: input.note,
    selectedSizeId: input.selectedSizeId,
    selectedExtraIds: input.selectedExtraIds
  };
  applyLineOperation(table.items, operation);

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "ADD_ITEM",
    addItemInput: {
      productId: input.product.id,
      quantity,
      note: input.note,
      selectedSizeId: input.selectedSizeId ?? undefined,
      selectedExtraIds: input.selectedExtraIds ?? undefined
    }
  });

  return saveOptimisticItems(table, operation);
}

export async function queueRemoveItemOffline(params: {
  table: Table;
  productId: string;
  /** Línea exacta (nota, tamaño, extras). Sin ella se quitan todas las del producto. */
  line?: PendingLineVariant;
}): Promise<Table> {
  const { table, productId, line } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "REMOVE_ITEM",
    removeItemInput: { productId, line }
  });

  return saveOptimisticItems(table, {
    type: "REMOVE_ITEM",
    productId,
    line: line ? { productId, ...line } : undefined
  });
}

export async function queueUpdateQuantityOffline(params: {
  table: Table;
  productId: string;
  quantity: number;
  line?: PendingLineVariant;
}): Promise<Table> {
  const { table, productId, quantity, line } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "UPDATE_QUANTITY",
    updateQuantityInput: { productId, quantity, line }
  });

  return saveOptimisticItems(table, {
    type: "UPDATE_QUANTITY",
    productId,
    quantity,
    line: line ? { productId, ...line } : undefined
  });
}

export async function queueUpdateNoteOffline(params: {
  table: Table;
  productId: string;
  fromNote?: string | null;
  toNote?: string | null;
  /** Solo estas unidades pasan a la nota nueva; sin esto, toda la línea. */
  units?: number;
  selectedSizeId?: string | null;
  selectedExtraIds?: readonly string[] | null;
}): Promise<Table> {
  const { table, productId, fromNote, toNote, units, selectedSizeId, selectedExtraIds } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "UPDATE_NOTE",
    updateNoteInput: { productId, fromNote, toNote, units, selectedSizeId, selectedExtraIds }
  });

  return saveOptimisticItems(table, {
    type: "UPDATE_NOTE",
    line: { productId, note: fromNote, selectedSizeId, selectedExtraIds },
    toNote,
    units
  });
}

export async function queueSendToKitchenOffline(params: {
  table: Table;
  priority?: string;
}): Promise<void> {
  const { table, priority } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "SEND_TO_KITCHEN",
    sendToKitchenInput: { priority }
  });

  toast.warning(OFFLINE_ITEM_MESSAGE);
}