import type {
  Category,
  InventoryMovement,
  LossCategory,
  Product,
  ProductExtraOption,
  ProductSizeOption,
  RecipeItem,
  Supplier
} from "../entities/Entities";
import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import type { IProductRepository } from "../../infrastructure/di/repositories/IProductRepository";
import { KardexEngine } from "./KardexEngine";
import { companyConfigStore } from "../store/companyConfigStore";
import { getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";

export type ProductInput = Partial<Product> & { name: string };

export interface SaleStockItem {
  productId: string;
  quantity: number;
  selectedSize?: ProductSizeOption;
  selectedExtras?: readonly ProductExtraOption[];
}

export class InventoryEngine {
  constructor(
    private readonly repository?: IProductRepository,
    private readonly kardex?: KardexEngine,
    private readonly supplierRepository?: IRepository<Supplier>,
    private readonly categoryRepository?: IRepository<Category>
  ) {}

  private getRepository(): IProductRepository {
    if (!this.repository) {
      throw new Error("INVENTORY_REPOSITORY_REQUIRED");
    }
    return this.repository;
  }

  private getKardex(): KardexEngine {
    if (!this.kardex) {
      throw new Error("INVENTORY_KARDEX_REQUIRED");
    }
    return this.kardex;
  }

  public async listAll(): Promise<Product[]> {
    return this.getRepository().findAll();
  }

  public async search(query: string): Promise<Product[]> {
    const needle = query.trim().toLowerCase();
    if (!needle) return this.listAll();

    return (await this.listAll()).filter((product) => {
      const haystack = [product.name, product.barcode ?? "", product.sku ?? "", product.categoryId]
        .join(" ")
        .toLowerCase();
      return haystack.includes(needle);
    });
  }

  public async getById(productId: string): Promise<Product | null> {
    return this.getRepository().findById(productId);
  }

  public async getMany(productIds: string[]): Promise<Product[]> {
    return this.getRepository().findMany(Array.from(new Set(productIds)));
  }

  public async findById(productId: string): Promise<Product | null> {
    return this.getById(productId);
  }

  public async createProduct(input: ProductInput, _performedBy?: string): Promise<Product> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('PRODUCT_NAME_REQUIRED');
    }

    const categoryId = input.categoryId ?? "uncategorized";
    const categoryDefault = input.requiresKitchen === undefined
      ? (await this.categoryRepository?.findById(categoryId))?.requiresKitchenByDefault
      : undefined;
    const now = new Date();
    const product: Product = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      name,
      categoryId,
      price: input.price ?? 0,
      stock: input.stock ?? 0,
      minStock: input.minStock ?? 0,
      active: input.active ?? true,
      trackStock: input.trackStock ?? true,
      requiresKitchen: input.isIngredient ? false : input.requiresKitchen ?? categoryDefault ?? false,
      lastUpdated: input.lastUpdated ?? now,
      createdAt: input.createdAt ?? now,
    };

    await this.getRepository().save(product);
    return product;
  }

  public async updateProduct(id: string, input: ProductInput): Promise<Product> {
    const existing = await this.getRepository().findById(id);
    if (!existing) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    const updated: Product = {
      ...existing,
      ...input,
      id,
      name: input.name.trim(),
      lastUpdated: new Date(),
    };

    await this.getRepository().update(updated);
    return updated;
  }

  public async deleteProduct(id: string): Promise<void> {
    if (!(await this.getRepository().exists(id))) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    await this.getRepository().delete(id);
  }

  public async increaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string,
    supplierId?: string,
    purchasePrice?: number,
    movementId?: string,
    branchId?: string | null
  ): Promise<void> {
    if (quantity === 0) return;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error("INVALID_STOCK_QUANTITY");
    }

    await this.applyStockChange({
      productId: id,
      quantity,
      reason,
      performedBy,
      supplierId,
      purchasePrice,
      movementId,
      branchId,
      lossCategory: undefined
    });
  }

  public async decreaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string,
    lossCategory?: LossCategory,
    movementId?: string,
    branchId?: string | null
  ): Promise<void> {
    if (quantity === 0) return;
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new Error("INVALID_STOCK_QUANTITY");
    }

    await this.applyStockChange({
      productId: id,
      quantity: -quantity,
      reason,
      performedBy,
      movementId,
      branchId,
      lossCategory
    });
  }

  private async applyStockChange(params: {
    productId: string;
    quantity: number;
    reason: string;
    performedBy?: string;
    supplierId?: string;
    purchasePrice?: number;
    movementId?: string;
    branchId?: string | null;
    lossCategory?: LossCategory;
  }): Promise<void> {
    const repository = this.getRepository();
    const product = await repository.findById(params.productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");
    if (product.trackStock === false) {
      throw new Error("PRODUCT_STOCK_TRACKING_DISABLED");
    }

    const movementId = params.movementId ?? crypto.randomUUID();
    const branchId = params.branchId ?? getCurrentBranchId() ?? undefined;
    const now = new Date();
    const extraFields: Record<string, unknown> = { lastUpdated: now.toISOString() };
    if (params.purchasePrice !== undefined) {
      if (!Number.isFinite(params.purchasePrice) || params.purchasePrice < 0) {
        throw new Error("PURCHASE_PRICE_INVALID");
      }
      extraFields.purchasePrice = params.purchasePrice;
      extraFields.lastPurchaseDate = now.toISOString();
    }
    if (params.supplierId) {
      extraFields.supplierId = params.supplierId;
    }

    const supplier = params.supplierId
      ? await this.supplierRepository?.findById(params.supplierId)
      : null;
    const type: InventoryMovement["type"] = params.quantity > 0 ? "INCREASE" : "DECREASE";
    const movement = {
      productId: params.productId,
      delta: params.quantity,
      reason: params.reason,
      type,
      performedBy: params.performedBy,
      supplierId: params.supplierId,
      supplierName: supplier?.name,
      lossCategory: params.lossCategory,
      movementId,
      branchId,
      allowNegative: companyConfigStore.get().allowNegativeStock,
      extraFields
    };

    if (repository.adjustStockWithKardex) {
      await repository.adjustStockWithKardex(movement);
      return;
    }

    const kardex = this.getKardex();
    if (await kardex.exists(movementId)) return;
    await repository.adjustStock(
      params.productId,
      params.quantity,
      extraFields,
      companyConfigStore.get().allowNegativeStock,
      branchId
    );
    await kardex.record(
      params.productId,
      Math.abs(params.quantity),
      type,
      params.reason,
      params.performedBy,
      params.supplierId,
      supplier?.name,
      params.lossCategory,
      movementId,
      product.name,
      branchId
    );
  }

  public async getLowStockProducts(): Promise<Product[]> {
    return (await this.listAll()).filter((product) => {
      if (product.active === false) return false;
      if (product.trackStock === false) return false;
      return (product.stock ?? 0) <= (product.minStock ?? 0);
    });
  }

  public async consumeForSale(
    items: SaleStockItem[],
    reason = "SALE",
    operationId?: string
  ): Promise<void> {
    const productById = await this.loadProductsForSale(items);
    const consumption = this.expandSaleConsumption(items, productById);
    await this.applySaleStockChanges(consumption, "DECREASE", reason, operationId);
  }

  public async restoreForSale(
    items: SaleStockItem[],
    reason = "SALE_RESTORE",
    operationId?: string
  ): Promise<void> {
    const productById = await this.loadProductsForSale(items);
    const consumption = this.expandSaleConsumption(items, productById);
    await this.applySaleStockChanges(consumption, "INCREASE", reason, operationId);
  }

  /**
   * Devuelve los productos REALES cuyo Kardex debe tener movimientos
   * asociados a una venta: la misma expansión que consumeForSale usa
   * para descontar stock (ingredientes de recetas, no el producto
   * padre que no maneja stock propio; excluye servicios con
   * trackStock=false). verifyInventoryTrail usa esto para no generar
   * falsos positivos en productos con receta.
   */
  public async resolveExpectedTrailTargets(
    items: SaleStockItem[]
  ): Promise<string[]> {
    const productById = await this.loadProductsForSale(items);
    const consumption = this.expandSaleConsumption(items, productById);
    return Array.from(consumption.keys());
  }

  private async loadProductsForSale(items: SaleStockItem[]): Promise<Map<string, Product>> {
    const repository = this.getRepository();
    const productById = new Map<string, Product>();
    const visited = new Set<string>();
    let pendingIds = new Set(items.map((item) => item.productId));

    while (pendingIds.size > 0) {
      const ids = Array.from(pendingIds).filter((id) => !visited.has(id));
      pendingIds = new Set();
      if (ids.length === 0) break;
      ids.forEach((id) => visited.add(id));

      const products = await repository.findMany(ids);
      for (const product of products) {
        productById.set(product.id, product);
        const saleItem = items.find((item) => item.productId === product.id);
        const recipe = this.resolveRecipe(product, saleItem);
        const usesRecipe = product.productionMode !== "BATCH" && recipe.length > 0;
        if (!usesRecipe) continue;

        for (const ingredient of recipe) {
          if (!visited.has(ingredient.productId)) pendingIds.add(ingredient.productId);
        }
      }
    }

    return productById;
  }

  private async applySaleStockChanges(
    consumption: Map<string, number>,
    direction: "DECREASE" | "INCREASE",
    reason: string,
    operationId?: string
  ): Promise<void> {
    const branchId = getCurrentBranchId() ?? undefined;
    const now = new Date().toISOString();
    const deltaSign = direction === "DECREASE" ? -1 : 1;
    const movements = Array.from(consumption, ([productId, quantity]) => ({
      productId,
      delta: quantity * deltaSign,
      reason,
      type: direction,
      branchId,
      extraFields: { lastUpdated: now }
    }));

    if (movements.length === 0) return;

    const repository = this.getRepository();
    if (repository.adjustStockBatchWithKardex) {
      await repository.adjustStockBatchWithKardex(
        operationId ?? crypto.randomUUID(),
        movements
      );
      return;
    }

    for (const movement of movements) {
      await this.applyStockChange({
        productId: movement.productId,
        quantity: movement.delta,
        reason: movement.reason,
        movementId: undefined,
        branchId: movement.branchId,
        lossCategory: undefined
      });
    }
  }

  private expandSaleConsumption(
    items: SaleStockItem[],
    productById: Map<string, Product>
  ): Map<string, number> {
    const consumption = new Map<string, number>();
    const expand = (productId: string, quantity: number, ancestors: Set<string>): void => {
      const product = productById.get(productId);
      if (!product) throw new Error("PRODUCT_NOT_FOUND");

      const recipe = this.resolveRecipe(product, items.find((item) => item.productId === productId));
      const usesRecipe = product.productionMode !== "BATCH" && recipe.length > 0;
      if (!usesRecipe) {
        if (product.trackStock === false && product.productionMode !== "BATCH") return;
        consumption.set(productId, (consumption.get(productId) ?? 0) + quantity);
        return;
      }

      if (ancestors.has(productId)) throw new Error("RECIPE_CYCLE");
      const nextAncestors = new Set(ancestors).add(productId);
      for (const ingredient of recipe) {
        expand(ingredient.productId, ingredient.quantity * quantity, nextAncestors);
      }
    };

    for (const item of items) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("INVALID_SALE_QUANTITY");
      }
      expand(item.productId, item.quantity, new Set());
    }
    return consumption;
  }

  private resolveRecipe(product: Product, item?: SaleStockItem): readonly RecipeItem[] {
    const baseRecipe = item?.selectedSize?.recipe?.length
      ? item.selectedSize.recipe
      : product.recipe ?? [];
    const extrasRecipe = item?.selectedExtras?.flatMap((extra) => extra.recipe ?? []) ?? [];
    if (extrasRecipe.length === 0) return baseRecipe;

    const merged = new Map<string, number>();
    for (const ingredient of [...baseRecipe, ...extrasRecipe]) {
      merged.set(ingredient.productId, (merged.get(ingredient.productId) ?? 0) + ingredient.quantity);
    }
    return Array.from(merged, ([productId, quantity]) => ({ productId, quantity }));
  }

  public async transferStock(
    productId: string,
    fromBranchId: string,
    toBranchId: string,
    quantity: number,
    operationId = crypto.randomUUID(),
    performedBy?: string
  ): Promise<void> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("INVALID_STOCK_QUANTITY");
    }
    if (!productId || !fromBranchId || !toBranchId || fromBranchId === toBranchId) {
      throw new Error("INVALID_BRANCH_STOCK_TRANSFER");
    }
    const repository = this.getRepository();
    if (!repository.transferStock) throw new Error("STOCK_TRANSFER_NOT_SUPPORTED");
    await repository.transferStock({
      operationId,
      productId,
      fromBranchId,
      toBranchId,
      quantity,
      performedBy
    });
  }

  public async produceBatch(
    productId: string,
    quantity: number,
    performedBy?: string,
    operationId = crypto.randomUUID()
  ): Promise<void> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("INVALID_PRODUCTION_QUANTITY");
    }
    if (!productId) throw new Error("PRODUCT_NOT_FOUND");
    const branchId = getCurrentBranchId();
    if (!branchId) throw new Error("BRANCH_CONTEXT_REQUIRED");

    const repository = this.getRepository();
    if (!repository.produceBatch) throw new Error("BATCH_PRODUCTION_NOT_SUPPORTED");
    await repository.produceBatch({
      operationId,
      productId,
      branchId,
      quantity,
      performedBy
    });
  }
}

export const inventoryEngine = new InventoryEngine();