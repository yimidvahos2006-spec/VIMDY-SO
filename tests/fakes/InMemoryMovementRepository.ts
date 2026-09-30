import { InventoryMovement } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "./InMemoryRepository";

export class InMemoryMovementRepository extends InMemoryRepository<InventoryMovement> {
  public async findByProduct(productId: string): Promise<InventoryMovement[]> {
    const all = await this.findAll();
    return all.filter((m) => m.productId === productId);
  }
}
