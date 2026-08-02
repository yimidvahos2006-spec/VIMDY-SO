// tests/fakes/FakeProductRepository.ts
import { Product } from "../../src/core/entities/Entities";
import { IProductRepository } from "../../src/infrastructure/di/repositories/IProductRepository";
import { InMemoryRepository } from "./InMemoryRepository";

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
  constructor() {
    super("products");
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
}