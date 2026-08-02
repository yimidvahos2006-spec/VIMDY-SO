import { Category, Product } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { isDuplicateNameError } from '../errors/DuplicateNameError';

/* ===========================================================================
   CategoryEngine
   ---------------------------------------------------------------------------
   Antes, la "categoría" de un producto era solo un string libre
   (Product.categoryId) sin catálogo propio: cada quien la escribía como
   quisiera y no había forma de listarlas, renombrarlas o borrarlas de
   forma segura. Este motor convierte las categorías en una entidad real
   y persistente, base del módulo de Productos.
=========================================================================== */
export class CategoryEngine {
  constructor(
    private readonly repository: IRepository<Category>,
    private readonly productRepository: IRepository<Product>
  ) {}

  public async listAll(): Promise<Category[]> {
    const categories = await this.repository.findAll();
    return categories.sort((a, b) => a.name.localeCompare(b.name));
  }

  public async getById(id: string): Promise<Category | null> {
    return await this.repository.findById(id);
  }

  public async create(input: {
    name: string;
    description?: string;
    requiresKitchenByDefault?: boolean;
    printStation?: string;
  }): Promise<Category> {
    const name = input.name.trim();

    if (!name) {
      throw new Error('CATEGORY_NAME_REQUIRED');
    }

    const existing = await this.repository.findAll();
    const duplicate = existing.some(
      (c) => c.name.trim().toLowerCase() === name.toLowerCase()
    );

    if (duplicate) {
      throw new Error('CATEGORY_NAME_DUPLICATE');
    }

    const category: Category = {
      id: crypto.randomUUID(),
      name,
      description: input.description?.trim() || undefined,
      active: true,
      createdAt: new Date(),
      // Paso 3.1: default true (igual que Product.requiresKitchen) si el
      // formulario no dice nada — así una categoría creada sin tocar este
      // campo se comporta como siempre se comportó antes de que existiera.
      requiresKitchenByDefault: input.requiresKitchenByDefault ?? true,
      printStation: input.printStation?.trim() || undefined
    };

    await this.saveCategory(category);
    return category;
  }

  /**
   * Guarda la categoría atrapando el choque real de base de datos (índice
   * único, ver categories_dedupe_migration.sql). La revisión de arriba
   * (`existing.some(...)`) solo mira el caché local en ese instante — en
   * un negocio con más de un dispositivo/pestaña, dos creaciones casi
   * simultáneas pueden pasar esa revisión igual (ninguna ve todavía la
   * categoría que está creando la otra) y de ahí salen los duplicados
   * (ej. dos "Entradas"). Este catch es lo que de verdad lo impide: si la
   * base de datos rechaza el guardado por nombre repetido, se traduce al
   * mismo "CATEGORY_NAME_DUPLICATE" que ya sabe mostrar la UI, en vez de
   * dejar pasar un error genérico de guardado.
   */
  private async saveCategory(category: Category): Promise<void> {
    try {
      await this.repository.save(category);
    } catch (err) {
      if (isDuplicateNameError(err)) {
        throw new Error('CATEGORY_NAME_DUPLICATE');
      }
      throw err;
    }
  }

  public async update(
    id: string,
    input: {
      name?: string;
      description?: string;
      active?: boolean;
      requiresKitchenByDefault?: boolean;
      printStation?: string;
    }
  ): Promise<Category> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error('CATEGORY_NOT_FOUND');
    }

    let name = current.name;

    if (input.name !== undefined) {
      name = input.name.trim();

      if (!name) {
        throw new Error('CATEGORY_NAME_REQUIRED');
      }

      const existing = await this.repository.findAll();
      const duplicate = existing.some(
        (c) => c.id !== id && c.name.trim().toLowerCase() === name.toLowerCase()
      );

      if (duplicate) {
        throw new Error('CATEGORY_NAME_DUPLICATE');
      }
    }

    const updated: Category = {
      ...current,
      name,
      description:
        input.description !== undefined ? input.description.trim() || undefined : current.description,
      active: input.active !== undefined ? input.active : current.active,
      requiresKitchenByDefault:
        input.requiresKitchenByDefault !== undefined
          ? input.requiresKitchenByDefault
          : current.requiresKitchenByDefault,
      printStation:
        input.printStation !== undefined ? input.printStation.trim() || undefined : current.printStation
    };

    try {
      await this.repository.update(updated);
    } catch (err) {
      if (isDuplicateNameError(err)) {
        throw new Error('CATEGORY_NAME_DUPLICATE');
      }
      throw err;
    }
    return updated;
  }

  /** No se puede borrar una categoría mientras algún producto la esté usando. */
  public async delete(id: string): Promise<void> {
    const category = await this.repository.findById(id);

    if (!category) {
      throw new Error('CATEGORY_NOT_FOUND');
    }

    const products = await this.productRepository.findAll();
    const inUse = products.some((p) => p.categoryId === id);

    if (inUse) {
      throw new Error('CATEGORY_IN_USE');
    }

    await this.repository.delete(id);
  }
}