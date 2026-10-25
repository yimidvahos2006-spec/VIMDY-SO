// src/core/offline/tableLineRules.ts
/* ===========================================================================
   Reglas de línea de mesa — FUENTE ÚNICA (puras, sin base de datos)
   ---------------------------------------------------------------------------
   Una misma regla gobierna cuatro sitios; por eso vive aquí y nada más:
     1. CartEngine / TableEngine (la operación online real).
     2. offlineTable.ts (el estado optimista que ve el mesero sin internet).
     3. pendingTableOperationsStore (el `expectedAfter` de cada operación).
     4. syncPendingTableOperations (reproduce la operación contra el engine).

   Identidad de línea: producto + tamaño + extras (sin importar el orden) +
   nota normalizada. Dos líneas con la misma identidad son LA MISMA línea y se
   unifican; con distinta identidad, nunca se mezclan.

   Este archivo no importa nada de engines ni de stores: solo tipos.
=========================================================================== */

import type { SaleItem } from "../entities/Entities";

/** Nota normalizada: sin espacios sobrantes; "sin nota" es siempre "". */
export function normalizeLineNote(note?: string | null): string {
  return (note ?? "").trim();
}

/** Referencia a una línea de mesa (lo mínimo que la identifica). */
export interface LineRef {
  readonly productId: string;
  readonly note?: string | null;
  readonly selectedSizeId?: string | null;
  readonly selectedExtraIds?: readonly string[] | null;
}

function normalizeExtras(extras?: readonly string[] | null): string[] {
  return [...new Set((extras ?? []).map((id) => String(id)))].sort();
}

/** Clave estable de identidad: dos líneas con la misma clave son la misma. */
export function lineKey(ref: LineRef): string {
  return JSON.stringify([
    ref.productId,
    ref.selectedSizeId ?? null,
    normalizeExtras(ref.selectedExtraIds),
    normalizeLineNote(ref.note)
  ]);
}

export function sameLine(item: LineRef, ref: LineRef): boolean {
  return lineKey(item) === lineKey(ref);
}

/** Extrae la referencia de una línea ya existente. */
export function lineRefOf(item: SaleItem): LineRef {
  return {
    productId: item.productId,
    note: item.note,
    selectedSizeId: item.selectedSizeId,
    selectedExtraIds: item.selectedExtraIds
  };
}

/** Misma regla que TableEngine.addItem: un ingrediente nunca va a cocina. */
export function resolveRequiresKitchen(product: {
  isIngredient?: boolean;
  requiresKitchen?: boolean;
}): boolean {
  return !product.isIngredient && (product.requiresKitchen ?? false);
}

export type TableLineOperation =
  | {
      readonly type: "ADD_ITEM";
      readonly product: { id: string; price: number; requiresKitchen?: boolean };
      readonly quantity: number;
      readonly note?: string | null;
      readonly selectedSizeId?: string | null;
      readonly selectedExtraIds?: readonly string[] | null;
    }
  | { readonly type: "REMOVE_ITEM"; readonly line?: LineRef; readonly productId?: string }
  | {
      readonly type: "UPDATE_QUANTITY";
      readonly line?: LineRef;
      readonly productId?: string;
      readonly quantity: number;
    }
  | {
      readonly type: "UPDATE_NOTE";
      readonly line: LineRef;
      readonly toNote?: string | null;
      /** Solo estas unidades pasan a la nota nueva (parcial). */
      readonly units?: number;
    };

/**
 * Aplica UNA operación sobre las líneas y devuelve líneas nuevas (no muta).
 *
 * - ADD_ITEM: suma a la línea idéntica; si no existe, crea una.
 * - REMOVE_ITEM / UPDATE_QUANTITY: con `line` actúan solo sobre esa línea;
 *   solo con `productId` (operaciones viejas de la cola) actúan sobre todas
 *   las líneas de ese producto, como antes.
 * - UPDATE_NOTE: mueve toda la línea (o `units`) a la nota nueva; si ya
 *   existe una línea idéntica con esa nota, se unifican.
 */
export function applyLineOperation(
  items: readonly SaleItem[],
  operation: TableLineOperation
): SaleItem[] {
  const current = items.map((item) => ({ ...item }));

  switch (operation.type) {
    case "ADD_ITEM": {
      if (!Number.isFinite(operation.quantity) || operation.quantity <= 0) {
        throw new Error("VALIDATION_ERROR: la cantidad a agregar debe ser mayor que cero.");
      }
      const note = normalizeLineNote(operation.note);
      const ref: LineRef = {
        productId: operation.product.id,
        note,
        selectedSizeId: operation.selectedSizeId,
        selectedExtraIds: operation.selectedExtraIds
      };
      const index = current.findIndex((item) => sameLine(item, ref));

      if (index >= 0) {
        current[index] = {
          ...current[index],
          quantity: Number((current[index].quantity + operation.quantity).toFixed(6))
        };
        return current;
      }

      const extras = normalizeExtras(operation.selectedExtraIds);
      return [
        ...current,
        {
          productId: operation.product.id,
          quantity: operation.quantity,
          price: operation.product.price,
          ...(note ? { note } : {}),
          ...(operation.selectedSizeId ? { selectedSizeId: operation.selectedSizeId } : {}),
          ...(extras.length > 0 ? { selectedExtraIds: extras } : {}),
          requiresKitchen: operation.product.requiresKitchen ?? false
        }
      ];
    }

    case "REMOVE_ITEM": {
      const target = targetMatcher(operation);
      return current.filter((item) => !target(item));
    }

    case "UPDATE_QUANTITY": {
      const target = targetMatcher(operation);
      if (operation.quantity <= 0) return current.filter((item) => !target(item));
      return current.map((item) => (target(item) ? { ...item, quantity: operation.quantity } : item));
    }

    case "UPDATE_NOTE":
      return moveLineNote(current, operation.line, operation.toNote, operation.units);
  }
}

function targetMatcher(operation: {
  line?: LineRef;
  productId?: string;
}): (item: SaleItem) => boolean {
  const { line, productId } = operation;
  if (line) return (item) => sameLine(item, line);
  if (productId) return (item) => item.productId === productId;
  return () => false;
}

function moveLineNote(
  items: SaleItem[],
  from: LineRef,
  toNote: string | null | undefined,
  units?: number
): SaleItem[] {
  const to = normalizeLineNote(toNote);
  if (normalizeLineNote(from.note) === to) return items;

  const index = items.findIndex((item) => sameLine(item, from));
  if (index < 0) return items;

  const line = items[index];
  const isPartial =
    units !== undefined &&
    Number.isFinite(units) &&
    units >= 1 &&
    units < line.quantity &&
    line.quantityRaw === undefined;
  const moved = isPartial ? Math.trunc(units as number) : line.quantity;

  const withNote = (item: SaleItem, quantity: number): SaleItem => {
    const { note: _omit, ...rest } = item;
    return { ...rest, quantity, ...(to ? { note: to } : {}) };
  };

  const targetRef: LineRef = { ...lineRefOf(line), note: to };
  const targetIndex = items.findIndex((item, i) => i !== index && sameLine(item, targetRef));
  const next = items.map((item) => ({ ...item }));

  if (targetIndex >= 0) {
    next[targetIndex] = { ...next[targetIndex], quantity: next[targetIndex].quantity + moved };
    if (isPartial) next[index] = { ...next[index], quantity: line.quantity - moved };
    else next.splice(index, 1);
  } else if (isPartial) {
    next[index] = { ...next[index], quantity: line.quantity - moved };
    next.splice(index + 1, 0, withNote(line, moved));
  } else {
    next[index] = withNote(line, line.quantity);
  }

  return next;
}

/** Totales de la cuenta: mismo redondeo que TableEngine.persist(). */
export function computeTableTotals(
  items: readonly SaleItem[],
  taxPercent: number,
  discount = 0
): { subtotal: number; tax: number; total: number } {
  const subtotal = Number(
    items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2)
  );
  const tax = Number((subtotal * (taxPercent / 100)).toFixed(2));
  const total = Number(Math.max(subtotal + tax - discount, 0).toFixed(2));
  return { subtotal, tax, total };
}

/**
 * Convierte una operación de la cola en una TableLineOperation. Devuelve
 * `undefined` si la operación no toca líneas (OPEN, CLOSE, SEND_TO_KITCHEN)
 * o si faltan datos (p. ej. el producto ya no está en el catálogo).
 */
export function lineOperationFromPending(
  pending: {
    readonly type: string;
    readonly addItemInput?: {
      productId: string;
      quantity: number;
      note?: string;
      selectedSizeId?: string;
      selectedExtraIds?: readonly string[];
    };
    readonly removeItemInput?: { productId: string; line?: Omit<LineRef, "productId"> };
    readonly updateQuantityInput?: {
      productId: string;
      quantity: number;
      line?: Omit<LineRef, "productId">;
    };
    readonly updateNoteInput?: {
      productId: string;
      fromNote?: string | null;
      toNote?: string | null;
      units?: number;
      selectedSizeId?: string | null;
      selectedExtraIds?: readonly string[] | null;
    };
  },
  resolveProduct: (productId: string) =>
    | { id: string; price: number; isIngredient?: boolean; requiresKitchen?: boolean }
    | undefined
): TableLineOperation | undefined {
  if (pending.type === "ADD_ITEM" && pending.addItemInput) {
    const input = pending.addItemInput;
    const product = resolveProduct(input.productId);
    if (!product) return undefined;
    return {
      type: "ADD_ITEM",
      product: {
        id: product.id,
        price: product.price,
        requiresKitchen: resolveRequiresKitchen(product)
      },
      quantity: input.quantity,
      note: input.note,
      selectedSizeId: input.selectedSizeId,
      selectedExtraIds: input.selectedExtraIds
    };
  }

  if (pending.type === "REMOVE_ITEM" && pending.removeItemInput) {
    const { productId, line } = pending.removeItemInput;
    return { type: "REMOVE_ITEM", productId, line: line ? { productId, ...line } : undefined };
  }

  if (pending.type === "UPDATE_QUANTITY" && pending.updateQuantityInput) {
    const { productId, quantity, line } = pending.updateQuantityInput;
    return {
      type: "UPDATE_QUANTITY",
      productId,
      quantity,
      line: line ? { productId, ...line } : undefined
    };
  }

  if (pending.type === "UPDATE_NOTE" && pending.updateNoteInput) {
    const input = pending.updateNoteInput;
    return {
      type: "UPDATE_NOTE",
      line: {
        productId: input.productId,
        note: input.fromNote,
        selectedSizeId: input.selectedSizeId,
        selectedExtraIds: input.selectedExtraIds
      },
      toNote: input.toNote,
      units: input.units
    };
  }

  return undefined;
}