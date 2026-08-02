import {
  Order,
  OrderSource,
  OrderStatus,
  SaleItem,
  Product,
  Sale
} from "../entities/Entities";

import { IRepository } from "../../infrastructure/di/repositories/IRepository";

import { KitchenEngine } from "./KitchenEngine";
import { SalesEngine, DiscountInput } from "./SalesEngine";
import { PaymentMethod, PaymentResult } from "./PaymentEngine";
import { Receipt } from "./ReceiptEngine";

import { vimdyCore } from "../VimdyCore";
import { kitchenOutputModeStore } from "../store/kitchenOutputModeStore";
import { createKitchenOutput } from "../services/KitchenOutputFactory";

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

let orderCounter = 0;

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
    const now = new Date();
    const orderNumber = await this.nextOrderNumber();

    const order: Order = {
      id: crypto.randomUUID(),
      code: this.generateOrderCode(input.source),
      orderNumber,
      source: input.source,
      tableId: input.tableId,
      waiterId: input.waiterId,
      customerId: input.customerId,
      items: [],
      notes: input.notes,
      status: "DRAFT",
      createdAt: now,
      updatedAt: now
    };

    await this.orderRepository.save(order);

    this.emit(order, "order.created");

    return order;
  }

  public async getOrder(orderId: string): Promise<Order> {
    const order = await this.orderRepository.findById(orderId);

    if (!order) {
      throw new Error("ORDER_NOT_FOUND");
    }

    return order;
  }

  public async getAllOrders(): Promise<Order[]> {
    return this.orderRepository.findAll();
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
        requiresKitchen: input.product.requiresKitchen ?? true
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
   * Envía el pedido a cocina. Puede llamarse más de una vez sobre el mismo
   * pedido lógico (ej. se agregaron postres después): cada llamada crea
   * una nueva comanda con los items vigentes en ese momento.
   */
  public async sendToKitchen(orderId: string): Promise<Order> {
    const order = await this.getOrder(orderId);

    if (order.items.length === 0) {
      throw new Error("EMPTY_ORDER: no hay productos para enviar a cocina.");
    }

    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new Error(
        `ORDER_LOCKED: no se puede enviar a cocina un pedido "${order.status}".`
      );
    }

    // Solo los productos que de verdad necesitan preparación entran a la
    // comanda (ver SaleItem.requiresKitchen, capturado en addItem()). Un
    // pedido de solo bebidas embotelladas, por ejemplo, no genera ticket
    // en Cocina.
    const kitchenItems = order.items.filter(item => item.requiresKitchen !== false);

    if (kitchenItems.length === 0) {
      throw new Error(
        "NOTHING_REQUIRES_KITCHEN: ningún producto de este pedido necesita preparación en cocina."
      );
    }

    const kitchenOrderId = crypto.randomUUID();

    // Antes: await this.kitchen.save({...}) directo, que siempre iba a
    // pantalla. Ahora, el mismo objeto se envía a través del KitchenOutput
    // que corresponda según salidaCocina (ver 5.5) — hoy siempre pantalla
    // en la práctica, porque es el default y ningún negocio de prueba usa
    // impresora todavía.
    await createKitchenOutput(kitchenOutputModeStore.get(), this.kitchen).send({
      id: kitchenOrderId,
      items: kitchenItems,
      status: "PENDIENTE",
      createdAt: new Date(),
      origin: this.describeOrderOrigin(order),
      waiterId: order.waiterId,
      orderNumber: order.orderNumber
    });

    const sent = await this.updateOrder(orderId, {
      status: "SENT_TO_KITCHEN",
      kitchenOrderId
    });

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

    if (order.status === "COMPLETED" || order.status === "CANCELLED") {
      throw new Error(
        `ORDER_LOCKED: no se puede cobrar un pedido "${order.status}".`
      );
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

    const receipt = await this.sales.generateReceipt(
      paidSale,
      input.customerName ?? "Cliente General",
      input.cashier ?? "Administrador",
      input.method,
      input.received ?? paidSale.total,
      paidSale.discount ?? 0
    );

    this.sales.printReceipt(receipt);

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
    switch (order.source) {
      case "TABLE":
        if (!order.tableId) {
          throw new Error("ORDER_MISSING_TABLE: el pedido de mesa no tiene tableId.");
        }

        return this.sales.tableSale({
          tableId: order.tableId,
          source: items,
          customerId: order.customerId,
          cashierId: input.cashierId,
          waiterId: order.waiterId,
          discount: input.discount,
          notes: order.notes
        });

      case "DELIVERY":
        return this.sales.deliverySale({
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

  private async updateOrder(orderId: string, patch: Partial<Order>): Promise<Order> {
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
    orderCounter += 1;

    const prefix =
      source === "TABLE" ? "PED-MSA" :
      source === "DELIVERY" ? "PED-DEL" :
      source === "TAKEOUT" ? "PED-LLV" :
      "PED-RAP";

    const timestamp = Date.now().toString().slice(-6);
    const sequence = orderCounter.toString().padStart(4, "0");

    return `${prefix}-${timestamp}-${sequence}`;
  }

  private emit(order: Order, action: string): void {
    vimdyCore.emit("order", { action, order });
  }
}