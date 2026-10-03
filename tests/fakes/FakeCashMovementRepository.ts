import { InMemoryRepository } from "./InMemoryRepository";
import { ICashMovementRepository } from "../../src/infrastructure/di/repositories/CashMovementRepository";
import { CashMovement, Sale, Product } from "../../src/core/entities/Entities";

export class FakeCashMovementRepository
  extends InMemoryRepository<CashMovement>
  implements ICashMovementRepository
{
  constructor(
    private readonly salesRepo: InMemoryRepository<Sale>,
    private readonly productsRepo: InMemoryRepository<Product>,
  ) {
    super("cash_movements");
  }

  async saveAtomic(movement: CashMovement, _saleId?: string | null): Promise<CashMovement> {
    return this.save(movement);
  }

  async saveAtomicPayment(_params: {
    saleId: string;
    businessId: string;
    branchId: string;
    cashRegisterId?: string;
    shiftId?: string;
    paymentId: string;
    changeId?: string | null;
    paymentMethod: string;
    total: number;
    cashAmount: number;
    received: number;
    change: number;
    reference?: string | null;
    verificationSource?: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER" | null;
  }): Promise<{ income: CashMovement; change: CashMovement | null }> {
    const income: CashMovement = {
      id: _params.paymentId,
      businessId: _params.businessId,
      branchId: _params.branchId,
      amount: _params.total,
      type: "IN",
      description: `Venta ${_params.saleId}`,
      date: new Date(),
      paymentMethod: _params.paymentMethod,
      cashRegisterId: _params.cashRegisterId,
      shiftId: _params.shiftId,
    };

    await this.save(income);

    let changeMovement: CashMovement | null = null;
    if (_params.change > 0 && _params.changeId) {
      changeMovement = {
        id: _params.changeId,
        businessId: _params.businessId,
        branchId: _params.branchId,
        amount: _params.change,
        type: "OUT",
        description: `Cambio venta ${_params.saleId}`,
        date: new Date(),
        paymentMethod: "CASH",
        cashRegisterId: _params.cashRegisterId,
        shiftId: _params.shiftId,
      };
      await this.save(changeMovement);
    }

    // La RPC real register_sale_payment_atomic() confirma, en la MISMA
    // transacción, los movimientos de caja Y el estado financiero de la
    // venta (status=PAID, paymentStatus=CONFIRMED, método, referencia,
    // efectivo, cambio, fechas). Este fake reproduce ese efecto sobre la
    // venta para que SalesEngine.registerPayment() — que omite el
    // updateSale local cuando isAtomic=true — quede consistente.
    const sale = await this.salesRepo.findById(_params.saleId);
    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    const verificationSource: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER" =
      _params.verificationSource ??
      (_params.paymentMethod === "CASH"
        ? "CASH"
        : _params.paymentMethod === "CARD"
          ? "EXTERNAL_TERMINAL"
          : "PROVIDER");

    const paidSale: Sale = {
      ...sale,
      status: "PAID",
      paymentMethod: _params.paymentMethod,
      paymentReference: _params.reference ?? undefined,
      paymentReceived: _params.received,
      changeGiven: _params.change,
      cashAmount: _params.cashAmount,
      paymentStatus: "CONFIRMED",
      paymentVerificationSource: verificationSource,
      paymentVerifiedAt: new Date(),
      paidAt: new Date(),
      cashRegisterId: _params.cashRegisterId ?? sale.cashRegisterId,
      shiftId: _params.shiftId ?? sale.shiftId,
      updatedAt: new Date(),
    };

    await this.salesRepo.update(paidSale as any);

    return { income, change: changeMovement };
  }

  async refundSaleCashAtomic(params: {
    businessId: string;
    branchId: string;
    saleId: string;
    refundId: string;
    refundItems: { productId: string; quantity: number }[];
    reason: string;
    cashRegisterId?: string | null;
  }): Promise<{
    success: boolean;
    idempotent: boolean;
    refundId: string;
    refundAmount: number;
    cashMovementId: string;
    sale: any;
  }> {
    const sale = await this.salesRepo.findById(params.saleId);
    if (!sale) {
      throw new Error("SALE_NOT_FOUND");
    }

    if (sale.status !== "PAID" && sale.status !== "CLOSED") {
      throw new Error("SALE_NOT_PAID");
    }

    if (sale.paymentStatus !== "CONFIRMED") {
      throw new Error("REFUND_PAYMENT_NOT_CONFIRMED");
    }

    if (sale.paymentMethod !== "CASH") {
      throw new Error("EXTERNAL_REFUND_REQUIRES_PROVIDER_CONFIRMATION");
    }

    const saleSubtotal = Number(sale.subtotal ?? sale.total);
    const saleTotal = Number(sale.total);
    if (saleSubtotal <= 0 || saleTotal <= 0) {
      throw new Error("SALE_FINANCIAL_TOTAL_INVALID");
    }

    const alreadyRefunded = (sale.refunds ?? []).reduce((sum, r) => sum + Number(r.amount ?? 0), 0);

    const refundSubtotal = params.refundItems.reduce((sum, item) => {
      const saleItem = sale.items.find((si: any) => si.productId === item.productId);
      if (!saleItem) {
        throw new Error("REFUND_ITEM_NOT_IN_SALE");
      }
      const originalQty = Number(saleItem.quantity);
      const itemSubtotal = Number(saleItem.price) * originalQty;
      return sum + (itemSubtotal / originalQty) * item.quantity;
    }, 0);

    // La RPC determina "reembolso total" revisando TODOS los
    // ítems de la venta (no solo los de esta solicitud): la
    // venta solo pasa a REFUNDED cuando cada unidad de cada
    // ítem ya fue devuelta (reembolsos previos + esta solicitud).
    const originalByProduct = new Map<string, number>();
    for (const saleItem of sale.items) {
      originalByProduct.set(
        saleItem.productId,
        (originalByProduct.get(saleItem.productId) ?? 0) + Number(saleItem.quantity)
      );
    }
    const previouslyRefundedByProduct = new Map<string, number>();
    for (const refund of sale.refunds ?? []) {
      for (const line of refund.items ?? []) {
        previouslyRefundedByProduct.set(
          line.productId,
          (previouslyRefundedByProduct.get(line.productId) ?? 0) + Number(line.quantity)
        );
      }
    }
    const requestedByProduct = new Map<string, number>();
    for (const item of params.refundItems) {
      requestedByProduct.set(
        item.productId,
        (requestedByProduct.get(item.productId) ?? 0) + Number(item.quantity)
      );
    }
    let allRefunded = true;
    for (const [productId, originalQty] of originalByProduct) {
      const refundedQty =
        (previouslyRefundedByProduct.get(productId) ?? 0) +
        (requestedByProduct.get(productId) ?? 0);
      if (refundedQty < originalQty) {
        allRefunded = false;
        break;
      }
    }

    // Monto fiel a la RPC: reembolso total = total de venta
    // menos lo ya reembolsado; parcial = parte proporcional
    // (subtotal + impuesto - descuento).
    const effectiveRate =
      Number(sale.subtotal) > 0 ? refundSubtotal / Number(sale.subtotal) : 0;
    const refundTax = Number(sale.tax ?? 0) * effectiveRate;
    const refundDiscount = Number(sale.discount ?? 0) * effectiveRate;
    const refundAmount = Number((
      allRefunded
        ? Number(sale.total) - alreadyRefunded
        : Math.max(refundSubtotal + refundTax - refundDiscount, 0)
    ).toFixed(2));

    if (refundAmount <= 0 || refundAmount > Number(sale.total) - alreadyRefunded) {
      throw new Error("REFUND_AMOUNT_EXCEEDS_REMAINING");
    }

    const cashMovementId = params.refundId;
    const cashMovement: CashMovement = {
      id: cashMovementId,
      businessId: params.businessId,
      branchId: params.branchId,
      amount: refundAmount,
      type: "OUT",
      description: `Reembolso venta ${sale.code ?? sale.id}`,
      date: new Date(),
      paymentMethod: "CASH",
      cashRegisterId: params.cashRegisterId ?? sale.cashRegisterId,
      shiftId: sale.shiftId,
    };

    await this.save(cashMovement);

    const newStatus = allRefunded ? "REFUNDED" : sale.status;

    const refundRecord = {
      id: params.refundId,
      items: params.refundItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      amount: refundAmount,
      reason: params.reason,
      actorId: sale.cashierId,
      createdAt: new Date(),
    };

    const updatedSale: Sale = {
      ...sale,
      status: newStatus,
      refunds: [...(sale.refunds ?? []), refundRecord],
      updatedAt: new Date(),
    };

    await this.salesRepo.update(updatedSale as any);

    // Reversa de inventario: la RPC expande los ítems
    // reembolsados a los requerimientos REALES de stock
    // (ingredientes de recetas, no el producto padre que no
    // maneja stock propio) y repone esos. Mismo criterio que
    // consumeForSale usa al descontar.
    const stockTargets = await this.expandRefundStockTargets(sale, params.refundItems);
    for (const [productId, quantity] of stockTargets) {
      const product = await this.productsRepo.findById(productId);
      if (!product) {
        throw new Error("REFUND_INVENTORY_PRODUCT_NOT_FOUND");
      }
      const newStock = Number(product.stock ?? 0) + quantity;
      await this.productsRepo.update({ ...product, stock: newStock } as any);
    }

    return {
      success: true,
      idempotent: false,
      refundId: params.refundId,
      refundAmount,
      cashMovementId,
      sale: updatedSale,
    };
  }

  /**
   * Expande los ítems de un reembolso a los productos REALES
   * cuyo stock debe repone: la misma resolución que consumeForSale
   * usa para descontar (receta del tamaño seleccionado o del
   * producto, más la de los extras; recursiva para ingredientes
   * con receta). Productos con trackStock=false (servicios) no
   * generan reposición, igual que al vender.
   */
  private async expandRefundStockTargets(
    sale: Sale,
    refundItems: { productId: string; quantity: number }[]
  ): Promise<Map<string, number>> {
    const targets = new Map<string, number>();

    const resolveRecipe = (
      product: Product,
      saleItem?: { selectedSize?: any; selectedExtras?: any[] }
    ): { productId: string; quantity: number }[] => {
      const baseRecipe = saleItem?.selectedSize?.recipe?.length
        ? saleItem.selectedSize.recipe
        : product.recipe ?? [];
      const extrasRecipe =
        saleItem?.selectedExtras?.flatMap((extra: any) => extra.recipe ?? []) ?? [];
      if (extrasRecipe.length === 0) return baseRecipe;

      const merged = new Map<string, number>();
      for (const ingredient of [...baseRecipe, ...extrasRecipe]) {
        merged.set(
          ingredient.productId,
          (merged.get(ingredient.productId) ?? 0) + ingredient.quantity
        );
      }
      return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
    };

    const expand = async (
      productId: string,
      quantity: number,
      saleItem: { selectedSize?: any; selectedExtras?: any[] } | undefined,
      ancestors: Set<string>
    ): Promise<void> => {
      const product = await this.productsRepo.findById(productId);
      if (!product) {
        throw new Error("REFUND_INVENTORY_PRODUCT_NOT_FOUND");
      }

      const recipe = resolveRecipe(product, saleItem);
      const usesRecipe = product.productionMode !== "BATCH" && recipe.length > 0;
      if (!usesRecipe) {
        if (product.trackStock === false && product.productionMode !== "BATCH") return;
        targets.set(productId, (targets.get(productId) ?? 0) + quantity);
        return;
      }

      if (ancestors.has(productId)) {
        throw new Error("RECIPE_CYCLE");
      }
      const nextAncestors = new Set(ancestors).add(productId);
      for (const ingredient of recipe) {
        await expand(ingredient.productId, ingredient.quantity * quantity, undefined, nextAncestors);
      }
    };

    for (const item of refundItems) {
      const saleItem = sale.items.find((si: any) => si.productId === item.productId);
      await expand(item.productId, item.quantity, saleItem, new Set());
    }

    return targets;
  }
}
