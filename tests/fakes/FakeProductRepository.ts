// tests/fakes/FakeProductRepository.ts
import { InventoryMovement, Product } from "../../src/core/entities/Entities";
import { IProductRepository } from "../../src/infrastructure/di/repositories/IProductRepository";
import { InMemoryRepository } from "./InMemoryRepository";
import { companyConfigStore } from "../../src/core/store/companyConfigStore";

/**
 * FakeProductRepository
 * ---------------------------------------------------------------------------
 * InMemoryRepository<Product> + `adjustStock`, para poder probar
 * InventoryEngine/SalesEngine sin la función SQL atómica real
 * `adjust_product_stock` (ver IProductRepository.ts). Aplica las mismas
 * reglas de negocio que esa función: no permite vender más de lo que hay
 * en stock, y lanza los mismos códigos de error que el repositorio real
 * para que un test que espera `INSUFFICIENT_STOCK` se comporte igual en
 * memoria que contra Supabase.
 */
export class FakeProductRepository
  extends InMemoryRepository<Product>
  implements IProductRepository
{
  /**
   * @param movementLog Repositorio donde `produceBatch` escribe el Kardex.
   * En producción esa escritura la hace el RPC `produce_batch_atomic`
   * (vía `apply_inventory_operation_delta`), no el engine. Se inyecta para
   * que los tests lean el Kardex que el RPC real dejaría.
   */
  constructor(private readonly movementLog?: InMemoryRepository<InventoryMovement>) {
    super("products");
  }

  private async logProductionMovement(
    product: Product,
    quantity: number,
    type: "INCREASE" | "DECREASE",
    reason: "PRODUCTION_CONSUMPTION" | "BATCH_PRODUCTION",
    operationId: string,
    performedBy?: string
  ): Promise<void> {
    if (!this.movementLog) return;

    // Mismos campos que escribe apply_inventory_operation_delta: sin
    // stockBefore/stockAfter y con `reason` fijo (sin referencia de tanda).
    await this.movementLog.save({
      id: crypto.randomUUID(),
      productId: product.id,
      productName: product.name,
      quantity: Math.abs(quantity),
      date: new Date(),
      type,
      reason,
      performedBy: performedBy ?? "Sistema",
      branchId: product.branchId,
      operationId
    } as InventoryMovement);
  }

  public async adjustStock(
    id: string,
    delta: number,
    extraFields: Record<string, unknown> = {},
    allowNegative: boolean = false
  ): Promise<Product> {
    const current = await this.findById(id);

    if (!current) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const newStock = current.stock + delta;

    if (delta < 0 && newStock < 0 && !allowNegative) {
      throw new Error("INSUFFICIENT_STOCK");
    }

    const updated: Product = {
      ...current,
      ...extraFields,
      stock: newStock
    };

    await this.update(updated);

    return updated;
  }

  public async findBySkuAndBranch(sku: string, branchId: string): Promise<Product | null> {
    const all = await this.all();
    return all.find((p) => p.sku === sku && p.branchId === branchId) ?? null;
  }

  public async transferStock(input: {
    operationId: string;
    productId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]> {
    const all = await this.all();
    const fromProduct = all.find((p) => p.id === input.productId && p.branchId === input.fromBranchId);
    const toProduct = all.find((p) => p.sku === fromProduct?.sku && p.branchId === input.toBranchId) ??
      (fromProduct ? { ...fromProduct, id: undefined as any, branchId: input.toBranchId, stock: 0 } : null);

    if (!fromProduct) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    const updatedFrom = await this.adjustStock(fromProduct.id, -input.quantity);

    if (!toProduct || !toProduct.id) {
      const newDest: Product = {
        ...fromProduct,
        id: crypto.randomUUID(),
        branchId: input.toBranchId,
        stock: input.quantity,
        lastUpdated: new Date(),
        createdAt: new Date(),
      };
      await this.save(newDest);
      return [updatedFrom, newDest];
    } else {
      const updatedDest = await this.adjustStock(toProduct.id, input.quantity);
      return [updatedFrom, updatedDest];
    }
  }

   public async produceBatch(input: {
    operationId: string;
    productId: string;
    branchId: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]> {
    const product = await this.findById(input.productId);
    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    if (product.productionMode !== "BATCH") {
      throw new Error("NOT_BATCH_PRODUCT");
    }

    const recipe = product.recipe ?? [];
    if (recipe.length === 0) {
      throw new Error("NO_RECIPE");
    }

    const allowNegative = companyConfigStore.get().allowNegativeStock;

    const ingredientIds = recipe.map((r) => r.productId);
    const ingredients = await this.findMany(ingredientIds);
    const ingredientMap = new Map(ingredients.map((i) => [i.id, i]));

    const consumptionPlan: Array<{ productId: string; totalNeeded: number }> = [];

    for (const item of recipe) {
      const ingredient = ingredientMap.get(item.productId);
      if (!ingredient) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      const totalNeeded = item.quantity * input.quantity;

      if (ingredient.stock < totalNeeded && !allowNegative) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      consumptionPlan.push({ productId: item.productId, totalNeeded });
    }

    const results: Product[] = [];

    for (const { productId: ingId, totalNeeded } of consumptionPlan) {
      const updated = await this.adjustStock(ingId, -totalNeeded, {}, allowNegative);
      results.push(updated);
      await this.logProductionMovement(
        updated, totalNeeded, "DECREASE", "PRODUCTION_CONSUMPTION", input.operationId, input.performedBy
      );
    }

    const updatedProduct: Product = {
      ...product,
      stock: product.stock + input.quantity,
      lastUpdated: new Date(),
    };
    await this.update(updatedProduct);
    results.push(updatedProduct);
    await this.logProductionMovement(
      updatedProduct, input.quantity, "INCREASE", "BATCH_PRODUCTION", input.operationId, input.performedBy
    );

    return results;
  }
}