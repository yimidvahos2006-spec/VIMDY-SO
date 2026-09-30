import { KitchenOrder } from "../entities/Entities";

export type PendingKitchenOrderStatus =
  | "PENDING_SYNC"
  | "SYNCING"
  | "FAILED"
  | "PERMANENT_FAILURE";

export interface PendingKitchenOrder {
  readonly id: string;
  readonly order: KitchenOrder;
  readonly status: PendingKitchenOrderStatus;
  readonly queuedAt: Date;
  readonly attempts: number;
  readonly lastAttemptAt?: Date;
  readonly lastError?: string;
  readonly businessId: string;
  readonly branchId: string;
}
