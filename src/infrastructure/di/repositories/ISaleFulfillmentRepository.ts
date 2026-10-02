import type { KitchenOrder, Sale } from "../../../core/entities/Entities";
import type { IRepository } from "./IRepository";

export interface SaleFulfillmentItemInput {
  readonly productId: string;
  readonly quantity: number;
  readonly note?: string;
  readonly selectedSizeId?: string;
  readonly selectedExtraIds?: readonly string[];
}

export interface SaleFulfillmentInput {
  readonly id?: string;
  readonly type: "QUICK" | "TABLE" | "DELIVERY";
  readonly items: readonly SaleFulfillmentItemInput[];
  readonly customerId?: string;
  readonly tableId?: string;
  readonly deliveryAddress?: string;
  readonly deliveryFee?: number;
  readonly notes?: string;
  readonly waiterId?: string;
  readonly priority?: "NORMAL" | "HIGH" | "URGENT";
  readonly discount?: { readonly type: "PERCENT" | "FIXED"; readonly value: number };
  readonly tip?: { readonly type: "PERCENT" | "FIXED"; readonly value: number };
}

export interface CreateSaleFulfillmentRequest {
  readonly businessId: string;
  readonly branchId: string;
  readonly idempotencyKey: string;
  readonly input: SaleFulfillmentInput;
}

export interface CreateSaleFulfillmentResult {
  readonly sale: Sale;
  readonly kitchenOrder: KitchenOrder | null;
  readonly printerJobId: string | null;
  readonly idempotent: boolean;
}

export interface ISaleFulfillmentRepository extends IRepository<Sale> {
  createSaleFulfillmentAtomic(
    request: CreateSaleFulfillmentRequest
  ): Promise<CreateSaleFulfillmentResult>;
}