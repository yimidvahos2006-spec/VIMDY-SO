// src/core/engines/PurchaseOrderEngine.ts
import { IsoDateString, Product, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { InventoryEngine } from "./InventoryEngine";
import { RecipeEngine } from "./RecipeEngine";
import { isIsoDateString } from "../utils/isoDate";

/** Productos con receta cuya capacidad real de producción mejoró al recibir una compra. */
export interface CapacityImprovement {
  readonly productName: string;
  readonly beforeMaxUnits: number;
  readonly afterMaxUnits: number;
}

/** Resultado de marcar una orden como comprada: para que la UI arme los mensajes del Gerente Inteligente. */
export interface PurchaseReceiptResult {
  readonly order: PurchaseOrder;
  /** Productos con receta que ahora se pueden preparar en más cantidad gracias a esta compra. */
  readonly capacityImproved: readonly CapacityImprovement[];
  /** Nombres de los productos/ingredientes comprados que estaban en riesgo de desabastecimiento (agotados o bajo mínimo) y dejaron de estarlo. */
  readonly stockoutResolved: readonly string[];
}

const OPEN_STATUSES: readonly PurchaseOrderStatus[] = ["PENDIENTE", "POSPUESTO", "PARCIAL"];

/** Lo que llegó de un producto en una recepción (el repositorio lo manda al servidor). */
export interface PurchaseReceiptInput {
  readonly productId: string;
  readonly quantity: number;
  readonly unitPrice?: number;
  /** Vencimiento del lote recibido (YYYY-MM-DD). Opcional. */
  readonly expiresAt?: IsoDateString;
}

/** Línea de una recepción tal como se manda al servidor: solo lleva `expiresAt` si hay valor. */
function toReceiptInput(item: PurchaseOrderItem): PurchaseReceiptInput {
  return {
    productId: item.productId,
    quantity: item.quantity,
    unitPrice: item.unitPrice,
    ...(item.expiresAt !== undefined ? { expiresAt: item.expiresAt } : {})
  };
}

/** El servidor rechaza una fecha mal formada con INVALID_EXPIRES_AT; aquí se corta antes de guardar nada. */
function assertValidExpiry(items: readonly PurchaseOrderItem[]): void {
  for (const item of items) {
    if (item.expiresAt !== undefined && !isIsoDateString(item.expiresAt)) {
      throw new Error("INVALID_EXPIRES_AT");
    }
  }
}

/**
 * Recibir mercancía de verdad ocurre en el servidor, en una sola operación
 * atómica (stock + kardex + estado de la orden). El motor solo la pide.
 */
export interface PurchaseOrderReceiver {
  receive(params: {
    purchaseOrderId: string;
    operationId: string;
    items?: readonly PurchaseReceiptInput[];
    note?: string;
    performedBy?: string;
  }): Promise<{ status: string; idempotent: boolean }>;
}

/**
 * Flujo B (compra directa): factura / nota de entrega sin orden previa. El
 * servidor crea la orden y la recibe con el MISMO motor del flujo A, en una
 * sola transacción.
 */
export interface DirectPurchaseRecorder {
  recordDirect(params: {
    operationId: string;
    supplierId: string;
    items: readonly PurchaseReceiptInput[];
    invoiceNumber?: string;
    note?: string;
    performedBy?: string;
  }): Promise<{ status: string; idempotent: boolean; purchaseOrderId: string }>;
}

/** Lo que se captura al registrar una compra directa (factura / nota de entrega). */
export interface DirectPurchaseInput {
  readonly supplierId: string;
  /** Una línea por producto, con la cantidad y el precio unitario reales de la factura. */
  readonly items: readonly PurchaseOrderItem[];
  readonly invoiceNumber?: string;
  readonly note?: string;
  readonly performedBy?: string;
  /**
   * Clave de idempotencia ya generada y guardada de forma persistente (cola
   * offline de compras). Si se indica, se usa tal cual: un reintento después
   * de reiniciar el navegador manda el MISMO id y el servidor no vuelve a
   * sumar el stock. Si no se indica, el engine genera uno y lo recuerda en memoria.
   */
  readonly operationId?: string;
}

/** Cuánto falta por recibir de un item de la orden. */
export function remainingQuantity(order: PurchaseOrder, item: PurchaseOrderItem): number {
  const received = order.receivedQuantities?.[item.productId] ?? 0;
  return Math.max(0, Math.round((item.quantity - received) * 1e6) / 1e6);
}

/**
 * PurchaseOrderEngine — PASO 2.7 (Compras Inteligentes, ejecución).
 * ---------------------------------------------------------------------------
 * Convierte una recomendación de compra (PurchaseIntelligenceEngine, PASO
 * 2.6, que SOLO analiza) en una acción real con estado e historial. Nunca
 * duplica lógica de inventario: al recibir una compra, reutiliza
 * InventoryEngine.increaseStock() por cada item — el mismo motor que ya usa
 * el "Aumentar stock" manual de Inventario. Nunca borra órdenes: cancelar y
 * posponer solo cambian `status`, preservando el historial completo.
 */
export class PurchaseOrderEngine {
  /**
   * Operaciones de recepción en curso. Si un intento falla por la red y la
   * persona vuelve a pulsar "Recibir" con las mismas cantidades, se reutiliza
   * el MISMO identificador: así, si el servidor sí alcanzó a guardar, el
   * reintento no vuelve a sumar el stock.
   */
  private readonly pendingReceipts = new Map<string, string>();
  /** Igual que pendingReceipts, para compras directas (flujo B). */
  private readonly pendingDirectPurchases = new Map<string, string>();

  constructor(
    private readonly repository: IRepository<PurchaseOrder> & Partial<PurchaseOrderReceiver> & Partial<DirectPurchaseRecorder>,
    private readonly inventoryEngine: InventoryEngine,
    private readonly recipeEngine: RecipeEngine
  ) {}

  public async listAll(): Promise<PurchaseOrder[]> {
    const orders = await this.repository.findAll();
    return orders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
  }

  public async listByStatus(status: PurchaseOrderStatus): Promise<PurchaseOrder[]> {
    const orders = await this.listAll();
    return orders.filter((o) => o.status === status);
  }

  public async getById(id: string): Promise<PurchaseOrder | null> {
    return this.repository.findById(id);
  }

  /**
   * Crea una orden de compra PENDIENTE.
   * Regla "nunca duplicar compras": si ya existe una orden abierta
   * (PENDIENTE o POSPUESTO) que incluya alguno de los mismos productos, se
   * rechaza — hay que recibir, posponer o cancelar esa orden primero.
   */
  public async create(input: {
    items: PurchaseOrderItem[];
    supplierId: string;
    expectedDeliveryDate?: Date;
    createdBy?: string;
  }): Promise<PurchaseOrder> {
    if (!input.supplierId) {
      throw new Error("SUPPLIER_REQUIRED");
    }
    if (!input.items || input.items.length === 0) {
      throw new Error("ITEMS_REQUIRED");
    }
    for (const item of input.items) {
      if (!item.productId || item.quantity <= 0) {
        throw new Error("INVALID_ITEM: cada ítem necesita producto y cantidad mayor a cero.");
      }
    }

    const openOrders = await this.listAll();
    const requestedProductIds = new Set(input.items.map((i) => i.productId));

    for (const order of openOrders) {
      if (!OPEN_STATUSES.includes(order.status)) continue;
      const duplicated = order.items.find((item) => requestedProductIds.has(item.productId));
      if (duplicated) {
        throw new Error(
          `DUPLICATE_PURCHASE: Ya existe una orden ${order.status.toLowerCase()} (creada el ` +
            `${new Date(order.createdAt).toLocaleDateString("es-CO")}) que incluye este producto. ` +
            `Recíbela, pospónla o cancélala antes de crear una nueva.`
        );
      }
    }

    const order: PurchaseOrder = {
      id: crypto.randomUUID(),
      items: input.items,
      supplierId: input.supplierId,
      status: "PENDIENTE",
      createdBy: input.createdBy,
      createdAt: new Date(),
      expectedDeliveryDate: input.expectedDeliveryDate
    };

    await this.repository.save(order);
    return order;
  }

  /**
   * Recibe mercancía de una orden y la lleva al inventario real. Todo el
   * trabajo importante (sumar stock, escribir el kardex y actualizar la
   * orden) lo hace el servidor en UNA sola transacción: o entra todo o no
   * entra nada, y repetir la misma operación no duplica el stock.
   *
   * @param receivedNow Lo que llegó ahora. Si no se indica, se recibe todo
   * lo que falta de la orden. Si llega menos de lo pedido, la orden queda
   * PARCIAL y se puede seguir recibiendo hasta completarla (COMPRADO). No se
   * puede recibir más de lo que falta.
   * @param providedOperationId Clave de idempotencia persistente (cola offline).
   * Si se indica, es un REINTENTO posible de una operación que el servidor
   * quizá ya aplicó: se omite el chequeo local de "orden abierta" y el servidor
   * decide (responde idempotente si ya la aplicó, o la rechaza si no corresponde).
   */
  public async markAsPurchased(
    orderId: string,
    performedBy?: string,
    receivedNow?: PurchaseOrderItem[],
    providedOperationId?: string
  ): Promise<PurchaseReceiptResult> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new Error("PURCHASE_ORDER_NOT_FOUND");
    }
    if (!providedOperationId && !OPEN_STATUSES.includes(order.status)) {
      throw new Error(`PURCHASE_ORDER_NOT_OPEN: la orden ya está en estado ${order.status}.`);
    }
    if (typeof this.repository.receive !== "function") {
      throw new Error("PURCHASE_RECEIVE_UNAVAILABLE");
    }

    const itemsNow: PurchaseOrderItem[] =
      receivedNow && receivedNow.length > 0
        ? receivedNow.filter((i) => i.quantity > 0)
        : order.items
            .map((item) => ({ ...item, quantity: remainingQuantity(order, item) }))
            .filter((item) => item.quantity > 0);

    if (itemsNow.length === 0) {
      throw new Error("PURCHASE_ITEMS_INVALID");
    }
    assertValidExpiry(itemsNow);

    // Mismo identificador mientras sean las mismas cantidades y no haya
    // terminado bien: protege contra el doble clic y contra reintentos tras
    // un corte de internet.
    const receiptKey = `${orderId}|${JSON.stringify(
      itemsNow.map((i) => [i.productId, i.quantity, i.unitPrice, i.expiresAt ?? null]).sort()
    )}`;
    const operationId = providedOperationId ?? this.pendingReceipts.get(receiptKey) ?? crypto.randomUUID();
    if (!providedOperationId) {
      this.pendingReceipts.set(receiptKey, operationId);
    }

    const receiver = this.repository.receive.bind(this.repository);
    return this.applyWithImpact(itemsNow, order, async () => {
      await receiver({
        purchaseOrderId: orderId,
        operationId,
        items: itemsNow.map(toReceiptInput),
        performedBy
      });
      this.pendingReceipts.delete(receiptKey);
      return orderId;
    });
  }

  /**
   * FLUJO B — compra directa: la factura o nota de entrega llegó sin una
   * orden previa. Va al MISMO motor del servidor que el flujo A (la orden se
   * crea y se recibe dentro de una sola transacción: stock + kardex + precio
   * de compra + auditoría). Repetir la misma operación no duplica el stock.
   */
  public async recordDirectPurchase(input: DirectPurchaseInput): Promise<PurchaseReceiptResult> {
    if (!input.supplierId) {
      throw new Error("SUPPLIER_REQUIRED");
    }
    if (!input.items || input.items.length === 0) {
      throw new Error("ITEMS_REQUIRED");
    }
    const seen = new Set<string>();
    for (const item of input.items) {
      if (!item.productId || !Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("PURCHASE_ITEM_INVALID");
      }
      if (!Number.isFinite(item.unitPrice) || item.unitPrice <= 0) {
        throw new Error("PURCHASE_UNIT_PRICE_REQUIRED");
      }
      if (seen.has(item.productId)) {
        throw new Error("PURCHASE_ITEM_DUPLICATED");
      }
      seen.add(item.productId);
    }
    assertValidExpiry(input.items);
    if (typeof this.repository.recordDirect !== "function") {
      throw new Error("PURCHASE_RECORD_UNAVAILABLE");
    }

    const invoiceNumber = input.invoiceNumber?.trim() || undefined;
    const itemsNow: PurchaseOrderItem[] = input.items.map((i) => ({
      productId: i.productId,
      quantity: i.quantity,
      unitPrice: i.unitPrice,
      ...(i.expiresAt !== undefined ? { expiresAt: i.expiresAt } : {})
    }));

    // Mismo identificador para el mismo documento mientras no termine bien:
    // el doble clic o un reintento tras un corte de internet no suma dos veces.
    const directKey = `${input.supplierId}|${invoiceNumber ?? ""}|${JSON.stringify(
      itemsNow.map((i) => [i.productId, i.quantity, i.unitPrice, i.expiresAt ?? null]).sort()
    )}`;
    const operationId = input.operationId ?? this.pendingDirectPurchases.get(directKey) ?? crypto.randomUUID();
    if (!input.operationId) {
      this.pendingDirectPurchases.set(directKey, operationId);
    }

    const placeholder: PurchaseOrder = {
      id: operationId,
      items: itemsNow,
      supplierId: input.supplierId,
      status: "COMPRADO",
      source: "DIRECTA",
      invoiceNumber,
      createdBy: input.performedBy,
      createdAt: new Date(),
      receivedAt: new Date()
    };

    const recorder = this.repository.recordDirect.bind(this.repository);
    return this.applyWithImpact(itemsNow, placeholder, async () => {
      const result = await recorder({
        operationId,
        supplierId: input.supplierId,
        items: itemsNow.map(toReceiptInput),
        invoiceNumber,
        note: input.note,
        performedBy: input.performedBy
      });
      this.pendingDirectPurchases.delete(directKey);
      return result.purchaseOrderId;
    });
  }

  /**
   * Compartido por los DOS flujos: toma una foto del inventario antes de
   * recibir, ejecuta la recepción en el servidor y compara después para
   * armar los mensajes del Gerente Inteligente (capacidad de producción
   * mejorada, desabastecimiento resuelto).
   */
  private async applyWithImpact(
    itemsNow: readonly PurchaseOrderItem[],
    fallbackOrder: PurchaseOrder,
    execute: () => Promise<string>
  ): Promise<PurchaseReceiptResult> {
    // Foto ANTES de recibir: capacidad de producción de todo producto con
    // receta que use alguno de los ingredientes comprados, y quiénes de los
    // productos comprados estaban agotados/bajo mínimo.
    const productsBefore = await this.inventoryEngine.listAll();
    const productMapBefore = new Map(productsBefore.map((p) => [p.id, p]));
    const purchasedIds = new Set(itemsNow.map((i) => i.productId));

    const dependentProducts = productsBefore.filter(
      (p) => p.recipe && p.recipe.some((ing) => purchasedIds.has(ing.productId))
    );
    const capacityBefore = new Map(
      dependentProducts.map((p) => [p.id, this.recipeEngine.getProductionCapacity(p, productMapBefore)])
    );

    const wasAtRisk = new Set(
      itemsNow
        .map((item) => productMapBefore.get(item.productId))
        .filter((p): p is Product => !!p && (p.stock <= 0 || p.stock <= p.minStock))
        .map((p) => p.id)
    );

    const orderId = await execute();

    // Foto DESPUÉS: mismo cálculo, con inventario ya actualizado.
    const productsAfter = await this.inventoryEngine.listAll();
    const productMapAfter = new Map(productsAfter.map((p) => [p.id, p]));

    const capacityImproved: CapacityImprovement[] = [];
    for (const product of dependentProducts) {
      const before = capacityBefore.get(product.id);
      const productAfter = productMapAfter.get(product.id);
      if (!before || !productAfter) continue;
      const after = this.recipeEngine.getProductionCapacity(productAfter, productMapAfter);
      if (after && after.maxUnits > before.maxUnits) {
        capacityImproved.push({
          productName: product.name,
          beforeMaxUnits: before.maxUnits,
          afterMaxUnits: after.maxUnits
        });
      }
    }

    const stockoutResolved: string[] = [];
    for (const item of itemsNow) {
      if (!wasAtRisk.has(item.productId)) continue;
      const productAfter = productMapAfter.get(item.productId);
      if (productAfter && productAfter.stock > productAfter.minStock && productAfter.stock > 0) {
        stockoutResolved.push(productAfter.name);
      }
    }

    // El estado final (PARCIAL o COMPRADO) lo decidió el servidor: se lee de vuelta.
    const updatedOrder = (await this.repository.findById(orderId)) ?? fallbackOrder;

    return { order: updatedOrder, capacityImproved, stockoutResolved };
  }

  /** Pospone una orden abierta a una nueva fecha estimada. Nunca borra el registro. */
  public async postpone(orderId: string, newExpectedDate: Date, note?: string): Promise<PurchaseOrder> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new Error("PURCHASE_ORDER_NOT_FOUND");
    }
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new Error(`PURCHASE_ORDER_NOT_OPEN: la orden ya está en estado ${order.status}.`);
    }

    const updated: PurchaseOrder = {
      ...order,
      status: "POSPUESTO",
      expectedDeliveryDate: newExpectedDate,
      statusNote: note
    };
    await this.repository.update(updated);
    return updated;
  }

  /** Cancela una orden abierta. Nunca borra el registro (queda en el historial como CANCELADO). */
  public async cancel(orderId: string, note?: string): Promise<PurchaseOrder> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new Error("PURCHASE_ORDER_NOT_FOUND");
    }
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new Error(`PURCHASE_ORDER_NOT_OPEN: la orden ya está en estado ${order.status}.`);
    }

    const updated: PurchaseOrder = {
      ...order,
      status: "CANCELADO",
      statusNote: note
    };
    await this.repository.update(updated);
    return updated;
  }
}