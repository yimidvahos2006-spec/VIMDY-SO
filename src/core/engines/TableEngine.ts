import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import type { Table, SaleItem, Product, Order, Sale, KitchenOrder, OrderPriority } from "../entities/Entities";
import { isOptimisticLockError } from "../errors/OptimisticLockError";
import { CartEngine, normalizeLineNote, type CartLineRef } from "./CartEngine";
import type { KitchenEngine } from "./KitchenEngine";
import type { SalesEngine } from "./SalesEngine";
import { OrderEngine } from "./OrderEngine";
import { companyConfigStore } from "../store/companyConfigStore";
import { getEffectiveKitchenOutputMode as resolveKitchenOutputMode } from "../services/effectiveKitchenOutputMode";
import { createKitchenOutput } from "../services/KitchenOutputFactory";
import { logWarning } from "../../infrastructure/logging/opsLogger";
import { assessMerge, mergeSaleItems, subtractSaleItems, canLinkAsExtra, isLinkedAccountActive, isOrphanLinkedTable } from "../utils/tableMerge";
import type { PaymentMethod, PaymentResult } from "./PaymentEngine";
import type { Receipt } from "./ReceiptEngine";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { userSessionStore } from "../store/userSessionStore";

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

/**
 * Clave de una línea para saber cuánto de ella ya salió a cocina: producto +
 * nota. Así "hamburguesa" y "hamburguesa sin cebolla" se cuentan por separado.
 */
function kitchenLineKey(productId: string, note?: string | null): string {
  return `${productId}\u0000${normalizeLineNote(note)}`;
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
    mutate: (cart: CartEngine) => void,
    precheck?: (table: Table) => void | Promise<void>
  ): Promise<Table> {
    for (let attempt = 1; attempt <= TableEngine.MAX_CONFLICT_RETRIES; attempt++) {
      const table = await this.getTable(tableId);
      if (!table) throw new Error("TABLE_NOT_FOUND");
      await precheck?.(table);

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
      zone: typeof input.zone === "string" && input.zone.trim() ? input.zone.trim() : undefined,
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

  /**
   * Una mesa solo se puede eliminar si está LIBRE y sin cuenta: nunca una con
   * comensales, productos o pedido en curso (se perdería la venta).
   */
  private assertDeletable(table: Table): void {
    const hasAccount = table.items.length > 0 || Boolean(table.orderId) || (table.peopleCount ?? 0) > 0;
    if (table.status !== "FREE" || hasAccount) {
      throw new Error(`TABLE_DELETE_NOT_FREE: "${table.name}" tiene una cuenta abierta`);
    }
  }

  /** Elimina una mesa libre. Si ya no existe, no hace nada (idempotente). */
  public async deleteTable(tableId: string): Promise<void> {
    const repository = this.getRepository();
    const table = await repository.findById(tableId);
    if (!table) return;
    this.assertDeletable(table);
    await repository.delete(tableId);
  }

  /**
   * Elimina una zona completa: solo si TODAS sus mesas están libres. Se valida
   * todo antes de borrar nada, así nunca queda una zona a medias.
   */
  public async deleteZone(zone: string): Promise<number> {
    const name = zone.trim().toLowerCase();
    if (!name) throw new Error("ZONE_REQUIRED");

    const repository = this.getRepository();
    const inZone = (await repository.findAll()).filter(
      (table) => (table.zone ?? "").trim().toLowerCase() === name
    );

    const occupied = inZone.filter((table) => {
      try {
        this.assertDeletable(table);
        return false;
      } catch {
        return true;
      }
    });
    if (occupied.length > 0) {
      throw new Error(
        `ZONE_HAS_OCCUPIED_TABLES: ${occupied.length} mesa(s) con cuenta abierta (${occupied.map((t) => t.name).join(", ")})`
      );
    }

    await repository.deleteMany(inZone.map((table) => table.id));
    return inZone.length;
  }

  public async getAllTables(): Promise<Table[]> {
    return this.getRepository().findAll();
  }

  public async getTable(id: string): Promise<Table | null> {
    return this.getRepository().findById(id);
  }

  /**
   * Como mutateItems(), pero la función de armado puede cambiar también otros
   * campos de la mesa (personas, descuento) en el mismo guardado. Reintenta
   * ante conflicto de versión releyendo la mesa fresca.
   */
  private async mutateTable(
    tableId: string,
    build: (table: Table) => { table: Table; items: SaleItem[] }
  ): Promise<Table> {
    for (let attempt = 1; attempt <= TableEngine.MAX_CONFLICT_RETRIES; attempt++) {
      const table = await this.getTable(tableId);
      if (!table) throw new Error("TABLE_NOT_FOUND");

      const next = build(table);

      try {
        return await this.persist(next.table, next.items);
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

  public async openTable(tableOrInput: string | OpenTableInput, input: OpenTableInput = {}): Promise<any> {
    const resolvedInput = typeof tableOrInput === "string" ? input : tableOrInput;
    const tableId =
      typeof tableOrInput === "string"
        ? tableOrInput
        : (resolvedInput.tableId ?? (tableOrInput as any).tableId);

    let table = tableId
      ? await this.getRepository().findById(tableId)
      : null;

    if (!table) throw new Error("TABLE_NOT_FOUND");

    // Una mesa anexada cuya principal ya no tiene cuenta quedó "huérfana": está libre de verdad.
    if (table.mergedInto && table.status === "CLOSED") {
      const primary = await this.getRepository().findById(table.mergedInto);
      if (isOrphanLinkedTable(table, primary)) {
        table = { ...table, status: "FREE", mergedInto: undefined, mergedAt: undefined };
      }
    }

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
      mergedInto: undefined,
      mergedAt: undefined,
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

  /**
   * Una venta de mesa que sigue pendiente de pago debe corresponder EXACTO a
   * lo que hay hoy en la mesa. Si alguien agregó o quitó productos después de
   * crear la venta (por ejemplo, un cobro con Wompi que el cliente abandonó),
   * reutilizar esa venta cobraría una cuenta vieja. Se bloquea en vez de
   * cobrar un monto incorrecto.
   */
  private assertPendingSaleMatchesTable(sale: Sale, table: Table): void {
    const status = String(sale.status ?? "");
    if (status !== "PENDING_PAYMENT" && status !== "OPEN") return;

    const totals = (items: ReadonlyArray<{ productId: string; quantity: number }>) => {
      const map = new Map<string, number>();
      for (const item of items) {
        map.set(item.productId, (map.get(item.productId) ?? 0) + Number(item.quantity));
      }
      return map;
    };

    const saleTotals = totals(sale.items);
    const tableTotals = totals(table.items);

    let same = saleTotals.size === tableTotals.size;
    if (same) {
      for (const [productId, quantity] of tableTotals) {
        if (Math.abs((saleTotals.get(productId) ?? -1) - quantity) > 0.0001) {
          same = false;
          break;
        }
      }
    }

    if (!same) {
      throw new Error(
        "TABLE_SALE_STALE: la cuenta de la mesa cambió después de iniciar un cobro que quedó pendiente."
      );
    }
  }

  /**
   * Devuelve la venta de esta mesa (la crea si todavía no existe). Es el
   * primer paso de cualquier cobro de mesa, en efectivo o digital, y es
   * idempotente: el mismo saleId siempre devuelve la misma venta.
   */
  private async resolveTableSale(
    table: Table,
    saleIdInput: string | undefined,
    cashierId: string | undefined
  ): Promise<Sale> {
    if (!this.sales) throw new Error("SALES_ENGINE_REQUIRED");

    const stableSaleId =
      saleIdInput?.trim() ||
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

    if (sale) {
      if (table.status !== "FREE") {
        this.assertPendingSaleMatchesTable(sale, table);
      }
      return sale;
    }

    if (table.items.length === 0) throw new Error("EMPTY_TABLE");

    return this.sales.tableSale({
      id: stableSaleId,
      tableId: table.id,
      source: table.items,
      cashierId,
      waiterId: table.waiterId,
      skipKitchen: true
    });
  }

  /**
   * Paso 1 del cobro digital (Wompi): deja la venta creada y pendiente de
   * pago, SIN cobrarla. El monto oficial es el de la venta (lo calcula el
   * servidor), no el que se ve en la tarjeta de la mesa.
   */
  public async prepareTableSaleForPayment(input: {
    tableId: string;
    saleId?: string;
    cashierId?: string;
  }): Promise<Sale> {
    const table = await this.getRepository().findById(input.tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");

    const sale = await this.resolveTableSale(table, input.saleId, input.cashierId);

    const status = String(sale.status ?? "");
    if (status === "CANCELLED" || status === "REFUNDED") {
      throw new Error(
        `SALE_CANNOT_BE_CANCELLED: la venta de esta mesa está en estado "${status}" y no se puede cobrar.`
      );
    }

    return sale;
  }

  /**
   * Cierra la mesa DESPUÉS de que el cobro ya quedó registrado: recibo,
   * mesa libre y pedido completado. Lo usan el cobro en efectivo y el cobro
   * digital confirmado por el proveedor.
   */
  private async finishPaidTable(
    tableId: string,
    paidSale: Sale,
    method: PaymentMethod,
    options: {
      customerName?: string;
      cashier?: string;
      received?: number;
    }
  ): Promise<Receipt> {
    if (!this.sales) throw new Error("SALES_ENGINE_REQUIRED");

    const existingReceipt =
      await this.sales.getReceiptBySaleId(paidSale.id);

    const receipt =
      existingReceipt ??
      (await this.sales.generateReceipt(
        paidSale,
        options.customerName ?? "Cliente General",
        options.cashier ?? "—",
        method,
        options.received ?? paidSale.total,
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
    const table = await this.getRepository().findById(tableId);

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

    // Las mesas anexadas a esta (por "Unir mesa") se liberan con la cuenta, aunque el
    // trigger de la base ya haya liberado la principal.
    await this.releaseLinkedTables(tableId);

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

    return receipt;
  }

  /**
   * Paso final del cobro digital: solo cierra la mesa si la venta YA figura
   * como pagada en la base de datos (la confirma el webhook del proveedor).
   * Nunca marca nada como cobrado por su cuenta.
   */
  public async confirmTableExternalPayment(input: {
    tableId: string;
    saleId: string;
    method: PaymentMethod;
    cashier?: string;
    customerName?: string;
  }): Promise<{ sale: Sale; receipt: Receipt }> {
    if (!this.sales) throw new Error("SALES_ENGINE_REQUIRED");

    const sale = await this.sales.getSale(input.saleId);
    if (!sale) throw new Error("SALE_NOT_FOUND");

    const status = String(sale.status ?? "");
    if (status !== "PAID" && status !== "CLOSED") {
      throw new Error(
        "TABLE_PAYMENT_PENDING_VERIFICATION: el pago todavía no está confirmado."
      );
    }

    const receipt = await this.finishPaidTable(input.tableId, sale, input.method, {
      customerName: input.customerName,
      cashier: input.cashier,
      received: sale.total
    });

    return { sale, receipt };
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

    const table = tableId
      ? await this.getRepository().findById(tableId)
      : null;

    if (!table) throw new Error("TABLE_NOT_FOUND");

    const sale = await this.resolveTableSale(
      table,
      resolvedInput.saleId,
      resolvedInput.cashierId
    );

    const { sale: paidSale, payment } =
      await this.sales.registerPayment(
        sale,
        method,
        {
          received: resolvedInput.received,
          reference: resolvedInput.reference,
          cashierName: resolvedInput.cashier
        }
      );

    if (!payment.success) {
      throw new Error("TABLE_PAYMENT_PENDING_VERIFICATION: el pago no quedó confirmado por el proveedor.");
    }

    const receipt = await this.finishPaidTable(table.id, paidSale, method, {
      customerName: resolvedInput.customerName,
      cashier: resolvedInput.cashier,
      received: resolvedInput.received
    });

    return {
      sale: paidSale,
      payment,
      receipt
    };
  }

  /**
   * Solo se puede agregar o subir productos en una mesa con cuenta abierta.
   * Si otro dispositivo ya la cobró y la liberó mientras este panel seguía
   * abierto, un producto agregado aquí quedaría guardado en una mesa libre y
   * le aparecería al siguiente cliente que la ocupe.
   */
  private assertTableAcceptsItems(table: Table): void {
    if (table.status === "FREE" || table.status === "CLOSED" || table.status === "RESERVED") {
      throw new Error("TABLE_NOT_OPEN: la mesa ya no tiene una cuenta abierta (puede que otra persona la haya cobrado)");
    }
  }

  public async addItem(tableOrInput: string | AddProductInput, maybeInput?: AddProductInput): Promise<any> {
    const resolvedInput = typeof tableOrInput === 'string' ? (maybeInput ?? {}) : tableOrInput;
    const tableId = typeof tableOrInput === 'string' ? tableOrInput : (resolvedInput.tableId ?? (tableOrInput as any).tableId);
    const table = tableId ? await this.getRepository().findById(tableId) : null;
    if (!table) throw new Error('TABLE_NOT_FOUND');
    this.assertTableAcceptsItems(table);

    const product = resolvedInput.product ?? { id: resolvedInput.productId, price: 0, requiresKitchen: true };
    const item = {
      productId: resolvedInput.productId ?? product.id,
      quantity: resolvedInput.quantity ?? 1,
      price: product.price ?? 0,
      note: resolvedInput.note,
      requiresKitchen: product.requiresKitchen ?? true,
    };

    // En mesas, el mismo producto con OTRA nota va en una línea aparte: así
    // "sin cebolla" llega solo a ese plato y cocina recibe cada variante.
    return this.mutateItems(table.id, (cart) => cart.addItem({
      id: item.productId,
      name: product.name ?? "Producto",
      price: item.price,
      requiresKitchen: item.requiresKitchen
    } as Product, item.quantity, item.note, { splitByNote: true }));
  }

  /** Sin `line` quita todas las líneas del producto; con `line` solo la de esa nota. */
  public async removeItem(tableId: string, productId: string, line?: CartLineRef): Promise<any> {
    return this.mutateItems(tableId, (cart) => cart.removeItem(productId, line));
  }

  public async updateItemQuantity(tableId: string, productId: string, quantity: number, line?: CartLineRef): Promise<any> {
    return this.mutateItems(tableId, (cart) => cart.updateQuantity(productId, quantity, line), (table) => this.assertTableAcceptsItems(table));
  }

  /**
   * Cambia la nota de un producto de la cuenta (o solo de `units` unidades).
   *
   * Protección: si esas unidades YA se enviaron a cocina, la nota no se puede
   * cambiar, porque cocina no se enteraría y prepararía el plato sin ella.
   * Para pedir algo distinto hay que agregar el producto de nuevo con la nota
   * (queda como línea nueva y sale en una comanda nueva).
   */
  public async updateItemNote(
    tableId: string,
    productId: string,
    fromNote: string | null | undefined,
    toNote: string | null | undefined,
    units?: number
  ): Promise<any> {
    return this.mutateItems(
      tableId,
      (cart) => cart.setLineNote(productId, fromNote, toNote, units),
      async (table) => {
        this.assertTableAcceptsItems(table);
        if (normalizeLineNote(fromNote) === normalizeLineNote(toNote)) return;
        const line = table.items.find(
          (candidate) =>
            candidate.productId === productId &&
            normalizeLineNote(candidate.note) === normalizeLineNote(fromNote)
        );
        if (!line || line.requiresKitchen !== true) return;

        const sent = (await this.getKitchenSentQuantities(table)).get(
          kitchenLineKey(line.productId, line.note)
        ) ?? 0;
        // Solo molesta si la nota tocaría unidades ya enviadas.
        const touched = units !== undefined && units >= 1 && units < line.quantity ? units : line.quantity;
        const untouchedUnsent = line.quantity - sent;
        if (sent > 0 && touched > untouchedUnsent) {
          throw new Error(
            "TABLE_NOTE_ALREADY_SENT: esas unidades ya salieron a cocina; agrega el producto de nuevo con la nota"
          );
        }
      }
    );
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

  /**
   * Suma `count` personas a la mesa (NO es el total nuevo): con 4 personas y
   * `addPeople(id, 1)` quedan 5. Antes el panel enviaba "personas + 1" y el
   * motor volvía a sumar, dejando 9.
   */
  public async addPeople(tableId: string, count: number): Promise<any> {
    const amount = Math.trunc(Number(count));
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error("TABLE_PEOPLE_INVALID: indica cuántas personas se suman (1 o más)");
    }

    return this.mutateTable(tableId, (current) => {
      if (current.status === "FREE" || current.status === "CLOSED") {
        throw new Error("TABLE_NOT_OPEN: abre la mesa antes de agregar personas");
      }
      return {
        table: { ...current, peopleCount: (current.peopleCount ?? 0) + amount },
        items: current.items
      };
    });
  }

  public async requestBill(tableId: string): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");
    this.assertTableAcceptsItems(table);
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

    const released = await this.updateTable(tableId, {
      status: "FREE",
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      openedAt: undefined,
      orderId: undefined,
      openOperationId: undefined
    });
    await this.releaseLinkedTables(tableId);
    return released;
  }

  /**
   * Cancela la cuenta de una mesa: cocina deja de preparar lo pendiente, el
   * pedido queda CANCELADO y la mesa vuelve a quedar LIBRE y reutilizable.
   *
   * Protección: si ya se ENTREGÓ comida de esta cuenta no se puede cancelar
   * (habría consumo sin cobrar); hay que cobrarla o resolverla con un gerente.
   */
  public async cancelTableOrder(tableId: string, reason?: string): Promise<any> {
    const table = await this.getRepository().findById(tableId);
    if (!table) throw new Error("TABLE_NOT_FOUND");
    if (table.status === "FREE" || table.status === "CLOSED") {
      throw new Error("TABLE_NOT_OPEN: la mesa no tiene una cuenta abierta");
    }

    const cleanReason = reason?.trim() || "Pedido de mesa cancelado";
    const scope = { orderId: table.orderId, openedAt: table.openedAt };

    if (this.kitchen && (await this.kitchen.hasDeliveredOrders(table.id, scope))) {
      throw new Error(
        "TABLE_CANCEL_HAS_DELIVERED: ya se entregó comida de esta cuenta. Cóbrala o pide ayuda a un gerente"
      );
    }

    // 1) Cocina deja de preparar lo que estaba pendiente.
    if (this.kitchen) {
      const actorId = userSessionStore.get().id || "system";
      await this.kitchen.cancelOpenOrdersForTable(table.id, cleanReason, actorId, scope);
    }

    // 2) El pedido queda cancelado.
    if (table.orderId && this.orders) {
      const order = await this.orders.getOrder(table.orderId);
      if (order.status !== "COMPLETED" && order.status !== "CANCELLED") {
        await this.orders.updateOrder(order.id, { status: "CANCELLED", cancelReason: cleanReason });
      }
    }

    // 3) La mesa se libera (antes quedaba ocupada y vacía) junto con sus mesas anexadas.
    const freed = await this.updateTable(tableId, {
      status: "FREE",
      items: [],
      subtotal: 0,
      tax: 0,
      discount: 0,
      total: 0,
      peopleCount: 0,
      waiterId: undefined,
      customerId: undefined,
      openedAt: undefined,
      orderId: undefined,
      openOperationId: undefined,
      notes: undefined
    });
    await this.releaseLinkedTables(tableId);
    return freed;
  }

  /**
   * Une la cuenta de `fromId` dentro de la cuenta de `toId` (ambas mesas deben
   * estar abiertas). Al terminar, `fromId` queda LIBRE y reutilizable y todo su
   * consumo vive en `toId`.
   *
   * Orden de operaciones (nunca se pierde ni se duplica un producto):
   *   1) se suman las líneas COMPLETAS, las personas y el descuento al destino;
   *   2) se libera el origen usando la versión que se leyó al inicio: si
   *      alguien tocó el origen mientras tanto, falla y se DESHACE el paso 1;
   *   3) se cancela el pedido del origen (ya no tiene mesa que lo respalde).
   */
  public async mergeTables(fromId: string, toId: string): Promise<Table> {
    const repository = this.getRepository();
    const source = await repository.findById(fromId);
    const target = await repository.findById(toId);
    if (!source || !target) throw new Error("TABLE_NOT_FOUND");

    const assessment = assessMerge(source, target);
    if (!assessment.ok) {
      throw new Error(`${assessment.code}: no se puede unir "${source.name}" con "${target.name}"`);
    }

    // 0) Las comandas ya enviadas pasan a la mesa destino: así sabe qué salió
    //    ya a cocina y no lo vuelve a mandar. Si algo falla después, se deshace.
    const kitchenMove = this.kitchen
      ? await this.kitchen.moveTableOrders({
          from: source,
          to: {
            id: target.id,
            name: target.name,
            orderId: target.orderId,
            openOperationId: target.openOperationId
          }
        })
      : null;

    const moved = source.items.map((item) => ({ ...item }));
    const movedPeople = source.peopleCount ?? 0;
    const movedDiscount = source.discount ?? 0;
    const roundMoney = (value: number) => Number(value.toFixed(2));

    // 1) Sumar al destino.
    let merged: Table;
    try {
      merged = await this.mutateTable(toId, (current) => {
        if (assessMerge(source, current).code === "TABLE_MERGE_TARGET_NOT_OPEN") {
          throw new Error(`TABLE_MERGE_TARGET_NOT_OPEN: "${current.name}" ya no tiene una cuenta abierta`);
        }
        return {
          table: {
            ...current,
            peopleCount: (current.peopleCount ?? 0) + movedPeople,
            discount: roundMoney((current.discount ?? 0) + movedDiscount)
          },
          items: mergeSaleItems(current.items, moved)
        };
      });
    } catch (error) {
      await kitchenMove?.undo();
      throw error;
    }

    // 2) Liberar el origen con la versión leída al inicio.
    try {
      await repository.update({
        ...source,
        status: "FREE",
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        peopleCount: 0,
        waiterId: undefined,
        customerId: undefined,
        openedAt: undefined,
        orderId: undefined,
        openOperationId: undefined,
        notes: undefined,
        updatedAt: new Date()
      });
    } catch (error) {
      try {
        await this.mutateTable(toId, (current) => ({
          table: {
            ...current,
            peopleCount: Math.max((current.peopleCount ?? 0) - movedPeople, 0),
            discount: Math.max(roundMoney((current.discount ?? 0) - movedDiscount), 0)
          },
          items: subtractSaleItems(current.items, moved)
        }));
        await kitchenMove?.undo();
      } catch (rollbackError) {
        logWarning("[TableEngine] La unión de mesas falló y no se pudo deshacer", {
          category: "sales",
          context: { fromId, toId, error: String(error), rollbackError: String(rollbackError) }
        });
        throw new Error(
          `TABLE_MERGE_INCONSISTENT: revisa las mesas "${source.name}" y "${target.name}" antes de seguir`
        );
      }
      throw error;
    }

    // 2b) Las mesas anexadas al origen pasan a depender del destino.
    await this.repointLinkedTables(fromId, toId);

    // 3) El pedido del origen ya no tiene mesa: se cancela (igual que al liberar una mesa).
    if (source.orderId && this.orders) {
      try {
        const order = await this.orders.getOrder(source.orderId);
        if (order.status !== "COMPLETED" && order.status !== "CANCELLED") {
          await this.orders.updateOrder(order.id, {
            status: "CANCELLED",
            cancelReason: `Mesa unida a ${target.name}`
          });
        }
      } catch (orderError) {
        // La unión ya quedó correcta para el cliente: no se muestra como fallo.
        logWarning("[TableEngine] No se pudo cancelar el pedido de la mesa unida", {
          category: "sales",
          context: { fromId, toId, orderId: source.orderId, error: String(orderError) }
        });
      }
    }

    return merged;
  }

  /**
   * Pasa la cuenta completa de `tableId` a una mesa LIBRE (`targetId`).
   *
   * Orden pensado para que nunca existan dos mesas abiertas con la misma
   * sesión (la base de datos lo prohíbe) ni se pierda la cuenta:
   *   0) las comandas de cocina y el pedido siguen a la mesa nueva;
   *   1) se libera el origen;
   *   2) se ocupa el destino con TODA la cuenta.
   * Si un paso falla, los anteriores se deshacen.
   */
  public async transferTable(tableId: string, targetId: string): Promise<any> {
    const repository = this.getRepository();
    const source = await repository.findById(tableId);
    const target = await repository.findById(targetId);
    if (!source || !target) throw new Error("TABLE_NOT_FOUND");
    if (source.id === target.id) {
      throw new Error("TABLE_TRANSFER_SAME: elige una mesa distinta a la actual");
    }
    if (source.status === "FREE" || source.status === "CLOSED") {
      throw new Error("TABLE_NOT_OPEN: la mesa no tiene una cuenta abierta para transferir");
    }
    if (target.status !== "FREE") throw new Error("TABLE_NOT_AVAILABLE");

    const undo: Array<() => Promise<void>> = [];
    const rollback = async () => {
      for (const step of undo.reverse()) {
        try { await step(); } catch { /* mejor esfuerzo */ }
      }
    };

    try {
      // 0a) Cocina: las comandas ya enviadas pasan a la mesa nueva.
      if (this.kitchen) {
        const move = await this.kitchen.moveTableOrders({
          from: source,
          to: {
            id: target.id,
            name: target.name,
            orderId: source.orderId,
            openOperationId: source.openOperationId
          }
        });
        undo.push(move.undo);
      }

      // 0b) El pedido apunta a la mesa nueva.
      if (source.orderId && this.orders) {
        const order = await this.orders.getOrder(source.orderId);
        if (order.status !== "COMPLETED" && order.status !== "CANCELLED") {
          await this.orders.updateOrder(order.id, { tableId: target.id });
          undo.push(async () => {
            await this.orders!.updateOrder(order.id, { tableId: source.id });
          });
        }
      }

      // 1) Liberar el origen (así nunca hay dos mesas con la misma sesión).
      await this.updateTable(source.id, {
        status: "FREE",
        waiterId: undefined,
        customerId: undefined,
        peopleCount: 0,
        items: [],
        subtotal: 0,
        tax: 0,
        discount: 0,
        total: 0,
        notes: undefined,
        openedAt: undefined,
        orderId: undefined,
        openOperationId: undefined
      });
      undo.push(async () => {
        await this.updateTable(source.id, {
          status: source.status,
          waiterId: source.waiterId,
          customerId: source.customerId,
          peopleCount: source.peopleCount,
          items: source.items,
          subtotal: source.subtotal,
          tax: source.tax,
          discount: source.discount,
          total: source.total,
          notes: source.notes,
          openedAt: source.openedAt,
          orderId: source.orderId,
          openOperationId: source.openOperationId
        });
      });

      // 2) Ocupar el destino con toda la cuenta.
      await this.updateTable(target.id, {
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
    } catch (error) {
      await rollback();
      throw error;
    }

    // Las mesas anexadas siguen a la cuenta a su nueva mesa.
    await this.repointLinkedTables(source.id, target.id);

    return repository.findById(target.id);
  }

  /* ----------------------- Mesas anexadas ("Unir mesa") ----------------------- */

  /**
   * Anexa mesas LIBRES a una mesa principal con cuenta abierta (cuando llegan más
   * personas de las que caben). Las anexas quedan "Unidas" (CLOSED + mergedInto),
   * sin cuenta propia. Es de mejor esfuerzo: devuelve cuáles quedaron unidas y
   * cuáles no (otra persona las ocupó, falló la red…), sin tumbar la apertura.
   */
  public async linkExtraTables(primaryId: string, extraIds: readonly string[]): Promise<{ linked: string[]; skipped: string[] }> {
    const repository = this.getRepository();
    const primary = await repository.findById(primaryId);
    if (!primary || !isLinkedAccountActive(primary)) {
      throw new Error("TABLE_NOT_OPEN: abre la mesa principal antes de unirle otra");
    }

    const linked: string[] = [];
    const skipped: string[] = [];

    for (const id of Array.from(new Set(extraIds))) {
      try {
        let extra = await repository.findById(id);
        // Una anexa huérfana (su principal ya no tiene cuenta) está libre de verdad.
        if (extra?.mergedInto && extra.status === "CLOSED") {
          const owner = await repository.findById(extra.mergedInto);
          if (isOrphanLinkedTable(extra, owner)) {
            extra = { ...extra, status: "FREE", mergedInto: undefined, mergedAt: undefined };
          }
        }
        if (!extra || !canLinkAsExtra(extra, primary)) {
          skipped.push(id);
          continue;
        }
        await repository.update({
          ...extra,
          status: "CLOSED",
          mergedInto: primary.id,
          mergedAt: new Date(),
          peopleCount: 0,
          updatedAt: new Date()
        });
        linked.push(id);
      } catch (error) {
        skipped.push(id);
        logWarning("[TableEngine] No se pudo anexar la mesa", {
          category: "sales",
          context: { primaryId, extraId: id, error: String(error) }
        });
      }
    }

    return { linked, skipped };
  }

  /** Libera las mesas anexadas a `primaryId` (al cobrar, cancelar o liberar la principal). Nunca lanza. */
  public async releaseLinkedTables(primaryId: string): Promise<void> {
    await this.rewriteLinkedTables(primaryId, (table) => ({
      ...table,
      status: "FREE",
      mergedInto: undefined,
      mergedAt: undefined,
      peopleCount: 0,
      updatedAt: new Date()
    }));
  }

  /** Las anexas de `fromId` pasan a depender de `toId` (la cuenta se unió o se transfirió). Nunca lanza. */
  public async repointLinkedTables(fromId: string, toId: string): Promise<void> {
    await this.rewriteLinkedTables(fromId, (table) => ({
      ...table,
      mergedInto: toId,
      updatedAt: new Date()
    }));
  }

  private async rewriteLinkedTables(primaryId: string, build: (table: Table) => Table): Promise<void> {
    try {
      const repository = this.getRepository();
      const candidates = (await repository.findAll()).filter(
        (table) => table.mergedInto === primaryId && table.status === "CLOSED"
      );

      for (const candidate of candidates) {
        try {
          const fresh = (await repository.findById(candidate.id)) ?? candidate;
          if (fresh.mergedInto !== primaryId || fresh.status !== "CLOSED") continue;
          await repository.update(build(fresh));
        } catch (error) {
          logWarning("[TableEngine] No se pudo actualizar una mesa anexada", {
            category: "sales",
            context: { primaryId, tableId: candidate.id, error: String(error) }
          });
        }
      }
    } catch (error) {
      logWarning("[TableEngine] No se pudieron revisar las mesas anexadas", {
        category: "sales",
        context: { primaryId, error: String(error) }
      });
    }
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
    if (table.status !== 'FREE') throw new Error('TABLE_NOT_AVAILABLE');

    return this.updateTable(tableId, {
      status: 'RESERVED',
      customerId: input.customerId ?? table.customerId,
      notes: input.notes ?? table.notes,
    });
  }

  /**
   * Duración típica de una mesa en este negocio (ms), con las cuentas cerradas
   * de los últimos 30 días. Con menos de 5 cuentas no hay historial suficiente
   * y se usa 45 min. Se descartan duraciones absurdas (<5 min o >6 h) y se usa
   * la mediana para que una mesa olvidada abierta no distorsione el promedio.
   */
  public async getAverageDuration(_businessId?: string): Promise<number> {
    const FALLBACK = 45 * 60 * 1000;
    if (!this.orders) return FALLBACK;
    try {
      const durations = (await this.orders.getCompletedTableDurations())
        .filter(ms => ms >= 5 * 60 * 1000 && ms <= 6 * 60 * 60 * 1000)
        .sort((a, b) => a - b);
      if (durations.length < 5) return FALLBACK;
      const mid = Math.floor(durations.length / 2);
      return durations.length % 2 ? durations[mid] : Math.round((durations[mid - 1] + durations[mid]) / 2);
    } catch {
      return FALLBACK;
    }
  }

  /**
   * Comandas de la cuenta ACTIVA de la mesa. Solo la sesión/orden activa
   * cuenta: así no se suman comandas de una visita anterior a la misma mesa.
   * Los registros legacy sin session id se aceptan solo si se crearon después
   * de openedAt y pertenecen al orderId activo.
   */
  private async getKitchenSessionOrders(table: Table): Promise<KitchenOrder[]> {
    if (!this.kitchen) return [];

    const activeOrderId = table.orderId;
    const sessionIdentity = table.openOperationId ?? activeOrderId ?? table.id;
    const previousOrders = await this.kitchen.getByTableId(table.id);

    return previousOrders.filter((previous) => {
      const extended = previous as KitchenOrder & { tableSessionId?: string };

      if (activeOrderId && previous.orderId) {
        return previous.orderId === activeOrderId;
      }

      if (extended.tableSessionId) {
        return extended.tableSessionId === sessionIdentity;
      }

      if (table.openedAt) {
        return new Date(previous.createdAt).getTime() >= new Date(table.openedAt).getTime();
      }

      return false;
    });
  }

  /** Unidades ya enviadas a cocina por línea (producto + nota); ignora comandas canceladas. */
  private sumSentQuantities(sessionOrders: readonly KitchenOrder[]): Map<string, number> {
    const sent = new Map<string, number>();
    for (const previous of sessionOrders) {
      if (previous.status === "CANCELADO") continue;
      for (const item of previous.items) {
        const key = kitchenLineKey(item.productId, item.note);
        sent.set(key, (sent.get(key) ?? 0) + item.quantity);
      }
    }
    return sent;
  }

  private async getKitchenSentQuantities(table: Table): Promise<Map<string, number>> {
    return this.sumSentQuantities(await this.getKitchenSessionOrders(table));
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

    const sessionOrders = await this.getKitchenSessionOrders(table);
    const sentQuantities = this.sumSentQuantities(sessionOrders);

    const kitchenItems = table.items
      .filter((item) => item.requiresKitchen === true)
      .map((item) => {
        const sent = sentQuantities.get(kitchenLineKey(item.productId, item.note)) ?? 0;
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

  /**
   * Cocina entregó una comanda: si TODO lo enviado de esta cuenta ya se
   * entregó, la mesa pasa de "Esperando comida" a "Comiendo". Antes la mesa
   * se quedaba en "Esperando comida" hasta el cobro y el tablero seguía
   * pidiendo "Verificar con cocina" con la comida ya servida.
   *
   * No toca mesas que ya pidieron la cuenta ni mesas sin cuenta abierta.
   */
  public async markFoodServed(tableId: string): Promise<void> {
    if (!this.kitchen) return;

    const table = await this.getRepository().findById(tableId);
    if (!table || table.status !== "WAITING_FOOD") return;

    const activeOrderId = table.orderId;
    const sessionIdentity = table.openOperationId ?? activeOrderId ?? table.id;

    const sessionOrders = (await this.kitchen.getByTableId(table.id)).filter((order) => {
      const extended = order as KitchenOrder & { tableSessionId?: string };
      if (activeOrderId && order.orderId) return order.orderId === activeOrderId;
      if (extended.tableSessionId) return extended.tableSessionId === sessionIdentity;
      if (table.openedAt) {
        return new Date(order.createdAt).getTime() >= new Date(table.openedAt).getTime();
      }
      return false;
    });

    const live = sessionOrders.filter((order) => order.status !== "CANCELADO");
    if (live.length === 0 || live.some((order) => order.status !== "ENTREGADO")) return;

    try {
      await this.updateTable(table.id, { status: "EATING" });
    } catch (error) {
      if (!isOptimisticLockError(error)) throw error;
    }
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