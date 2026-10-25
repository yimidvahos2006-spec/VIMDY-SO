import { Table } from "../entities/Entities";
import {
  OpenTableInput,
  CloseTableInput
} from "../engines/TableEngine";

export type PendingTableOperationStatus =
  | "PENDING_SYNC"
  | "SYNCING"
  | "FAILED"
  | "PERMANENT_FAILURE"
  /**
   * Conflicto de significado (mesa ya cobrada/cerrada, reabierta, etc.).
   * Bloquea las operaciones de ESA mesa; las demás mesas siguen sincronizando.
   * La operación NO se borra ni se reintenta: queda intacta para que
   * Caja/Admin la audite. El mesero nunca la resuelve.
   */
  | "CONFLICT";

/** Por qué el servidor no puede aceptar la operación tal como se hizo offline. */
export type TableConflictCode =
  | "TABLE_NOT_OPEN"
  | "TABLE_ALREADY_CLOSED"
  | "TABLE_NOT_AVAILABLE"
  | "TABLE_SESSION_CHANGED"
  | "TABLE_SALE_STALE"
  | "TABLE_NOTE_ALREADY_SENT"
  | "TABLE_NOT_FOUND";

export interface PendingTableConflict {
  readonly code: TableConflictCode;
  /** Mensaje técnico original del engine; es para auditoría, no para el mesero. */
  readonly detail: string;
  readonly detectedAt: Date;
}

export type PendingTableOperationType =
  | "OPEN"
  | "CLOSE"
  | "ADD_ITEM"
  | "REMOVE_ITEM"
  | "UPDATE_QUANTITY"
  | "UPDATE_NOTE"
  | "SEND_TO_KITCHEN";

/**
 * Variante de una línea de mesa (lo que, junto al producto y la nota, la
 * identifica). Ver tableLineRules.ts.
 */
export interface PendingLineVariant {
  readonly note?: string | null;
  readonly selectedSizeId?: string | null;
  readonly selectedExtraIds?: readonly string[] | null;
}

/**
 * Estado mínimo de una mesa usado para comprobar si una operación offline
 * ya llegó al servidor antes de volver a ejecutarla.
 *
 * No incluye `version`, `updatedAt`, `openedAt` ni `orderId`: esos campos
 * pueden cambiar como consecuencia legítima de la operación (por ejemplo,
 * al abrir una mesa se crea un Order con un id nuevo).
 */
export interface PendingTableStateSnapshot {
  readonly status: Table["status"];
  readonly peopleCount?: number;
  readonly waiterId?: string;
  readonly customerId?: string;
  readonly notes?: string;
  readonly items: Table["items"];
  readonly subtotal: number;
  readonly tax: number;
  readonly discount: number;
  readonly total: number;
  readonly openOperationId?: string;
}

export interface PendingTableOperation {
  readonly id: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly type: PendingTableOperationType;

  readonly openInput?: OpenTableInput;
  readonly closeInput?: CloseTableInput;

  readonly addItemInput?: {
    productId: string;
    quantity: number;
    note?: string;
    selectedSizeId?: string;
    selectedExtraIds?: readonly string[];
  };

  /**
   * `line` identifica la línea exacta (nota, tamaño, extras). Si falta
   * (operaciones guardadas por versiones anteriores), actúa sobre todas las
   * líneas del producto, como antes.
   */
  readonly removeItemInput?: {
    productId: string;
    line?: PendingLineVariant;
  };

  readonly updateQuantityInput?: {
    productId: string;
    quantity: number;
    line?: PendingLineVariant;
  };

  /** Cambia la nota de una línea (o de `units` unidades de ella). */
  readonly updateNoteInput?: {
    productId: string;
    fromNote?: string | null;
    toNote?: string | null;
    units?: number;
    selectedSizeId?: string | null;
    selectedExtraIds?: readonly string[] | null;
  };

  readonly sendToKitchenInput?: {
    priority?: string;
  };

  /** Estado remoto esperado antes de reproducir esta operación. */
  readonly expectedBefore?: PendingTableStateSnapshot;
  /** Estado remoto esperado después de reproducir esta operación. */
  readonly expectedAfter?: PendingTableStateSnapshot;

  readonly status: PendingTableOperationStatus;
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  /** Presente solo cuando status === "CONFLICT". */
  readonly conflict?: PendingTableConflict;
  readonly businessId: string;
  readonly branchId: string;
}