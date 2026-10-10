import { Table } from "../entities/Entities";
import {
  OpenTableInput,
  CloseTableInput
} from "../engines/TableEngine";

export type PendingTableOperationStatus =
  | "PENDING_SYNC"
  | "SYNCING"
  | "FAILED"
  | "PERMANENT_FAILURE";

export type PendingTableOperationType =
  | "OPEN"
  | "CLOSE"
  | "ADD_ITEM"
  | "REMOVE_ITEM"
  | "UPDATE_QUANTITY"
  | "SEND_TO_KITCHEN";

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
  };

  readonly removeItemInput?: {
    productId: string;
  };

  readonly updateQuantityInput?: {
    productId: string;
    quantity: number;
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
  readonly businessId: string;
  readonly branchId: string;
}
