import { OpenTableInput, CloseTableInput } from "../engines/TableEngine";
import { SaleItem } from "../entities/Entities";

export type PendingTableOperationStatus =
  | "PENDING_SYNC"
  | "SYNCING"
  | "FAILED"
  | "PERMANENT_FAILURE";

export type PendingTableOperationType = "OPEN" | "CLOSE" | "ADD_ITEM" | "REMOVE_ITEM" | "UPDATE_QUANTITY" | "SEND_TO_KITCHEN";

export interface PendingTableOperation {
  readonly id: string;
  readonly tableId: string;
  readonly tableName: string;
  readonly type: PendingTableOperationType;
  readonly openInput?: OpenTableInput;
  readonly closeInput?: CloseTableInput;
  readonly addItemInput?: { productId: string; quantity: number; note?: string };
  readonly removeItemInput?: { productId: string };
  readonly updateQuantityInput?: { productId: string; quantity: number };
  readonly sendToKitchenInput?: { priority?: string };
  readonly status: PendingTableOperationStatus;
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  readonly businessId: string;
  readonly branchId: string;
}