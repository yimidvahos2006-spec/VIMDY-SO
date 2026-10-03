import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import type { Table, SaleItem, Product, Order, Sale, KitchenOrder, OrderPriority } from "../entities/Entities";
import { isOptimisticLockError } from "../errors/OptimisticLockError";
import { CartEngine } from "./CartEngine";
import type { KitchenEngine } from "./KitchenEngine";
import type { SalesEngine } from "./SalesEngine";
import { OrderEngine } from "./OrderEngine";
import { companyConfigStore } from "../store/companyConfigStore";
import { getEffectiveKitchenOutputMode as resolveKitchenOutputMode } from "../services/effectiveKitchenOutputMode";
import { createKitchenOutput } from "../services/KitchenOutputFactory";
import type { PaymentMethod, PaymentResult } from "./PaymentEngine";
import type { Receipt } from "./ReceiptEngine";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";

export interface OpenTableInput {
  tableId?: string;
  peopleCount?: number;
  waiterId?: string;
  customerId?: string;
  notes?: string;
  operationId?: string;
  [key: string]: any;
}

export interface CloseTableInput {
  tableId?: string;
  method?: PaymentMethod;
  reason?: string;
  paymentMethod?: string;
  cashierId?: string;
  cashier?: string;
  received?: number;
  saleId?: string;
  [key: string]: any;
}

export interface AddProductInput {
  tableId?: string;
  productId?: string;
  product?: any;
  quantity?: number;
  note?: string;
  [key: string]: any;
}

export interface TableSession {
  id?: string;
  tableId?: string;
  kitchenOutputMode?: 'kds' | 'printer' | 'none';
  [key: string]: any;
}

export interface OrderItem {
  productId?: string;
  quantity?: number;
  requiresKitchen?: boolean;
  [key: string]: any;
}

export class TableEngine {
  private static readonly MAX_CONFLICT_RETRIES = 4;
  private readonly tableRepository?: IRepository<Table>;

  constructor(
    tableRepository?: IRepository<Table>,
    private readonly kitchen?: KitchenEngine,
    private readonly sales?: SalesEngine,
    private readonly orders?: OrderEngine
  ) {
    this.tableRepository = tableRepository;
  }

  private getRepository(): IRepository<Table> {
    if (!this.tableRepository) throw new Error("TABLE_REPOSITORY_REQUIRED");
    return this.tableRepository;
  }

  private async mutateItems(
    tableId: string,
    mutate: (cart: CartEngine) => void
  ): Promise<Table> {
    for (let attempt = 1; attempt <= TableEngine.MAX_CONFLICT_RETRIES; attempt++) {
      const table = await this.getTable(tableId);
      if (!table) throw new Error("TABLE_NOT_FOUND");

      const cart = new CartEngine();
      cart.loadItems(table.items);
      mutate(cart);

      try {
        return await this.persist(table, cart.getItems());
      } catch (error) {
        if (isOptimisticLockError(error) && attempt < TableEngine.MAX_CONFLICT_RETRIES) {
          await new Promise((resolve) => setTimeout(resolve, 25 * attempt));
          continue;
        }
        throw error;
      }
    }
    throw new Error("TABLE_UPDATE_CONFLICT");
  }

  private async persist(table: Table, items: SaleItem[]): Promise<Table> {
    const subtotal = Number(items.reduce((sum, item) => sum + item.price * item.quantity, 0).toFixed(2));
    const tax = Number((subtotal * (companyConfigStore.get().tax / 100)).toFixed(2));
    const total = Number(Math.max(subtotal + tax - (table.discount ?? 0), 0).toFixed(2));
    const updated: Table = { ...table, items, subtotal, tax, total, updatedAt: new Date() };
    await this.getRepository().update(updated);
    return updated;
  }

  private getEffectiveKitchenOutputMode(): ReturnType<typeof resolveKitchenOutputMode> {
    return resolveKitchenOutputMode();
  }

  public async createTable(input: { name: string; capacity?: number; [key: string]: any }): Promise<Table> {
    const businessId = input.businessId ?? getCurrentBusinessId() ?? undefined;
    const branchId = input.branchId ?? getCurrentBranchId() ?? undefined;
    const name = String(input.name ?? "").trim();
    if (!name) throw new Error("TABLE_NAME_REQUIRED");

    const duplicate = (await this.getRepository().findAll()).some((table) =>
      table.businessId === businessId && table.branchId === branchId && table.name.toLowerCase() === name.toLowerCase()
    );
    if (duplicate) throw new Error("TABLE_NAME_DUPLICATE");

    const now = new Date();
    const table: Table = {
      id: input.id ?? crypto.randomUUID(),
      businessId,
      branchId,
      name,
      capacity: input.capacity ?? 4,
      status: input.status ?? 'FREE',
      peopleCount: input.peopleCount ?? 0,
      waiterId: input.waiterId,
      customerId: input.customerId,
      notes: input.notes,
      items: input.items ?? [],
      subtotal: input.subtotal ?? 0,
      tax: input.tax ?? 0,
      discount: input.discount ?? 0,
      total: input.total ?? 0,
      updatedAt: now,
    };

    await this.getRepository().save(table);
    return table;
  }

  public async getAllTables(): Promise<Table[]> {
    return this.getRepository().findAll();
  }

  public async getTable(id: string): Promise<Table | null> {
    return this.getRepository().findById(id);
  }

  public async openTable(tableOrInput: string | OpenTableInput, input: OpenTableInput = {}): Promise<any> {
    const resolvedInput = typeof tableOrInput === 'string' ? input : tableOrInput;
    const tableId = typeof tableOrInput === 'string' ? tableOrInput : (resolvedInput.tableId ?? (tableOrInput as any).tableId);
    const table = tableId ? await this.getRepository().findById(tableId) : null;
    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.status !== "FREE" && table.status !== "RESERVED") {
      if (resolvedInput.operationId && table.openOperationId === resolvedInput.operationId) return table;
      throw new Error("TABLE_NOT_AVAILABLE");
    }

    let order: Order | undefined;
    if (this.orders) {
      // El fallo al crear el pedido se traduce a un error de dominio propio de
      // TableEngine. Sin este wrap, un fallo de DB (ORDER_DB_DOWN) se filtra
      // crudo al UI y el contrato de openTable se rompe para el consumidor.
      // Se conserva la causa original para no perder diagnostico.
      try {
        order = await this.orders.createOrder({
          source: "TABLE",
          tableId: table.id,
          waiterId: resolvedInput.waiterId,
          customerId: resolvedInput.customerId,
          notes: resolvedInput.notes
        });
      } catch (orderError) {
        // Se incluye la causa original en el mensaje porque el target de
        // TypeScript del proyecto no soporta la sobrecarga Error(msg, { cause }).
        throw new Error(
          `ORDER_CREATION_FAILED: no se pudo crear el pedido para la mesa "${table.name}". Causa: ${String(orderError)}`
        );
      }
    }

    const opened: Table = {
      ...table,
      status: 'BUSY',
      peopleCount: resolvedInput.peopleCount ?? table.peopleCount ?? 0,
      waiterId: resolvedInput.waiterId ?? table.waiterId,
      customerId: resolvedInput.customerId ?? table.customerId,
      notes: resolvedInput.notes ?? table.notes,
      openedAt: new Date(),
      openOperationId: resolvedInput.operationId,
      orderId: order?.id,
      updatedAt: new Date(),
    };

    await this.getRepository().update(opened);
    return opened;
  }

  public async closeTable(tableOrInput: string | CloseTableInput, input: CloseTableInput = {}): Promise<{ sale: Sale; payment: PaymentResult; receipt: Receipt }> {
    const resolvedInput = typeof tableOrInput === 'string' ? input : tableOrInput;
    const tableId = typeof tableOrInput === 'string' ? tableOrInput : (resolvedInput.tableId ?? (tableOrInput as any).tableId);
    if (!this.sales) throw new Error("SALES_ENGINE_REQUIRED");
    const method = resolvedInput.method ?? resolvedInput.paymentMethod as PaymentMethod | undefined;
    if (!method) throw new Error("PAYMENT_METHOD_REQUIRED");

    let sale: Sale | null = resolvedInput.saleId
      ? await this.sales.getSale(resolvedInput.saleId)
      : null;
    const table = tableId ? await this.getRepository().findById(tableId) : null;
    if (!table) throw new Error('TABLE_NOT_FOUND');

    if (!sale) {
      if (table.items.length === 0) throw new Error("EMPTY_TABLE");
      sale = await this.sales.tableSale({
        id: resolvedInput.saleId,
        tableId: table.id,
        source: table.items,
        cashierId: resolvedInput.cashierId,
        waiterId: table.waiterId,
        skipKitchen: true,
      });
    }

    const { sale: paidSale, payment } = await this.sales.registerPayment(sale, method, {
      received: resolvedInput.received,
      reference: resolvedInput.reference,
    });
    if (!payment.success) throw new Error("TABLE_PAYMENT_PENDING_VERIFICATION");

    const existingReceipt = await this.sales.getReceiptBySaleId(paidSale.id);
    const receipt = existingReceipt ?? await this.sales.generateReceipt(
      paidSale,
      resolvedInput.customerName ?? "Cliente General",
      resolvedInput.cashier ?? "Administrador",
      method,
      resolvedInput.received ?? paidSale.total,
      paidSale.discount ?? 0
    );
    if (!existingReceipt) this.sales.printReceipt(receipt);

    const orderId = table.orderId;
    if (orderId && this.orders) {
      await this.orders.updateOrder(orderId, { status: "COMPLETED", saleId: paidSale.id });
    }

    await this.updateTable(table.id, {
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
      openedAt: undefined,
      orderId: undefined
    });

    return { sale: paidSale, payment, receipt };
  }

  public async addItem(tableOrInput: string | AddProductInput, maybeInput?: AddProductInput): Promise<any> {
    const resolvedInput = typeof tableOrInput === 'string' ? (maybeInput ?? {}) : tableOrInput;
    const tableId = typeof tableOrInput === 'string' ? tableOrInput : (resolvedInput.tableId ?? (tableOrInput as any).tableId);
    const table = tableId ? await this.getRepository().findById(tableId) : null;
    if (!table) throw new Error('TABLE_NOT_FOUND');

    const product = resolvedInput.product ?? { id: resolvedInput.productId, price: 0, requiresKitchen: true };
    const item = {
      productId: resolvedInput.productId ?? product.id,
      quantity: resolvedInput.quantity ?? 1,
      price: product.price ?? 0,
      note: resolvedInput.note,
      requiresKitchen: product.requiresKitchen ?? true,
    };

    return this.mutateItems(table.id, (cart) => cart.addItem({
      id: item.productId,
      name: product.name ?? "Producto",
      price: item.price,
      requiresKitchen: item.requiresKitchen
    } as Product, item.quantity, item.note));
  }

  public async removeItem(tableId: string, productId: string): Promise<any> {
    return this.mutateItems(tableId, (cart) => cart.removeItem(productId));
  }

  public async updateItemQuantity(tableId: string, productId: string, quantity: number): Promise<any> {
    return this.mutateItems(tableId, (cart) => cart.updateQuantity(productId, quantity));
  }

  public async updateTable(tableId: string, patch: Record<string, any>): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error('TABLE_NOT_FOUND');

    const updated = { ...table, ...patch, updatedAt: new Date() };
    await this.getRepository().update(updated);
    return updated;
  }

  public async addPeople(tableId: string, count: number): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error('TABLE_NOT_FOUND');

    return this.updateTable(tableId, { peopleCount: (table.peopleCount ?? 0) + count });
  }

  public async requestBill(tableId: string): Promise<any> {
    return this.updateTable(tableId, { status: "CUENTA_SOLICITADA" });
  }

  public async releaseEmptyTable(tableId: string, _reasonOrInput?: any): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.items.length > 0) throw new Error("TABLE_NOT_EMPTY");
    return this.updateTable(tableId, {
      status: "FREE",
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      openedAt: undefined,
      orderId: undefined
    });
  }

  public async cancelTableOrder(tableId: string, _reason?: string): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error('TABLE_NOT_FOUND');

    return this.updateTable(tableId, {
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      notes: _reason ?? table.notes
    });
  }

  public async mergeTables(fromId: string, toId: string): Promise<any> {
    const fromTable = await this.getRepository().findById(fromId);
    const toTable = await this.getRepository().findById(toId);
    if (!fromTable || !toTable) throw new Error('TABLE_NOT_FOUND');

    const merged = await this.mutateItems(toId, (cart) => {
      fromTable.items.forEach((item) => cart.addItem({
        id: item.productId,
        name: item.productId,
        price: item.price,
        categoryId: "uncategorized",
        stock: 0,
        minStock: 0,
        lastUpdated: new Date(),
        requiresKitchen: item.requiresKitchen
      }, item.quantity, item.note));
    });
    await this.updateTable(fromId, { status: "CLOSED", items: [], subtotal: 0, tax: 0, total: 0 });
    return merged;
  }

  public async transferTable(tableId: string, targetId: string): Promise<any> {
    const source = await this.getRepository().findById(tableId);
    const target = await this.getRepository().findById(targetId);
    if (!source || !target) throw new Error('TABLE_NOT_FOUND');

    if (target.status !== "FREE") throw new Error("TABLE_NOT_AVAILABLE");
    await this.updateTable(targetId, {
      status: source.status,
      waiterId: source.waiterId,
      customerId: source.customerId,
      peopleCount: source.peopleCount,
      items: source.items,
      subtotal: source.subtotal,
      tax: source.tax,
      discount: source.discount,
      total: source.total
    });
    await this.updateTable(tableId, { status: "FREE", waiterId: undefined, customerId: undefined, peopleCount: 0, items: [], subtotal: 0, tax: 0, total: 0 });
    return this.getRepository().findById(targetId);
  }

  public splitBill(tableOrId: string | any, splitsOrCount?: any[] | number): { perPerson: number; total: number } {
    const table = typeof tableOrId === 'string' ? undefined : tableOrId;
    if (!table) throw new Error('TABLE_NOT_FOUND');

    const count = typeof splitsOrCount === 'number' ? splitsOrCount : (Array.isArray(splitsOrCount) ? splitsOrCount.length : 2);
    const total = Number(table.total ?? 0);
    const perPerson = total / Math.max(count, 1);
    table.billSplit = true;
    table.updatedAt = new Date();
    return { perPerson, total };
  }

  public async reserveTable(tableId: string, input: Record<string, any> = {}): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error('TABLE_NOT_FOUND');

    return this.updateTable(tableId, {
      status: 'RESERVED',
      customerId: input.customerId ?? table.customerId,
      notes: input.notes ?? table.notes,
    });
  }

  public async getAverageDuration(_businessId?: string): Promise<number> {
    return 0;
  }

  public async sendToKitchen(tableId: string, priority: OrderPriority = "NORMAL"): Promise<KitchenOrder | null> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.status === "FREE" || table.status === "CLOSED") throw new Error("TABLE_NOT_OPEN");
    if (!this.kitchen) throw new Error("KITCHEN_ENGINE_REQUIRED");

    const previousOrders = await this.kitchen.getByTableId(table.id);
    const sentQuantities = new Map<string, number>();
    for (const previous of previousOrders) {
      for (const item of previous.items) {
        sentQuantities.set(item.productId, (sentQuantities.get(item.productId) ?? 0) + item.quantity);
      }
    }

    const kitchenItems = table.items
      .filter((item) => item.requiresKitchen === true)
      .map((item) => {
        const sent = sentQuantities.get(item.productId) ?? 0;
        if (item.quantity <= sent) return null;
        return { ...item, quantity: item.quantity - sent };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (kitchenItems.length === 0) return null;

    const outputMode = this.getEffectiveKitchenOutputMode();
    if (outputMode === "none") {
      throw new Error("KITCHEN_OUTPUT_NOT_CONFIGURED");
    }

    const kitchenOrder: KitchenOrder = {
      id: crypto.randomUUID(),
      tableId: table.id,
      orderId: table.orderId,
      businessId: table.businessId ?? getCurrentBusinessId() ?? undefined,
      branchId: table.branchId ?? getCurrentBranchId() ?? undefined,
      origin: table.name,
      waiterId: table.waiterId,
      items: kitchenItems,
      status: "PENDIENTE",
      priority,
      createdAt: new Date()
    };

    await createKitchenOutput(outputMode, this.kitchen).send(kitchenOrder);
    await this.updateTable(table.id, { status: "CUENTA_SOLICITADA" });
    return kitchenOrder;
  }
}

export const tableEngine = new TableEngine();