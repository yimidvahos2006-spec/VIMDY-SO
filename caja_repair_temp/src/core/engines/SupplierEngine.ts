import { Supplier, Product } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';

/* ===========================================================================
   SupplierEngine
   ---------------------------------------------------------------------------
   CRUD real de proveedores. Un producto puede referenciar un proveedor
   (Product.supplierId) para saber a quién comprarle cuando el stock baja
   del mínimo (ver InventoryEngine.getLowStockProducts, y más adelante
   Paso 6 - IA de compras).
=========================================================================== */
export class SupplierEngine {
  constructor(
    private readonly repository: IRepository<Supplier>,
    private readonly productRepository: IRepository<Product>
  ) {}

  public async listAll(): Promise<Supplier[]> {
    const suppliers = await this.repository.findAll();
    return suppliers.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async getById(id: string): Promise<Supplier | null> {
    return await this.repository.findById(id);
  }

  public async create(input: {
    name: string;
    phone?: string;
    email?: string;
    address?: string;
  }): Promise<Supplier> {
    const name = input.name.trim();

    if (!name) {
      throw new Error('SUPPLIER_NAME_REQUIRED');
    }

    const supplier: Supplier = {
      id: crypto.randomUUID(),
      name,
      phone: input.phone?.trim() || undefined,
      email: input.email?.trim() || undefined,
      address: input.address?.trim() || undefined,
      active: true,
      createdAt: new Date()
    };

    await this.repository.save(supplier);
    return supplier;
  }

  public async update(
    id: string,
    input: { name?: string; phone?: string; email?: string; address?: string; active?: boolean }
  ): Promise<Supplier> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error('SUPPLIER_NOT_FOUND');
    }

    let name = current.name;

    if (input.name !== undefined) {
      name = input.name.trim();

      if (!name) {
        throw new Error('SUPPLIER_NAME_REQUIRED');
      }
    }

    const updated: Supplier = {
      ...current,
      name,
      phone: input.phone !== undefined ? input.phone.trim() || undefined : current.phone,
      email: input.email !== undefined ? input.email.trim() || undefined : current.email,
      address: input.address !== undefined ? input.address.trim() || undefined : current.address,
      active: input.active !== undefined ? input.active : current.active
    };

    await this.repository.update(updated);
    return updated;
  }

  /** No se puede borrar un proveedor mientras algún producto lo esté usando. */
  public async delete(id: string): Promise<void> {
    const supplier = await this.repository.findById(id);

    if (!supplier) {
      throw new Error('SUPPLIER_NOT_FOUND');
    }

    const products = await this.productRepository.findAll();
    const inUse = products.some((p) => p.supplierId === id);

    if (inUse) {
      throw new Error('SUPPLIER_IN_USE');
    }

    await this.repository.delete(id);
  }
}