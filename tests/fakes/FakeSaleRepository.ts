// tests/fakes/FakeSaleRepository.ts
import { Sale } from "../../src/core/entities/Entities";
import { InMemoryRepository } from "./InMemoryRepository";

/**
 * FakeSaleRepository
 * ---------------------------------------------------------------------------
 * InMemoryRepository<Sale> + `findByCustomer`, para poder probar
 * CustomerEngine y SalesEngine sin la función SQL real
 * `find_by_customer` (ver customer_purchase_history_migration.sql).
 */
export class FakeSaleRepository extends InMemoryRepository<Sale> {
  constructor() {
    super("sales");
  }

  public async findByCustomer(customerId: string): Promise<Sale[]> {
    const all = await this.findAll();
    return all.filter(s => s.customerId === customerId);
  }
}
