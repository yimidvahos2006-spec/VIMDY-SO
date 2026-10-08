import {
  Order,
  OrderSource,
  OrderStatus,
  SaleItem,
  Product,
  Sale
} from "../entities/Entities";
import type { KitchenOrder } from "../entities/Entities";

import { IRepository } from "../../infrastructure/di/repositories/IRepository";

import { KitchenEngine } from "./KitchenEngine";
import { SalesEngine, DiscountInput } from "./SalesEngine";
import { PaymentMethod, PaymentResult } from "./PaymentEngine";
import { Receipt } from "./ReceiptEngine";

import { vimdyCore } from "../VimdyCore";
import { getEffectiveKitchenOutputMode } from "../services/effectiveKitchenOutputMode";
import { createKitchenOutput } from "../services/KitchenOutputFactory";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";

/* ===========================================================================
   OrderEngine
   ---------------------------------------------------------------------------
   Motor de seguimiento operativo del pedido. No es el carrito (eso lo maneja
   CartEngine/TableEngine) ni la venta (eso lo maneja SalesEngine): es el
   registro de "qué pidió el cliente y en qué punto va" — tomado, confirmado,
   enviado a cocina, en preparación, listo, entregado, cobrado.

   Sirve por igual para pedidos de mesa, mostrador, domicilio o para llevar
   (OrderSource), lo que evita duplicar esta lógica en cada motor de origen.

   Conexiones directas (obligatorias):
     - IRepository<Order> → persistencia de los pedidos.
     - KitchenEngine       → envío a cocina y lectura de su estado real.
     - SalesEngine         → cobro del pedido al finalizar (checkout).
     - vimdyCore           → emisión de eventos ("order").

   Conexiones PROHIBIDAS (por diseño):
     - InventoryEngine, PaymentEngine, ReceiptEngine, CashEngine
       Solo se tocan a través de SalesEngine, nunca directamente.
=========================================================================== */

export interface CreateOrderInput {
  readonly source: OrderSource;
  readonly tableId?: string;
  readonly waiterId?: string;
  readonly customerId?: string;
  readonly notes?: string;
  /** Identidad durable de una operación de apertura de mesa. */
  readonly operationId?: string;
  /** Identidad explícita para retries; si existe no se genera otro UUID. */
  readonly id?: string;
  /** Personas de la sesión de mesa al momento de abrirla. */
  readonly peopleCount?: number;
}

async function deterministicUuid(seed: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(seed)
  );
  const bytes = new Uint8Array(digest).slice(0, 16);

  // UUID v8 determinista (RFC 9562): la identidad viene del seed y no
  // cambia cuando la misma operación se reintenta después de una caída.
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
  orderId: string,
  items: SaleItem[],
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

  return JSON.stringify({ orderId, items: normalized });
}

export interface AddOrderItemInput {
  readonly orderId: string;
  readonly product: Product;
  readonly quantity?: number;
}

export interface CheckoutOrderInput {
  readonly orderId: string;
  readonly method: PaymentMethod;
  readonly customerName?: string;
  readonly cashier?: string;
  readonly cashierId?: string;
  readonly received?: number;
  readonly reference?: string;
  readonly discount?: DiscountInput;
  readonly deliveryAddress?: string;
  readonly deliveryFee?: number;
}

/** Estados en los que el pedido todavía admite ediciones. */
const EDITABLE_STATUSES: OrderStatus[] = ["DRAFT", "CONFIRMED"];

/** Mapa de estado de cocina → estado de pedido. */
const KITCHEN_STATUS_MAP: Record<string, OrderStatus> = {
  PENDIENTE: "SENT_TO_KITCHEN",
  EN_PREPARACION: "IN_PREPARATION",
  LISTO: "READY",
  ENTREGADO: "DELIVERED"
};

export class OrderEngine {
  constructor(
    private readonly orderRepository: IRepository<Order>,
    private readonly kitchen: KitchenEngine,
    private readonly sales: SalesEngine
  ) {}

  /* =======================================================================
     CREACIÓN Y CONSULTA
  ======================================================================= */

  public async createOrder(input: CreateOrderInput): Promise<Order> {
    const businessId = getCurrentBusinessId() ?? undefined;
    const branchId = getCurrentBranchId() ?? undefined;
    const operationId = input.operationId?.trim() || undefined;
    const stableId = input.id?.trim() || (
      operationId
        ? await deterministicUuid(`vimdy:table-order:${operationId}`)
        : undefined
    );

    if (stableId) {
      const existing = await this.orderRepository.findById(stableId);

      if (existing) {
        if (
          businessId &&
          existing.businessId &&
          existing.businessId !== businessId
        ) {
          throw new Error("ORDER_NOT_FOUND");
        }

        if (
          branchId &&
          existing.branchId &&
          existing.branchId !== branchId
        ) {
          throw new Error("ORDER_NOT_FOUND");
        }

        if (
          input.tableId &&
          existing.tableId &&
          existing.tableId !== input.tableId
        ) {
          throw new Error("ORDER_OPERATION_REUSED");
        }

        return existing;
      }
    }

    const now = new Date();
    const orderNumber = await this.nextOrderNumber();

    const order = {
      id: stableId ?? crypto.randomUUID(),
      code: this.generateOrderCode(input.source),
      orderNumber,
      source: input.source,
      tableId: input.tableId,
      waiterId: input.waiterId,
      customerId: input.customerId,
      items: [],
      notes: input.notes,
      status: "DRAFT" as const,
      createdAt: now,
      updatedAt: now,
      businessId,
      branchId,
      ...(operationId ? { openOperationId: operationId } : {}),
      ...(input.peopleCount !== undefined
        ? { peopleCount: Math.max(0, Math.floor(input.peopleCount)) }
        : {})
    } as Order & {
      readonly openOperationId?: string;
      readonly peopleCount?: number;
    };

    try {
      await this.orderRepository.save(order);
    } catch (error) {
      if (operationId) {
        const existingByOperation = (
          await this.getOrdersByTable(input.tableId ?? "")
        ).find((candidate) =>
          (candidate as Order & { openOperationId?: string })
            .openOperationId === operationId
        );

        if (existingByOperation) {
          return existingByOperation;
        }
      }
      throw error;
    }

    this.emit(order, "order.created");

    return order;
  }

  public async getOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);

    if (!order) {
      throw new Error("ORDER_NOT_FOUND");
    }

    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();
    if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) {
      throw new Error("ORDER_NOT_FOUND");
    }
    if (currentBranchId && order.branchId && order.branchId !== currentBranchId) {
      throw new Error("ORDER_NOT_FOUND");
    }

    return order;
  }

  public async getAllOrders(): Promise<Order[]> {
    const orders = await this.orderRepository.findAll();
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return orders.filter(order => {
      if (currentBusinessId && order.businessId && order.businessId !== currentBusinessId) return false;
      if (currentBranchId && order.branchId && order.branchId !== currentBranchId) return false;
      return true;
    });
  }

  public async getActiveOrders(): Promise<Order[]> {
    const orders = await this.getAllOrders();

    return orders.filter(
      order => order.status !== "COMPLETED" && order.status !== "CANCELLED"
    );
  }

  public async getOrdersByTable(tableId: string): Promise<Order[]> {
    const orders = await this.getAllOrders();
    return orders.filter(order => order.tableId === tableId);
  }

  public async getOrdersByStatus(status: OrderStatus): Promise<Order[]> {
    const orders = await this.getAllOrders();
    return orders.filter(order => order.status === status);
  }

  public async getOrdersByWaiter(waiterId: string): Promise<Order[]> {
    const orders = await this.getAllOrders();
    return orders.filter(order => order.waiterId === waiterId);
  }

  /* =======================================================================
     EDICIÓN DEL PEDIDO
  ======================================================================= */

  public async addItem(input: AddOrderItemInput): Promise<Order> {
    const order = await this.requireEditable(input.orderId);

    const items = this.mergeItem(
      order.items,
      {
        productId: input.product.id,
        quantity: input.quantity ?? 1,
        price: input.product.price,
        // Se captura aquí, no se recalcula después: sendToKitchen() filtra
        // sobre este valor sin volver a consultar InventoryEngine (tiene
        // prohibido tocarlo directamente — ver cabecera de este archivo).
        // FASE 1: un ingrediente nunca debe entrar a cocina, sin importar
        // lo que diga el flag del producto en ese momento.
        requiresKitchen: !input.product.isIngredient && (input.product.requiresKitchen ?? false)
      }
    );

    return this.updateOrder(order.id, { items });
  }

  public async removeItem(orderId: string, productId: string): Promise<Order> {
    const order = await this.requireEditable(orderId);

    const items = order.items.filter(item => item.productId !== productId);

    return this.updateOrder(orderId, { items });
  }

  public async updateItemQuantity(
    orderId: string,
    productId: string,
    quantity: number
  ): Promise<Order> {
    const order = await this.requireEditable(orderId);

    if (quantity <= 0) {
      return this.removeItem(orderId, productId);
    }

    const items = order.items.map(item =>
      item.productId === productId ? { ...item, quantity } : item
    );

    return this.updateOrder(orderId, { items });
  }

  public async setNotes(orderId: string, notes: string): Promise<Order> {
    await this.requireEditable(orderId);
    return this.updateOrder(orderId, { notes });
  }

  public getTotal(order: Order): number {
    return Number(
      order.items
        .reduce((sum, item) => sum + item.price * item.quantity, 0)
        .toFixed(2)
    );
  }

  /* =======================================================================
     CONFIRMACIÓN Y ENVÍO A COCINA
  ======================================================================= */

  public async confirmOrder(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (order.status !== "DRAFT") {
      throw new Error(
        `ORDER_CANNOT_BE_CONFIRMED: el pedido está en estado "${order.status}".`
      );
    }

    if (order.items.length === 0) {
      throw new Error("EMPTY_ORDER: el pedido no tiene productos.");
    }

    const confirmed = await this.updateOrder(orderId, { status: "CONFIRMED" });

    this.emit(confirmed, "order.confirmed");

    return confirmed;
  }

  /**
   * Envía el pedido a cocina de forma idempotente. La identidad de la
   * comanda se deriva del pedido + contenido exacto enviado; por eso un
   * retry después de una caída de red reutiliza el mismo registro en vez
   * de generar otra comanda.
   */
  public async sendToKitchen(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);
    const kitchenOutputMode = getEffectiveKitchenOutputMode();
    if (kitchenOutputMode === "none") {
      throw new Error("KITCHEN_OUTPUT_NOT_CONFIGURED: configura una pantalla KDS o impresora para enviar pedidos a cocina.");
    }

    if (order.items.length === 0) {
      throw new Error("EMPTY_ORDER: no hay productos para enviar a cocina.");
    }

    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new Error(
        `ORDER_LOCKED: no se puede enviar a cocina un pedido "${order.status}".`
      );
    }

    const previousOrders = await this.kitchen.getByOrderId(order.id);
    const sentQuantities = new Map<string, number>();

    for (const previous of previousOrders) {
      if (previous.status === "CANCELADO") continue;
      for (const item of previous.items) {
        sentQuantities.set(
          item.productId,
          (sentQuantities.get(item.productId) ?? 0) + item.quantity
        );
      }
    }

    const kitchenItems = order.items
      .filter((item) => item.requiresKitchen === true)
      .map((item) => {
        const sent = sentQuantities.get(item.productId) ?? 0;
        if (item.quantity <= sent) return null;
        return { ...item, quantity: item.quantity - sent };
      })
      .filter(
        (item): item is NonNullable<typeof item> => item !== null
      );

    if (kitchenItems.length === 0) {
      const existing = [...previousOrders]
        .reverse()
        .find((candidate) => candidate.status !== "CANCELADO");

      if (existing) {
        if (order.kitchenOrderId !== existing.id || order.status === "CONFIRMED") {
          const recovered = await this.updateOrder(order.id, {
            status: existing.status === "PENDIENTE"
              ? "SENT_TO_KITCHEN"
              : (KITCHEN_STATUS_MAP[existing.status] ?? "SENT_TO_KITCHEN"),
            kitchenOrderId: existing.id
          });
          this.emit(recovered, "order.sent_to_kitchen.recovered");
          return recovered;
        }
        return order;
      }

      throw new Error(
        "NOTHING_REQUIRES_KITCHEN: ningún producto nuevo de este pedido necesita preparación en cocina."
      );
    }

    const sendSequence = previousOrders.reduce((max, candidate) => {
      const sequence = Number(
        (candidate as KitchenOrder & { sendSequence?: number }).sendSequence
      );
      return Number.isFinite(sequence) ? Math.max(max, sequence) : max;
    }, previousOrders.length);

    const sendIdentity = kitchenFingerprint(
      `${order.id}:${sendSequence + 1}`,
      kitchenItems
    );

    const sendOperationId = await deterministicUuid(
      `vimdy:kitchen-send:${sendIdentity}`
    );
    const kitchenOrderId = await deterministicUuid(
      `vimdy:kitchen-order:${sendOperationId}`
    );

    const existingSameOperation = previousOrders.find(
      (candidate) => candidate.id === kitchenOrderId
    );

    if (existingSameOperation && existingSameOperation.status !== "CANCELADO") {
      const recovered = await this.updateOrder(order.id, {
        status: existingSameOperation.status === "PENDIENTE"
          ? "SENT_TO_KITCHEN"
          : (KITCHEN_STATUS_MAP[existingSameOperation.status] ?? "SENT_TO_KITCHEN"),
        kitchenOrderId
      });

      this.emit(recovered, "order.sent_to_kitchen.recovered");
      return recovered;
    }

    const kitchenOrder = {
      id: kitchenOrderId,
      items: kitchenItems,
      status: "PENDIENTE" as const,
      createdAt: new Date(),
      origin: this.describeOrderOrigin(order),
      waiterId: order.waiterId,
      orderNumber: order.orderNumber,
      businessId: getCurrentBusinessId() ?? undefined,
      branchId: getCurrentBranchId() ?? undefined,
      tableId: order.tableId,
      orderId: order.id,
      sendOperationId,
      tableSessionId: (order as Order & { openOperationId?: string }).openOperationId,
      sendSequence: sendSequence + 1
    } as KitchenOrder & {
      sendOperationId: string;
      tableSessionId?: string;
      sendSequence: number;
    };

    await createKitchenOutput(kitchenOutputMode, this.kitchen).send(kitchenOrder);

    let sent: Order;
    try {
      sent = await this.updateOrder(orderId, {
        status: "SENT_TO_KITCHEN",
        kitchenOrderId
      });
    } catch (error) {
      // La comanda ya fue persistida con una identidad determinista. En el
      // siguiente retry se recuperará por kitchenOrderId sin duplicarla.
      throw error;
    }

    this.emit(sent, "order.sent_to_kitchen");

    return sent;
  }

  /** Texto descriptivo del origen del pedido, para mostrar en Cocina. */
  private describeOrderOrigin(order: Order): string {
    if (order.tableId) {
      return `Mesa ${order.tableId}`;
    }

    const labels: Record<OrderSource, string> = {
      TABLE: "Mesa",
      QUICK: "Mostrador",
      DELIVERY: "Domicilio",
      TAKEOUT: "Para llevar"
    };

    return labels[order.source] ?? "Pedido";
  }

  /**
   * Sincroniza el estado del pedido con el estado real de su comanda en
   * cocina (fuente de verdad). Debe llamarse periódicamente o al recibir
   * un evento "kitchen" mientras el pedido esté en curso.
   */
  public async syncKitchenStatus(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (!order.kitchenOrderId) {
      return order;
    }

    const kitchenOrder = await this.kitchen.getById(order.kitchenOrderId);

    if (!kitchenOrder) {
      return order;
    }

    const mapped = KITCHEN_STATUS_MAP[kitchenOrder.status];

    if (!mapped || mapped === order.status) {
      return order;
    }

    const updated = await this.updateOrder(orderId, { status: mapped });

    this.emit(updated, "order.status_synced");

    return updated;
  }

  public async markDelivered(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (order.kitchenOrderId) {
      await this.kitchen.updateStatus(order.kitchenOrderId, "ENTREGADO");
    }

    const delivered = await this.updateOrder(orderId, { status: "DELIVERED" });

    this.emit(delivered, "order.delivered");

    return delivered;
  }

  /* =======================================================================
     COBRO (delega en SalesEngine, nunca duplica su lógica)
  ======================================================================= */

  /**
   * Cobra el pedido: arma la venta correspondiente según su origen
   * (mesa, mostrador o domicilio) a través de SalesEngine, la cobra,
   * genera el recibo y marca el pedido como completado.
   */
  public async checkout(
    input: CheckoutOrderInput
  ): Promise<{ order: Order; sale: Sale; payment: PaymentResult; receipt: Receipt }> {
    const order = await this.getOrder(input.orderId);

    if (order.items.length === 0) {
      throw new Error("EMPTY_ORDER: el pedido no tiene productos para cobrar.");
    }

    if (order.status === "CANCELLED") {
      throw new Error(
        `ORDER_LOCKED: no se puede cobrar un pedido "${order.status}".`
      );
    }

    if (order.status === "COMPLETED") {
      if (!order.saleId) {
        throw new Error("ORDER_COMPLETED_WITHOUT_SALE: el pedido figura completado pero no tiene saleId.");
      }

      const completedSale = await this.sales.getSale(order.saleId);
      if (!completedSale) {
        throw new Error("ORDER_COMPLETED_SALE_NOT_FOUND: el pedido figura completado pero su venta no existe.");
      }

      const existingReceipt = await this.sales.getReceiptBySaleId(completedSale.id);
      const receipt = existingReceipt ?? await this.sales.generateReceipt(
        completedSale,
        input.customerName ?? "Cliente General",
        input.cashier ?? "Administrador",
        input.method,
        completedSale.paymentReceived ?? input.received ?? completedSale.total,
        completedSale.discount ?? 0
      );

      const payment: PaymentResult = {
        success: true,
        method: (completedSale.paymentMethod as PaymentMethod | undefined) ?? input.method,
        total: completedSale.total,
        received: completedSale.paymentReceived ?? input.received ?? completedSale.total,
        change: completedSale.changeGiven ?? 0,
        reference: completedSale.paymentReference ?? input.reference,
        message: "El pedido ya estaba cobrado; se recuperó el resultado idempotente.",
        date: completedSale.paidAt ?? completedSale.updatedAt,
        verificationStatus: completedSale.paymentVerificationSource === "EXTERNAL_TERMINAL"
          ? "EXTERNAL_TERMINAL"
          : "CONFIRMED",
        invoiceError: undefined
      };

      return {
        order,
        sale: completedSale,
        payment,
        receipt
      };
    }

    const items = order.items.map(item => ({
      productId: item.productId,
      quantity: item.quantity,
      price: item.price
    }));

    const sale = await this.createSaleForOrder(order, items, input);

    const { sale: paidSale, payment } = await this.sales.registerPayment(
      sale,
      input.method,
      { received: input.received, reference: input.reference }
    );

    if (!payment.success) {
      throw new Error(
        "ORDER_PAYMENT_PENDING_VERIFICATION: el pago todavía no está confirmado."
      );
    }

    const existingReceipt = await this.sales.getReceiptBySaleId(paidSale.id);
    const receipt = existingReceipt ?? await this.sales.generateReceipt(
      paidSale,
      input.customerName ?? "Cliente General",
      input.cashier ?? "Administrador",
      input.method,
      input.received ?? paidSale.total,
      paidSale.discount ?? 0
    );

    if (!existingReceipt) {
      this.sales.printReceipt(receipt);
    }

    const completed = await this.updateOrder(order.id, {
      status: "COMPLETED",
      saleId: paidSale.id
    });

    this.emit(completed, "order.completed");

    return { order: completed, sale: paidSale, payment, receipt };
  }

  public async cancelOrder(orderId: string, reason: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (order.status === "COMPLETED") {
      throw new Error("ORDER_LOCKED: no se puede cancelar un pedido ya cobrado.");
    }

    if (order.kitchenOrderId) {
      await this.kitchen.updateStatus(order.kitchenOrderId, "CANCELADO");
    }

    const cancelled = await this.updateOrder(orderId, {
      status: "CANCELLED",
      cancelReason: reason
    });

    this.emit(cancelled, "order.cancelled");

    return cancelled;
  }

  /* =======================================================================
     HELPERS PRIVADOS
  ======================================================================= */

  private async createSaleForOrder(
    order: Order,
    items: { productId: string; quantity: number; price: number }[],
    input: CheckoutOrderInput
  ): Promise<Sale> {
    // La venta derivada del Order conserva la misma identidad en cualquier
    // retry. Esto evita crear una segunda venta/inventario si la tablet pierde
    // la respuesta después de que el servidor ya creó la primera.
    const saleId = await deterministicUuid(
      `vimdy:order-sale:${order.id}`
    );

    switch (order.source) {
      case "TABLE":
        if (!order.tableId) {
          throw new Error("ORDER_MISSING_TABLE: el pedido de mesa no tiene tableId.");
        }

        return this.sales.tableSale({
          id: saleId,
          tableId: order.tableId,
          source: items,
          customerId: order.customerId,
          cashierId: input.cashierId,
          waiterId: order.waiterId,
          discount: input.discount,
          notes: order.notes,
          skipKitchen: Boolean(order.kitchenOrderId)
        });

      case "DELIVERY":
        return this.sales.deliverySale({
          id: saleId,
          deliveryAddress: input.deliveryAddress ?? "",
          deliveryFee: input.deliveryFee,
          source: items,
          customerId: order.customerId,
          cashierId: input.cashierId,
          discount: input.discount,
          notes: order.notes
        });

      case "QUICK":
      case "TAKEOUT":
      default:
        return this.sales.quickSale({
          id: saleId,
          source: items,
          customerId: order.customerId,
          cashierId: input.cashierId,
          discount: input.discount,
          notes: order.notes
        });
    }
  }

  private mergeItem(items: SaleItem[], newItem: SaleItem): SaleItem[] {
    const index = items.findIndex(item => item.productId === newItem.productId);

    if (index === -1) {
      return [...items, newItem];
    }

    return items.map((item, i) =>
      i === index
        ? { ...item, quantity: item.quantity + newItem.quantity }
        : item
    );
  }

  private async requireEditable(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (!EDITABLE_STATUSES.includes(order.status)) {
      throw new Error(
        `ORDER_NOT_EDITABLE: el pedido está en estado "${order.status}".`
      );
    }

    return order;
  }

  public async updateOrder(orderId: string, patch: Partial<Order>): Promise<Order> {
    const order = await this.getOrder(orderId);

    const updated: Order = {
      ...order,
      ...patch,
      updatedAt: new Date()
    };

    await this.orderRepository.update(updated);

    return updated;
  }

  /**
   * Calcula el próximo número correlativo (#154, #155, #156...) mirando
   * el mayor `orderNumber` ya guardado en el repositorio. A propósito no
   * usa un contador en memoria (`orderCounter`): ese se reinicia cada vez
   * que se recarga la página, y en cocina/meseros dos pedidos con el
   * mismo número visible sería peor que un UUID. Al leer siempre de lo
   * persistido, la secuencia sigue de donde iba incluso tras un refresh.
   */
  private async nextOrderNumber(): Promise<number> {
    const orders = await this.orderRepository.findAll();

    const lastNumber = orders.reduce(
      (max, order) => Math.max(max, order.orderNumber ?? 0),
      0
    );

    return lastNumber + 1;
  }

  private generateOrderCode(source: OrderSource): string {
    const prefix =
      source === "TABLE" ? "PED-MSA" :
      source === "DELIVERY" ? "PED-DEL" :
      source === "TAKEOUT" ? "PED-LLV" :
      "PED-RAP";

    const timestamp = Date.now().toString().slice(-9);
    const sequence = crypto.randomUUID().toString().slice(0, 8);

    return `${prefix}-${timestamp}-${sequence}`;
  }

  private emit(order: Order, action: string): void {
    vimdyCore.emit("order", { action, order });
  }
}