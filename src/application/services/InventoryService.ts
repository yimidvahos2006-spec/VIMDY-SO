// src/application/services/InventoryService.ts
import { InventoryEngine, ProductInput } from '../../core/engines/InventoryEngine';
import { Product } from '../../core/entities/Entities';

export class InventoryService {
  constructor(
    private readonly engine: InventoryEngine
  ) {}

  public async listAll(): Promise<Product[]> {
    return await this.engine.listAll();
  }

  public async search(query: string): Promise<Product[]> {
    return await this.engine.search(query);
  }

  public async createProduct(input: ProductInput, performedBy?: string): Promise<Product> {
    return await this.engine.createProduct(input, performedBy);
  }

  public async updateProduct(id: string, input: ProductInput): Promise<Product> {
    return await this.engine.updateProduct(id, input);
  }

  public async deleteProduct(id: string): Promise<void> {
    await this.engine.deleteProduct(id);
  }

  public async increaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string
  ): Promise<void> {
    await this.engine.increaseStock(
      id,
      quantity,
      reason,
      performedBy
    );
  }

  public async decreaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string
  ): Promise<void> {
    await this.engine.decreaseStock(
      id,
      quantity,
      reason,
      performedBy
    );
  }

  public async getLowStockProducts(): Promise<Product[]> {
    return await this.engine.getLowStockProducts();
  }
}