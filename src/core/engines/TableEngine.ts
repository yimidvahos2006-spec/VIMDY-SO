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

async function deterministicUuid(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed)
  );
  const bytes = new Uint8Array(digest).slice(0, 16);

  // UUID v8 determinista: el mismo intento vuelve a producir el mismo ID.
  bytes[6] = (bytes[6] & 0x0f) | 0x80;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;

  const hex = Array.from(bytes, (value) =>
    value.toString(16).padStart(2, "0")
  ).join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32)
  ].join("-");
}

function kitchenFingerprint(
  sessionIdentity: string,
  items: SaleItem[],
  priority: OrderPriority
): string {
  const normalized = [...items]
    .sort((a, b) =>
      a.productId.localeCompare(b.productId) ||
      a.quantity - b.quantity ||
      a.price - b.price ||
      String(a.note ?? "").localeCompare(String(b.note ?? ""))
    )
    .map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      price: Number(item.price.toFixed(2)),
      note: item.note ?? "",
      requiresKitchen: item.requiresKitchen === true,
      selectedSizeId: item.selectedSizeId ?? null,
      selectedExtraIds: item.selectedExtraIds ?? []
    }));

  return JSON.stringify({ sessionIdentity, priority, items: normalized });
}

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
    const resolvedInput = typeof tableOrInput === "string" ? input : tableOrInput;
    const tableId =
      typeof tableOrInput === "string"
        ? tableOrInput
        : (resolvedInput.tableId ?? (tableOrInput as any).tableId);

    const table = tableId
      ? await this.getRepository().findById(tableId)
      : null;

    if (!table) throw new Error("TABLE_NOT_FOUND");

    const providedOperationId = resolvedInput.operationId?.trim() || undefined;

    if (table.status !== "FREE" && table.status !== "RESERVED") {
      if (
        providedOperationId &&
        table.openOperationId === providedOperationId
      ) {
        return table;
      }

      throw new Error("TABLE_NOT_AVAILABLE");
    }

    // Una apertura necesita una identidad estable para poder recuperarse si
    // la red cae después de crear el Order. En offline esta identidad llega
    // desde pendingTableOperationsStore; en online se genera una sola vez
    // por invocación. Si la respuesta se pierde, createOrder() puede además
    // reconciliar el Order ya persistido por su operationId.
    const operationId =
      providedOperationId ?? crypto.randomUUID();

    let order: Order | undefined;

    if (this.orders) {
      try {
        order = await this.orders.createOrder({
          id: await deterministicUuid(
            `vimdy:table-order:${operationId}`
          ),
          operationId,
          source: "TABLE",
          tableId: table.id,
          waiterId: resolvedInput.waiterId,
          customerId: resolvedInput.customerId,
          notes: resolvedInput.notes,
          peopleCount: resolvedInput.peopleCount
        });
      } catch (orderError) {
        // Si otro intento terminó la inserción antes de que esta llamada
        // recibiera la respuesta, buscar el Order activo por mesa permite
        // recuperar la operación sin generar otro pedido.
        try {
          const activeOrders = await this.orders.getOrdersByTable(table.id);
          const recovered = activeOrders
            .filter((candidate) =>
              candidate.status !== "COMPLETED" &&
              candidate.status !== "CANCELLED"
            )
            .find((candidate) =>
              (candidate as Order & { openOperationId?: string })
                .openOperationId === operationId
            );

          if (recovered) {
            order = recovered;
          } else {
            throw orderError;
          }
        } catch (recoveryError) {
          throw new Error(
            `ORDER_CREATION_FAILED: no se pudo crear/recuperar el pedido para la mesa "${table.name}". Causa: ${String(recoveryError)}`
          );
        }
      }
    }

    // La migration operacional instala un trigger que abre la mesa de forma
    // atómica junto con INSERT de orders. Por compatibilidad, si el trigger
    // aún no existe, hacemos el update normal; si ya existe y sincronizó la
    // mesa, evitamos sobrescribir esa versión con una lectura vieja.
    const currentAfterOrder = await this.getRepository().findById(table.id);

    if (
      currentAfterOrder &&
      currentAfterOrder.status !== "FREE" &&
      order?.id &&
      currentAfterOrder.orderId === order.id &&
      currentAfterOrder.openOperationId === operationId
    ) {
      return currentAfterOrder;
    }

    const opened: Table = {
      ...(currentAfterOrder ?? table),
      status: "BUSY",
      peopleCount:
        resolvedInput.peopleCount ??
        currentAfterOrder?.peopleCount ??
        table.peopleCount ??
        0,
      waiterId:
        resolvedInput.waiterId ??
        currentAfterOrder?.waiterId ??
        table.waiterId,
      customerId:
        resolvedInput.customerId ??
        currentAfterOrder?.customerId ??
        table.customerId,
      notes:
        resolvedInput.notes ??
        currentAfterOrder?.notes ??
        table.notes,
      openedAt:
        currentAfterOrder?.openedAt ?? new Date(),
      openOperationId: operationId,
      orderId: order?.id ?? currentAfterOrder?.orderId,
      updatedAt: new Date()
    };

    try {
      await this.getRepository().update(opened);
    } catch (error) {
      if (isOptimisticLockError(error)) {
        const reconciled = await this.getRepository().findById(table.id);
        if (
          reconciled &&
          reconciled.orderId === opened.orderId &&
          reconciled.openOperationId === operationId
        ) {
          return reconciled;
        }
      }
      throw error;
    }

    return (await this.getRepository().findById(table.id)) ?? opened;
  }

  public async closeTable(tableOrInput: string | CloseTableInput, input: CloseTableInput = {}): Promise<{ sale: Sale; payment: PaymentResult; receipt: Receipt }> {
    const resolvedInput = typeof tableOrInput === "string" ? input : tableOrInput;
    const tableId =
      typeof tableOrInput === "string"
        ? tableOrInput
        : (resolvedInput.tableId ?? (tableOrInput as any).tableId);

    if (!this.sales) throw new Error("SALES_ENGINE_REQUIRED");

    const method =
      resolvedInput.method ??
      (resolvedInput.paymentMethod as PaymentMethod | undefined);

    if (!method) throw new Error("PAYMENT_METHOD_REQUIRED");

    let table = tableId
      ? await this.getRepository().findById(tableId)
      : null;

    if (!table) throw new Error("TABLE_NOT_FOUND");

    const stableSaleId =
      resolvedInput.saleId?.trim() ||
      (table.openOperationId
        ? await deterministicUuid(
            `vimdy:table-sale:${table.openOperationId}`
          )
        : table.orderId
          ? await deterministicUuid(
              `vimdy:table-sale:order:${table.orderId}`
            )
          : undefined);

    let sale: Sale | null = stableSaleId
      ? await this.sales.getSale(stableSaleId)
      : null;

    if (!sale && table.status === "FREE") {
      // El trigger guarda lastSaleId al liberar la mesa. Eso permite que una
      // respuesta perdida por la red sea recuperable incluso cuando el caller
      // no conservó saleId en memoria. La apertura de la siguiente sesión
      // limpia este campo.
      const lastSaleId = (table as Table & { lastSaleId?: string }).lastSaleId;
      if (lastSaleId) {
        sale = await this.sales.getSale(lastSaleId);
      }

      if (!sale) {
        throw new Error("TABLE_ALREADY_CLOSED");
      }
    }

    if (!sale) {
      if (table.items.length === 0) throw new Error("EMPTY_TABLE");

      sale = await this.sales.tableSale({
        id: stableSaleId,
        tableId: table.id,
        source: table.items,
        cashierId: resolvedInput.cashierId,
        waiterId: table.waiterId,
        skipKitchen: true
      });
    }

    const { sale: paidSale, payment } =
      await this.sales.registerPayment(
        sale,
        method,
        {
          received: resolvedInput.received,
          reference: resolvedInput.reference
        }
      );

    if (!payment.success) {
      throw new Error("TABLE_PAYMENT_PENDING_VERIFICATION");
    }

    const existingReceipt =
      await this.sales.getReceiptBySaleId(paidSale.id);

    const receipt =
      existingReceipt ??
      (await this.sales.generateReceipt(
        paidSale,
        resolvedInput.customerName ?? "Cliente General",
        resolvedInput.cashier ?? "Administrador",
        method,
        resolvedInput.received ?? paidSale.total,
        paidSale.discount ?? 0
      ));

    if (!existingReceipt) {
      this.sales.printReceipt(receipt);
    }

    // register_sale_payment_atomic() cambia la venta a PAID dentro de la
    // misma transacción. La migration operacional instala un trigger que,
    // al detectar ese cambio, completa el Order y libera la Table dentro de
    // esa misma transacción. Aquí solo reconciliamos para instalaciones donde
    // la migration todavía no esté presente o para registros antiguos.
    table = await this.getRepository().findById(table.id);

    if (table && table.status !== "FREE") {
      try {
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
          orderId: undefined,
          openOperationId: undefined
        });
      } catch (error) {
        if (!isOptimisticLockError(error)) throw error;
      }
    }

    if (this.orders && table?.orderId) {
      try {
        const currentOrder =
          await this.orders.getOrder(table.orderId);

        if (
          currentOrder.status !== "COMPLETED" &&
          currentOrder.status !== "CANCELLED"
        ) {
          await this.orders.updateOrder(
            currentOrder.id,
            { status: "COMPLETED", saleId: paidSale.id }
          );
        }
      } catch (error) {
        if (!String(error).includes("ORDER_NOT_FOUND")) {
          throw error;
        }
      }
    }

    return {
      sale: paidSale,
      payment,
      receipt
    };
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
    if (!table) throw new Error("TABLE_NOT_FOUND");

    const updated = {
      ...table,
      ...patch,
      ...(patch.status === "FREE"
        ? {
            peopleCount: 0,
            waiterId: undefined,
            customerId: undefined,
            openedAt: undefined,
            orderId: undefined,
            openOperationId: undefined
          }
        : {}),
      updatedAt: new Date()
    };

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

  public async releaseEmptyTable(tableId: string, reasonOrInput?: any): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.items.length > 0) throw new Error("TABLE_NOT_EMPTY");

    if (table.orderId && this.orders) {
      const order = await this.orders.getOrder(table.orderId);
      if (order.status !== "COMPLETED" && order.status !== "CANCELLED") {
        await this.orders.updateOrder(order.id, {
          status: "CANCELLED",
          cancelReason: String(reasonOrInput?.reason ?? "Mesa liberada sin consumo")
        });
      }
    }

    return this.updateTable(tableId, {
      status: "FREE",
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      openedAt: undefined,
      orderId: undefined,
      openOperationId: undefined
    });
  }

  public async cancelTableOrder(tableId: string, reason?: string): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");

    if (table.orderId && this.orders) {
      const order = await this.orders.getOrder(table.orderId);
      if (order.status !== "COMPLETED" && order.status !== "CANCELLED") {
        await this.orders.updateOrder(order.id, {
          status: "CANCELLED",
          cancelReason: reason?.trim() || "Pedido de mesa cancelado"
        });
      }
    }

    return this.updateTable(tableId, {
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      notes: reason?.trim() || table.notes
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
    await this.updateTable(fromId, {
      status: "CLOSED",
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      orderId: undefined,
      openOperationId: undefined
    });
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
      total: source.total,
      orderId: source.orderId,
      openOperationId: source.openOperationId,
      openedAt: source.openedAt,
      notes: source.notes
    });
    await this.updateTable(tableId, {
      status: "FREE",
      waiterId: undefined,
      customerId: undefined,
      peopleCount: 0,
      items: [],
      subtotal: 0,
      tax: 0,
      total: 0,
      notes: undefined,
      openedAt: undefined,
      orderId: undefined,
      openOperationId: undefined
    });
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

  public async sendToKitchen(
    tableId: string,
    priority: OrderPriority = "NORMAL"
  ): Promise<KitchenOrder | null> {
    const table = await this.getRepository().findById(tableId);

    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.status === "FREE" || table.status === "CLOSED") {
      throw new Error("TABLE_NOT_OPEN");
    }
    if (!this.kitchen) throw new Error("KITCHEN_ENGINE_REQUIRED");

    const activeOrderId = table.orderId;
    const sessionIdentity =
      table.openOperationId ?? activeOrderId ?? table.id;

    const previousOrders = await this.kitchen.getByTableId(table.id);

    // SOLAMENTE la sesión/orden activa participa en el cálculo de lo ya
    // enviado. Esto elimina el bug de sumar comandas de una visita anterior
    // a la misma mesa. Los registros legacy sin session id se aceptan solo
    // cuando fueron creados después de openedAt y pertenecen al orderId activo.
    const sessionOrders = previousOrders.filter((previous) => {
      const extended = previous as KitchenOrder & {
        tableSessionId?: string;
      };

      if (activeOrderId && previous.orderId) {
        return previous.orderId === activeOrderId;
      }

      if (extended.tableSessionId) {
        return extended.tableSessionId === sessionIdentity;
      }

      if (table.openedAt) {
        return (
          new Date(previous.createdAt).getTime() >=
          new Date(table.openedAt).getTime()
        );
      }

      return false;
    });

    const sentQuantities = new Map<string, number>();

    for (const previous of sessionOrders) {
      if (previous.status === "CANCELADO") continue;
      for (const item of previous.items) {
        sentQuantities.set(
          item.productId,
          (sentQuantities.get(item.productId) ?? 0) + item.quantity
        );
      }
    }

    const kitchenItems = table.items
      .filter((item) => item.requiresKitchen === true)
      .map((item) => {
        const sent = sentQuantities.get(item.productId) ?? 0;
        if (item.quantity <= sent) return null;
        return {
          ...item,
          quantity: item.quantity - sent
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (kitchenItems.length === 0) {
      const existing = [...sessionOrders]
        .reverse()
        .find((candidate) => candidate.status !== "CANCELADO");

      // Si la comanda ya fue persistida y la respuesta se perdió, el retry
      // llega aquí porque todos los items vigentes ya están contabilizados.
      // Recuperamos la comanda existente y reconciliamos el estado de mesa en
      // lugar de devolver una falsa operación vacía.
      if (existing) {
        await this.reconcileKitchenTableStatus(table);
        return existing;
      }

      return null;
    }

    const outputMode = this.getEffectiveKitchenOutputMode();

    if (outputMode === "none") {
      throw new Error("KITCHEN_OUTPUT_NOT_CONFIGURED");
    }

    const sendSequence = sessionOrders.reduce((max, candidate) => {
      const sequence = Number(
        (candidate as KitchenOrder & { sendSequence?: number }).sendSequence
      );
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, sessionOrders.length);

    const sendIdentity = kitchenFingerprint(
      `${sessionIdentity}:${sendSequence + 1}`,
      kitchenItems,
      priority
    );

    const sendOperationId = await deterministicUuid(
      `vimdy:table-kitchen-send:${sendIdentity}`
    );

    const kitchenOrderId = await deterministicUuid(
      `vimdy:kitchen-order:${sendOperationId}`
    );

    const existing = sessionOrders.find(
      (candidate) => candidate.id === kitchenOrderId
    );

    if (existing && existing.status !== "CANCELADO") {
      if (table.status === "BUSY") {
        await this.reconcileKitchenTableStatus(table);
      }
      return existing;
    }

    const kitchenOrder = {
      id: kitchenOrderId,
      tableId: table.id,
      orderId: activeOrderId,
      businessId:
        table.businessId ?? getCurrentBusinessId() ?? undefined,
      branchId:
        table.branchId ?? getCurrentBranchId() ?? undefined,
      origin: table.name,
      waiterId: table.waiterId,
      items: kitchenItems,
      status: "PENDIENTE" as const,
      priority,
      createdAt: new Date(),
      sendOperationId,
      tableSessionId: sessionIdentity,
      sendSequence: sendSequence + 1
    } as KitchenOrder & {
      sendOperationId: string;
      tableSessionId: string;
      sendSequence: number;
    };

    await createKitchenOutput(outputMode, this.kitchen).send(
      kitchenOrder
    );

    try {
      await this.updateTable(table.id, {
        status: table.status === "CUENTA_SOLICITADA"
          ? table.status
          : "WAITING_FOOD"
      });
    } catch (error) {
      if (!isOptimisticLockError(error)) throw error;
    }

    return kitchenOrder;
  }

  private async reconcileKitchenTableStatus(table: Table): Promise<void> {
    if (table.status === "FREE" || table.status === "CLOSED") return;

    try {
      await this.updateTable(table.id, {
        status: table.status === "CUENTA_SOLICITADA"
          ? table.status
          : "WAITING_FOOD"
      });
    } catch (error) {
      if (!isOptimisticLockError(error)) throw error;
    }
  }
}
