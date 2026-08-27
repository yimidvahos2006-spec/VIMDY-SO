// src/core/engines/PurchaseOrderEngine.ts
import { Product, PurchaseOrder, PurchaseOrderItem, PurchaseOrderStatus } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { InventoryEngine } from "./InventoryEngine";
import { RecipeEngine } from "./RecipeEngine";
import { getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";

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

const OPEN_STATUSES: readonly PurchaseOrderStatus[] = ["PENDIENTE", "POSPUESTO"];

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
  constructor(
    private readonly repository: IRepository<PurchaseOrder>,
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
   * Marca una orden como comprada: descarga cada item al inventario real
   * (vía InventoryEngine.increaseStock, con proveedor y precio) y calcula
   * qué mejoró (capacidad de producción, riesgo de desabastecimiento) para
   * que la UI pueda mostrar los mensajes del Gerente Inteligente.
   *
   * @param adjustedItems Si lo recibido difiere de lo pedido (cantidad o
   * precio reales), se pasa aquí; se guarda como la versión final de la
   * orden sin perder que originalmente se pidió otra cosa (queda en el
   * historial de todas formas, solo se reemplaza `items`).
   */
  public async markAsPurchased(
    orderId: string,
    performedBy?: string,
    adjustedItems?: PurchaseOrderItem[]
  ): Promise<PurchaseReceiptResult> {
    const order = await this.repository.findById(orderId);
    if (!order) {
      throw new Error("PURCHASE_ORDER_NOT_FOUND");
    }
    if (!OPEN_STATUSES.includes(order.status)) {
      throw new Error(`PURCHASE_ORDER_NOT_OPEN: la orden ya está en estado ${order.status}.`);
    }

    const finalItems = adjustedItems && adjustedItems.length > 0 ? adjustedItems : order.items;

    // Foto ANTES de recibir: capacidad de producción de todo producto con
    // receta que use alguno de los ingredientes comprados, y quiénes de los
    // productos comprados estaban agotados/bajo mínimo.
    const productsBefore = await this.inventoryEngine.listAll();
    const productMapBefore = new Map(productsBefore.map((p) => [p.id, p]));
    const purchasedIds = new Set(finalItems.map((i) => i.productId));

    const dependentProducts = productsBefore.filter(
      (p) => p.recipe && p.recipe.some((ing) => purchasedIds.has(ing.productId))
    );
    const capacityBefore = new Map(
      dependentProducts.map((p) => [p.id, this.recipeEngine.getProductionCapacity(p, productMapBefore)])
    );

    const wasAtRisk = new Set(
      finalItems
        .map((item) => productMapBefore.get(item.productId))
        .filter((p): p is Product => !!p && (p.stock <= 0 || p.stock <= p.minStock))
        .map((p) => p.id)
    );

    // Recibir de verdad: reutiliza InventoryEngine, nunca reimplementa el
    // aumento de stock.
    for (const item of finalItems) {
      await this.inventoryEngine.increaseStock(
        item.productId,
        item.quantity,
        `Compra recibida (orden ${order.id})`,
        performedBy,
        order.supplierId,
        item.unitPrice,
        undefined,
        getCurrentBranchId()
      );
    }

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
    for (const item of finalItems) {
      if (!wasAtRisk.has(item.productId)) continue;
      const productAfter = productMapAfter.get(item.productId);
      if (productAfter && productAfter.stock > productAfter.minStock && productAfter.stock > 0) {
        stockoutResolved.push(productAfter.name);
      }
    }

    const updatedOrder: PurchaseOrder = {
      ...order,
      items: finalItems,
      status: "COMPRADO",
      receivedAt: new Date()
    };
    await this.repository.update(updatedOrder);

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