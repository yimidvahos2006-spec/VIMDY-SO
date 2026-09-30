import { Table } from "../entities/Entities";
import { OpenTableInput, CloseTableInput, AddProductInput } from "../engines/TableEngine";
import { TableLocalRepository } from "../../infrastructure/di/repositories/TableLocalRepository";
import { pendingTableOperationsStore } from "../offline/pendingTableOperationsStore";
import { toast } from "../store/toastStore";
import { vimdyCore } from "../VimdyCore";
import { companyConfigStore } from "../store/companyConfigStore";

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

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "OPEN",
    openInput: input
  });

  const optimistic: Table = {
    ...table,
    status: "BUSY",
    peopleCount: input.peopleCount,
    waiterId: input.waiterId,
    customerId: input.customerId,
    notes: input.notes,
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

export async function queueAddItemOffline(params: {
  table: Table;
  input: AddProductInput;
}): Promise<Table> {
  const { table, input } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "ADD_ITEM",
    addItemInput: {
      productId: input.product.id,
      quantity: input.quantity ?? 1,
      note: input.note
    }
  });

  const quantity = input.quantity ?? 1;
  const updatedSubtotal = table.subtotal + input.product.price * quantity;
  const taxRate = companyConfigStore.get().tax / 100;
  const updatedTax = Number((updatedSubtotal * taxRate).toFixed(2));
  const updated = {
    ...table,
    items: [...table.items, {
      productId: input.product.id,
      quantity,
      price: input.product.price,
      note: input.note,
      requiresKitchen: input.product.requiresKitchen
    }],
    subtotal: updatedSubtotal,
    tax: updatedTax,
    total: updatedSubtotal + updatedTax,
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(updated);
  }
  vimdyCore.emit("table", { action: "table.updated", table: updated });

  toast.warning(OFFLINE_ITEM_MESSAGE);

  return updated;
}

export async function queueRemoveItemOffline(params: {
  table: Table;
  productId: string;
}): Promise<Table> {
  const { table, productId } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "REMOVE_ITEM",
    removeItemInput: { productId }
  });

  const updatedItems = table.items.filter(item => item.productId !== productId);
  const subtotal = updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = Number((subtotal * (companyConfigStore.get().tax / 100)).toFixed(2));
  const total = subtotal + tax;

  const updated = {
    ...table,
    items: updatedItems,
    subtotal,
    tax,
    total,
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(updated);
  }
  vimdyCore.emit("table", { action: "table.updated", table: updated });

  toast.warning(OFFLINE_ITEM_MESSAGE);

  return updated;
}

export async function queueUpdateQuantityOffline(params: {
  table: Table;
  productId: string;
  quantity: number;
}): Promise<Table> {
  const { table, productId, quantity } = params;

  await pendingTableOperationsStore.enqueue({
    id: crypto.randomUUID(),
    tableId: table.id,
    tableName: table.name,
    type: "UPDATE_QUANTITY",
    updateQuantityInput: { productId, quantity }
  });

  const updatedItems = table.items.map(item =>
    item.productId === productId ? { ...item, quantity } : item
  );
  const subtotal = updatedItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
  const tax = Number((subtotal * (companyConfigStore.get().tax / 100)).toFixed(2));
  const total = subtotal + tax;

  const updated = {
    ...table,
    items: updatedItems,
    subtotal,
    tax,
    total,
    updatedAt: new Date()
  };

  if (typeof indexedDB !== "undefined") {
    await local.save(updated);
  }
  vimdyCore.emit("table", { action: "table.updated", table: updated });

  toast.warning(OFFLINE_ITEM_MESSAGE);

  return updated;
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
