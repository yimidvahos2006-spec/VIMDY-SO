// src/core/engines/InventoryEngine.ts
import { Product, Supplier, Category, RecipeItem, LossCategory, ProductSizeOption, ProductExtraOption } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';
import { IProductRepository } from '../../infrastructure/di/repositories/IProductRepository';
import { KardexEngine } from './KardexEngine';
import { companyConfigStore } from '../store/companyConfigStore';
import { logError } from '../../infrastructure/logging/opsLogger';
import { getCurrentBranchId } from '../../infrastructure/supabase/supabaseClient';

/** Un item de venta (o devolución) sobre el que hay que mover inventario. */
export interface SaleStockItem {
  productId: string;
  quantity: number;
}

export function isCompatibleRecipeQuantity(unit: string | undefined, quantity: number): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) {
    return false;
  }

  const discreteUnits = new Set(["unidad", "servicio", "paquete", "caja"]);
  const ingredientUnit = (unit ?? "unidad").trim().toLowerCase();

  if (discreteUnits.has(ingredientUnit)) {
    return Number.isInteger(quantity);
  }

  return true;
}

/** Datos que el formulario de Productos puede enviar al crear/editar. */
export interface ProductInput {
  name: string;
  /** PASO 2 (rediseño formulario de producto): descripción libre y opcional (ver Product.description). */
  description?: string;
  categoryId: string;
  price: number;
  stock: number;
  minStock: number;
  barcode?: string;
  sku?: string;
  purchasePrice?: number;
  taxRate?: number;
  supplierId?: string;
  /** Proveedor alternativo, por si el principal falla o tarda (PASO 2.7 — Compras Inteligentes). */
  alternateSupplierId?: string;
  image?: string;
  unit?: string;
  active?: boolean;
  favorite?: boolean;
  aliases?: readonly string[];
  /** Receta/BOM: si viene con items, el producto es "elaborado" (ver Product.recipe). */
  recipe?: readonly RecipeItem[];
  /** BLOQUEANTE (auditoría Fase 2 — Panadería): ver Product.productionMode. Default 'ON_DEMAND'. */
  productionMode?: 'ON_DEMAND' | 'BATCH';
  /** Si el producto necesita preparación en cocina (ver Product.requiresKitchen). Default true. */
  requiresKitchen?: boolean;
  /** Minutos estimados de preparación (ver Product.estimatedPrepMinutes). */
  estimatedPrepMinutes?: number;
  /** Estación de impresión propia del producto (ver Product.printStationOverride). */
  printStationOverride?: string;
  /** PASO 9 (rediseño formulario de producto): variantes de tamaño (ver Product.sizes). */
  sizes?: readonly ProductSizeOption[];
  /** PASO 9 (rediseño formulario de producto): extras/adicionales (ver Product.extras). */
  extras?: readonly ProductExtraOption[];
  /** BLOQUEANTE #2 (auditoría Fase 2): ver Product.trackStock. `false` = producto tipo Servicio. */
  trackStock?: boolean;
  /** Marca explícita de productos usados solo como ingredientes del inventario. */
  isIngredient?: boolean;
}

export class InventoryEngine {
  constructor(
    private readonly repository: IProductRepository,
    private readonly kardex: KardexEngine,
    private readonly supplierRepository?: IRepository<Supplier>,
    /**
     * Paso 3.2 (Cocina): opcional para no romper a nadie que ya instancie
     * InventoryEngine sin este 4to argumento (ver tests/fakes). Si no se
     * inyecta, resolveRequiresKitchenDefault() simplemente cae al default
     * seguro (true), igual que el comportamiento de siempre.
     */
    private readonly categoryRepository?: IRepository<Category>
  ) {}

  public async listAll(): Promise<Product[]> {
    return await this.repository.findAll();
  }

  public async getById(id: string): Promise<Product | null> {
    return await this.repository.findById(id);
  }

  /**
   * Trae varios productos de una sola consulta (en vez de un findById en
   * fila por cada id). La usa SalesEngine.sendToKitchen para resolver, de
   * una vez, si cada item de la venta requiere cocina o no.
   */
  public async getMany(ids: string[]): Promise<Product[]> {
    const uniqueIds = Array.from(new Set(ids));
    if (uniqueIds.length === 0) return [];
    return await this.repository.findMany(uniqueIds);
  }

  public async getLowStockProducts(): Promise<Product[]> {
    const products = await this.repository.findAll();

    // BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
    // trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
    // Costilla) nace y se queda en stock 0 a propósito porque no maneja
    // stock propio. Sin este chequeo salía para siempre en "stock bajo"
    // (usado por el Gerente Inteligente, sugerencias de compra y el
    // dashboard de inventario) — mismo criterio que buildConsumptionTargets.
    return products.filter(
      product => product.trackStock !== false && product.stock <= product.minStock
    );
  }

  /**
   * Búsqueda real de productos por nombre, SKU, código de barras o
   * categoría. Usada por el buscador del módulo de Productos (y
   * reutilizable por Caja/Voz más adelante).
   */
  public async search(query: string): Promise<Product[]> {
    const value = query.trim().toLowerCase();
    const products = await this.repository.findAll();

    if (!value) {
      return products;
    }

    return products.filter((p) =>
      p.name.toLowerCase().includes(value) ||
      (p.sku ?? '').toLowerCase().includes(value) ||
      (p.barcode ?? '').toLowerCase().includes(value) ||
      p.categoryId.toLowerCase().includes(value)
    );
  }

  private async assertUnique(field: 'sku' | 'barcode', value: string | undefined, excludeId?: string) {
    if (!value) return;

    const products = await this.repository.findAll();
    const clash = products.some(
      (p) => p.id !== excludeId && (p[field] ?? '').toLowerCase() === value.toLowerCase()
    );

    if (clash) {
      throw new Error(field === 'sku' ? 'SKU_DUPLICADO' : 'BARCODE_DUPLICADO');
    }
  }

  private async assertUniqueName(name: string | undefined, excludeId?: string) {
    const trimmed = name?.trim();
    if (!trimmed) return;

    const products = await this.repository.findAll();
    const clash = products.some(
      (p) => p.id !== excludeId && p.name.trim().toLowerCase() === trimmed.toLowerCase()
    );

    if (clash) {
      throw new Error('NOMBRE_DUPLICADO');
    }
  }

  private async validate(input: ProductInput) {
    if (!input.name || !input.name.trim()) {
      throw new Error('NOMBRE_REQUERIDO');
    }

    if (!input.categoryId || !input.categoryId.trim()) {
      throw new Error('CATEGORIA_REQUERIDA');
    }

    if (input.price === undefined || input.price < 0) {
      throw new Error('PRECIO_INVALIDO');
    }

    if (input.stock === undefined || input.stock < 0) {
      throw new Error('STOCK_INVALIDO');
    }

    if (input.minStock === undefined || input.minStock < 0) {
      throw new Error('STOCK_MINIMO_INVALIDO');
    }

    if (input.purchasePrice !== undefined && input.purchasePrice < 0) {
      throw new Error('PRECIO_COMPRA_INVALIDO');
    }

    if (input.taxRate !== undefined && (input.taxRate < 0 || input.taxRate > 100)) {
      throw new Error('IVA_INVALIDO');
    }

    if (input.recipe && input.recipe.length > 0) {
      const allProducts = await this.repository.findAll();
      const ingredientMap = new Map(allProducts.map((p) => [p.id, p]));
      const seenIngredientIds = new Set<string>();

      for (const item of input.recipe) {
        const ingredient = item.productId ? ingredientMap.get(item.productId) : undefined;
        if (!ingredient) {
          throw new Error('INGREDIENTE_INEXISTENTE');
        }

        if (seenIngredientIds.has(item.productId)) {
          throw new Error('INGREDIENTE_DUPLICADO');
        }
        seenIngredientIds.add(item.productId);

        const quantity = Number(item.quantity);
        if (!Number.isFinite(quantity) || quantity <= 0) {
          throw new Error('INGREDIENTE_CANTIDAD_INVALIDA');
        }

        if (!isCompatibleRecipeQuantity(ingredient.unit, quantity)) {
          throw new Error(`La cantidad de "${ingredient.name}" debe ser un número entero porque se mide por unidad.`);
        }
      }
    }
  }

  /**
   * Paso 3.2 (Cocina): decide el `requiresKitchen` con el que nace un
   * producto NUEVO cuando el formulario/import no lo manda explícito.
   *
   * Prioridad:
   *   1. `explicitValue` — si el caller (formulario manual, edición) sí
   *      mandó el flag, esa es la fuente de verdad y no se toca.
   *   2. `category.requiresKitchenByDefault` — si no vino explícito, se
   *      hereda el default de la categoría del producto (ver Paso 3.1).
   *      Esto es lo que hace que el import de menú con IA (Paso 2.4, que
   *      nunca manda `requiresKitchen`) quede bien clasificado sin que el
   *      negocio tenga que corregir producto por producto.
   *   3. `true` — si no hay categoryRepository inyectado, o la categoría
   *      no existe/no tiene el campo seteado, cae al default histórico
   *      (mismo comportamiento que antes de este paso).
   */
  private async resolveRequiresKitchenDefault(
    categoryId: string,
    explicitValue: boolean | undefined
  ): Promise<boolean> {
    if (explicitValue !== undefined) {
      return explicitValue;
    }

    if (!this.categoryRepository) {
      return true;
    }

    const category = await this.categoryRepository.findById(categoryId);
    return category?.requiresKitchenByDefault ?? true;
  }

  /** Crea un producto nuevo. Este es el punto de entrada real del formulario "Nuevo producto". */
  public async createProduct(input: ProductInput, performedBy?: string): Promise<Product> {
    await this.validate(input);
    await this.assertUniqueName(input.name, undefined);
    await this.assertUnique('sku', input.sku);
    await this.assertUnique('barcode', input.barcode);

    const now = new Date();

    const requiresKitchen = await this.resolveRequiresKitchenDefault(
      input.categoryId,
      input.requiresKitchen
    );

    const effectiveRequiresKitchen = input.isIngredient ? false : requiresKitchen;
    const effectiveTrackStock = input.isIngredient ? true : (input.trackStock ?? true);

    const product: Product = {
      id: crypto.randomUUID(),
      name: input.name.trim(),
      description: input.description?.trim() || undefined,
      categoryId: input.categoryId,
      price: input.price,
      stock: input.stock,
      minStock: input.minStock,
      barcode: input.barcode?.trim() || undefined,
      sku: input.sku?.trim() || undefined,
      purchasePrice: input.purchasePrice,
      taxRate: input.taxRate,
      supplierId: input.supplierId || undefined,
      alternateSupplierId: input.alternateSupplierId || undefined,
      image: input.image || undefined,
      unit: input.unit?.trim() || undefined,
      active: input.active ?? true,
      favorite: input.favorite ?? false,
      aliases: input.aliases,
      recipe: input.recipe && input.recipe.length > 0 ? input.recipe : undefined,
      productionMode: input.productionMode ?? 'ON_DEMAND',
      requiresKitchen: effectiveRequiresKitchen,
      estimatedPrepMinutes: input.estimatedPrepMinutes,
      printStationOverride: input.printStationOverride?.trim() || undefined,
      sizes: input.sizes && input.sizes.length > 0 ? input.sizes : undefined,
      extras: input.extras && input.extras.length > 0 ? input.extras : undefined,
      trackStock: effectiveTrackStock,
      isIngredient: input.isIngredient ?? false,
      lastUpdated: now,
      createdAt: now
    };

    await this.repository.save(product);

    if (product.stock > 0) {
      await this.kardex.record(
        product.id,
        product.stock,
        'INCREASE',
        'Stock inicial (creación de producto)',
        performedBy,
        undefined,
        undefined,
        undefined,
        undefined,
        product.name
      );
    }

    return product;
  }

  /** Edita un producto existente. El stock NO se toca aquí: para eso están increaseStock/decreaseStock. */
  public async updateProduct(id: string, input: ProductInput): Promise<Product> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    await this.validate(input);
    await this.assertUniqueName(input.name, id);
    await this.assertUnique('sku', input.sku, id);
    await this.assertUnique('barcode', input.barcode, id);

    const updated: Product = {
      ...current,
      name: input.name.trim(),
      description:
        input.description !== undefined ? input.description.trim() || undefined : current.description,
      categoryId: input.categoryId,
      price: input.price,
      minStock: input.minStock,
      barcode: input.barcode?.trim() || undefined,
      sku: input.sku?.trim() || undefined,
      purchasePrice: input.purchasePrice,
      taxRate: input.taxRate,
      supplierId: input.supplierId || undefined,
      alternateSupplierId: input.alternateSupplierId || undefined,
      image: input.image || undefined,
      unit: input.unit?.trim() || undefined,
      active: input.active ?? current.active,
      favorite: input.favorite ?? current.favorite,
      aliases: input.aliases ?? current.aliases,
      // Un array vacío/ausente en el input SÍ debe poder borrar la receta
      // (el negocio decidió que el producto ya no es elaborado), por eso no
      // se usa "?? current.recipe" aquí: si input.recipe viene definido (aunque
      // sea []), gana; si viene undefined, se conserva la receta actual.
      recipe:
        input.recipe !== undefined
          ? input.recipe.length > 0
            ? input.recipe
            : undefined
          : current.recipe,
      productionMode: input.productionMode ?? current.productionMode ?? 'ON_DEMAND',
      requiresKitchen: input.isIngredient ? false : (input.requiresKitchen ?? current.requiresKitchen ?? true),
      estimatedPrepMinutes: input.estimatedPrepMinutes ?? current.estimatedPrepMinutes,
      printStationOverride:
        input.printStationOverride !== undefined
          ? input.printStationOverride.trim() || undefined
          : current.printStationOverride,
      // Mismo criterio que `recipe`: si input.sizes/extras viene definido
      // (aunque sea []), gana y puede borrar la lista; si viene undefined,
      // se conserva la lista actual del producto.
      sizes:
        input.sizes !== undefined ? (input.sizes.length > 0 ? input.sizes : undefined) : current.sizes,
      extras:
        input.extras !== undefined ? (input.extras.length > 0 ? input.extras : undefined) : current.extras,
      // BLOQUEANTE #2: el selector "Tipo de producto" del formulario
      // siempre manda este flag explícitamente (ver InventoryDashboard
      // handleSave), así que si viene definido gana; si no, se conserva
      // el actual (ej. ediciones desde otro flujo que no lo toca).
      trackStock: input.isIngredient ? true : (input.trackStock ?? current.trackStock ?? true),
      isIngredient: input.isIngredient ?? current.isIngredient ?? false,
      lastUpdated: new Date()
    };

    await this.repository.update(updated);
    return updated;
  }

  /**
   * Elimina o desactiva un producto según su riesgo. Si el producto tiene
   * dependencia de receta o historial de movimientos, se desactiva para
   * preservar trazabilidad. Solo se borra físicamente cuando no hay riesgo.
   */
  public async deleteProduct(id: string): Promise<void> {
    const current = await this.repository.findById(id);

    if (!current) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    const allProducts = await this.repository.findAll();
    const isUsedInRecipe = allProducts.some(
      (product) => product.id !== id && product.recipe?.some((item) => item.productId === id)
    );
    const hasInventoryHistory = (await this.kardex.getHistory(id)).length > 0;

    if (isUsedInRecipe) {
      throw new Error('PRODUCT_IN_USE');
    }

    if (hasInventoryHistory) {
      await this.repository.update({ ...current, active: false, lastUpdated: new Date() });
      return;
    }

    await this.repository.delete(id);
  }

  /**
   * @param supplierId Si la entrada viene de una compra a un proveedor, se guarda
   * en el Kardex y, si se indica purchasePrice, actualiza el "último precio de
   * compra" y la "última compra" del producto.
   */
  /**
   * @param movementId PASO 1.7 (Cola offline para escrituras) — ver nota
   * completa en KardexEngine.record(). Si se pasa y ya existe un
   * movimiento de Kardex con ese id, el ajuste de stock NO se repite (ya
   * se había aplicado en un intento de sincronización anterior); solo se
   * omite en silencio, sin lanzar error, porque el resultado deseado
   * ("el stock ya refleja este ajuste") ya está garantizado.
   */
  public async increaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string,
    supplierId?: string,
    purchasePrice?: number,
    movementId?: string,
    branchId?: string
  ): Promise<void> {
    if (movementId && (await this.kardex.exists(movementId))) {
      return;
    }

    const now = new Date();

    const product = await this.repository.findById(id);

    const extraFields: Record<string, unknown> = { lastUpdated: now.toISOString() };
    if (purchasePrice !== undefined) {
      const currentStock = product?.stock ?? 0;
      const currentCost = product?.purchasePrice;

      extraFields.purchasePrice =
        currentStock > 0 && currentCost !== undefined && quantity > 0
          ? (currentStock * currentCost + quantity * purchasePrice) / (currentStock + quantity)
          : purchasePrice;
    }
    if (supplierId) {
      extraFields.lastPurchaseDate = now.toISOString();
    }

    let supplierName: string | undefined;
    if (supplierId) {
      const supplier = await this.supplierRepository?.findById(supplierId);
      supplierName = supplier?.name;
    }

    await this.kardex.record(
      id,
      quantity,
      'INCREASE',
      reason,
      performedBy,
      supplierId,
      supplierName,
      undefined,
      movementId,
      product?.name,
      branchId
    );

    const updated = await this.repository.adjustStock(
      id,
      quantity,
      extraFields,
      companyConfigStore.get().allowNegativeStock,
      branchId
    );
  }

  /**
   * @param lossCategory Solo para salidas manuales desde Inventario (merma,
   * vencimiento, consumo interno, robo, error) — PASO 2, Centro de Pérdidas.
   * consumeForSale() nunca la pasa: una venta no es una pérdida.
   */
  /** @param movementId PASO 1.7 — ver nota en increaseStock() de arriba, mismo mecanismo. */
  public async decreaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string,
    lossCategory?: LossCategory,
    movementId?: string,
    branchId?: string
  ): Promise<void> {
    if (movementId && (await this.kardex.exists(movementId))) {
      return;
    }

    const product = await this.repository.findById(id);

    await this.kardex.record(
      id,
      quantity,
      'DECREASE',
      reason,
      performedBy,
      undefined,
      undefined,
      lossCategory,
      movementId,
      product?.name,
      branchId
    );

    const updated = await this.repository.adjustStock(
      id,
      -quantity,
      { lastUpdated: new Date().toISOString() },
      companyConfigStore.get().allowNegativeStock,
      branchId
    );
  }

  async transferStock(
    productId: string,
    fromBranchId: string,
    toBranchId: string,
    quantity: number,
    reason?: string,
    performedBy?: string
  ): Promise<void> {
    if (fromBranchId === toBranchId) {
      throw new Error('TRANSFER_SAME_BRANCH: la sucursal origen y destino deben ser distintas.');
    }

    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('INVALID_QUANTITY: la cantidad a transferir debe ser mayor que cero.');
    }

    const originProduct = await this.repository.findById(productId);
    if (!originProduct) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    const allowNegative = companyConfigStore.get().allowNegativeStock;
    const originStock = originProduct.stock ?? 0;
    if (!allowNegative && originStock < quantity) {
      throw new Error(
        `INSUFFICIENT_STOCK: disponible ${originStock} en sucursal origen, solicitado ${quantity}.`
      );
    }

    const sku = originProduct.sku?.trim();
    if (!sku) {
      throw new Error('PRODUCT_WITHOUT_SKU: para transferir entre sucursales el producto necesita un SKU (así se identifica como "el mismo producto" en la sucursal destino).');
    }

    let destProduct: Product | null = await this.repository.findBySkuAndBranch(sku, toBranchId);

    if (!destProduct) {
      const now = new Date();
      destProduct = {
        ...originProduct,
        id: crypto.randomUUID(),
        stock: 0,
        branchId: toBranchId,
        lastUpdated: now,
        createdAt: now,
        version: 1
      };
      await this.repository.save(destProduct);
    }

    const transferReason = reason ?? `Transferencia de sucursal ${fromBranchId} a ${toBranchId}`;

    await this.decreaseStock(
      originProduct.id,
      quantity,
      `Salida por transferencia: ${transferReason}`,
      performedBy,
      undefined,
      undefined,
      fromBranchId
    );

    try {
      await this.increaseStock(
        destProduct.id,
        quantity,
        `Entrada por transferencia: ${transferReason}`,
        performedBy,
        undefined,
        undefined,
        undefined,
        toBranchId
      );
    } catch (error) {
      await this.increaseStock(
        originProduct.id,
        quantity,
        `Reversión de transferencia fallida: ${transferReason}`,
        performedBy,
        undefined,
        undefined,
        undefined,
        fromBranchId
      );
      throw error;
    }
  }

  /**
   * Expande los items de una venta a los productos que realmente hay que
   * descontar del inventario: si un item tiene receta, se reemplaza por
   * sus ingredientes (cantidad_receta * cantidad_vendida); si no, se deja
   * igual. Consolida (suma) cuando dos items distintos de la venta
   * terminan afectando el mismo producto/ingrediente, para no calcular
   * el mismo stock dos veces por separado.
   */
  private buildConsumptionTargets(
    items: SaleStockItem[],
    reason: string,
    products: Map<string, Product>
  ): { productId: string; quantity: number; reason: string }[] {
    const targets = new Map<string, { quantity: number; recipeNames: Set<string> }>();

    for (const item of items) {
      const product = products.get(item.productId);

      // BLOQUEANTE (auditoría Fase 2 — Panadería): un producto con receta
      // en modo 'BATCH' (ej. Pan) ya descontó sus ingredientes UNA vez al
      // producir la tanda (ver produceBatch() más abajo) — no otra vez en
      // cada venta. Por eso solo entra a esta rama (descuento de
      // ingredientes en vivo) cuando productionMode !== 'BATCH', o sea el
      // caso de siempre: 'ON_DEMAND'/undefined, un producto "a la orden".
      if (product?.recipe && product.recipe.length > 0 && product.productionMode !== 'BATCH') {
        for (const ingredient of product.recipe) {
          const consumedQuantity = ingredient.quantity * item.quantity;
          const current = targets.get(ingredient.productId) ?? { quantity: 0, recipeNames: new Set<string>() };
          current.quantity += consumedQuantity;
          current.recipeNames.add(product.name);
          targets.set(ingredient.productId, current);
        }
      } else if (
        product?.trackStock !== false ||
        (product?.recipe && product.recipe.length > 0 && product.productionMode === 'BATCH')
      ) {
        const current = targets.get(item.productId) ?? { quantity: 0, recipeNames: new Set<string>() };
        current.quantity += item.quantity;
        targets.set(item.productId, current);
      }
      // BLOQUEANTE (bug reportado en video 2026-07-31): si product.trackStock
      // === false (Servicio, o Cocina sin receta que el negocio marcó como
      // "no maneja stock propio" — ej. Caldo de Costilla preparado al
      // momento) el item se omite por completo: no entra a `targets`, así
      // que no genera exigencia de stock ni descuento. Antes este `if`
      // no existía y CUALQUIER producto sin receta pasaba por la rama de
      // abajo tratado como inventario normal, aunque trackStock fuera
      // false — por eso quedaba con stock 0 para siempre y bloqueaba el
      // cobro. Los productos sin `trackStock` definido (undefined) siguen
      // comportándose como siempre (manejan stock), para no romper nada
      // ya creado.
      // Nota: un producto con receta en modo BATCH siempre debe manejar
      // stock propio, incluso si por algún dato legacy `trackStock` quedó
      // marcado como false.
    }

    return [...targets.entries()].map(([productId, data]) => ({
      productId,
      quantity: data.quantity,
      reason: data.recipeNames.size > 0 ? `${reason} (receta: ${[...data.recipeNames].join(", ")})` : reason
    }));
  }

  /**
   * Descuenta inventario por una venta, respetando recetas (BOM).
   * - Si el producto vendido tiene `recipe`, NO se toca su propio stock:
   *   se descuenta cada ingrediente en (cantidad_receta * cantidad_vendida).
   * - Si no tiene receta, se comporta igual que antes (producto simple).
   * Usado por SalesEngine.updateInventory() en vez de llamar decreaseStock
   * directamente, para que una Hamburguesa con receta sí baje pan/carne/queso.
   *
   * PASO 2.2 (Motor de Producción → Ventas) + Fase 1 (Blindar VIMDY):
   * el descuento de CADA producto/ingrediente ya es atómico de verdad a
   * nivel de base de datos (ver InventoryEngine.decreaseStock ->
   * adjustStock -> función adjust_product_stock en supabase/schema.sql):
   * la verificación de stock suficiente y el descuento ocurren en una sola
   * sentencia SQL con bloqueo de fila, así que dos ventas concurrentes ya
   * NO pueden leer el mismo stock disponible y sobrevender.
   *
   * Lo que SÍ sigue resolviéndose a nivel de aplicación (no hay una única
   * transacción SQL que abarque varias filas/productos a la vez) es el
   * caso de una receta con varios ingredientes: si el descuento atómico de
   * un ingrediente falla a mitad de camino (ej. Pan, después de que Carne
   * ya se descontó con éxito), no se puede dejar la venta a medias. Por
   * eso se revierte (increaseStock) todo lo ya descontado en ESTA misma
   * operación, en orden inverso, antes de relanzar el error: el inventario
   * nunca queda inconsistente entre ingredientes de una misma receta.
   */
  public async consumeForSale(
    items: SaleStockItem[],
    reason: string,
    performedBy?: string
  ): Promise<void> {
    const allProducts = await this.repository.findAll();
    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    const targets = this.buildConsumptionTargets(items, reason, productMap);

    // Verificación previa (solo para UX: rechazar rápido con un mensaje
    // agregado de TODO lo que falta, en vez de que el cajero vea errores
    // uno por uno). Esto NO es lo que garantiza que no haya sobreventa —
    // esa garantía la da el descuento atómico de más abajo — así que no
    // pasa nada si el stock cambia entre esta lectura y el descuento real.
    //
    // BLOQUEANTE #4 (auditoría Fase 2): si el negocio activó "Permitir
    // stock negativo", este pre-check se salta por completo — de lo
    // contrario seguiría bloqueando la venta acá mismo aunque el
    // descuento atómico de abajo (decreaseStock -> adjustStock) sí lo
    // fuera a permitir.
    const allowNegativeStock = companyConfigStore.get().allowNegativeStock;
    const insufficient: string[] = [];

    for (const target of targets) {
      const product = productMap.get(target.productId);

      if (!product) {
        insufficient.push(`Producto "${target.productId}" no encontrado en el inventario.`);
        continue;
      }

      if (!allowNegativeStock && product.stock < target.quantity) {
        insufficient.push(`"${product.name}": disponible ${product.stock}, requerido ${target.quantity}.`);
      }
    }

    if (insufficient.length > 0) {
      throw new Error(`INSUFFICIENT_STOCK: ${insufficient.join(" | ")}`);
    }

    /**
     * Descuento real: cada decreaseStock() de aquí abajo ya es atómico a
     * nivel de base de datos (ver comentario de consumeForSale más arriba).
     * Aun así, si el descuento de un ingrediente falla (p. ej. Pan, después
     * de que Carne ya se descontó con éxito), no se puede dejar la venta a
     * medias — por eso se revierte (increaseStock) todo lo ya descontado
     * en ESTA misma operación, en orden inverso, antes de relanzar el
     * error: el inventario nunca queda inconsistente entre ingredientes de
     * una misma receta, aunque no haya una única transacción SQL que
     * abarque todas las filas a la vez.
     */
    const applied: { productId: string; quantity: number }[] = [];

    const branchId = getCurrentBranchId();

    for (const target of targets) {
      try {
        await this.decreaseStock(target.productId, target.quantity, target.reason, performedBy, undefined, undefined, branchId);
        applied.push({ productId: target.productId, quantity: target.quantity });
      } catch (error) {
        for (const done of [...applied].reverse()) {
          try {
            await this.increaseStock(
              done.productId,
              done.quantity,
              `Reversión automática: falló el descuento de otro ingrediente de la misma venta (${reason})`,
              performedBy,
              undefined,
              undefined,
              undefined,
              branchId
            );
          } catch (rollbackError) {
            // Si hasta la reversión falla, no hay nada más que hacer desde
            // aquí — se deja constancia explícita en consola en vez de
            // tragarse un segundo error en silencio (eso sí dejaría el
            // inventario inconsistente de verdad).
            logError(rollbackError, {
              category: "inventory",
              context: { productId: done.productId, situation: "rollback_fallido_descuento_venta" }
            });
          }
        }

        const productName = productMap.get(target.productId)?.name ?? target.productId;
        throw new Error(
          `INSUFFICIENT_STOCK: No se pudo descontar "${productName}" (el stock cambió justo antes de confirmar). Se revirtió el resto de la venta — intenta cobrar de nuevo.`
        );
      }
    }
  }

  /**
   * Inverso de consumeForSale: repone inventario (cancelaciones, reembolsos).
   * Si el producto tenía receta, repone cada ingrediente; si no, repone el
   * producto mismo.
   */
  public async restoreForSale(
    items: SaleStockItem[],
    reason: string,
    performedBy?: string
  ): Promise<void> {
    for (const item of items) {
      const product = await this.repository.findById(item.productId);

      // BLOQUEANTE (auditoría Fase 2 — Panadería): espejo exacto de la
      // condición en buildConsumptionTargets — si el producto es 'BATCH',
      // consumeForSale nunca tocó sus ingredientes al venderlo (descontó
      // su stock propio), así que reponer ingredientes aquí estaría
      // inflando insumos que nunca se gastaron.
      if (product?.recipe && product.recipe.length > 0 && product.productionMode !== 'BATCH') {
        for (const ingredient of product.recipe) {
          const restoredQuantity = ingredient.quantity * item.quantity;
          await this.increaseStock(
            ingredient.productId,
            restoredQuantity,
            `${reason} (receta: ${product.name})`,
            performedBy,
            undefined,
            undefined,
            undefined,
            getCurrentBranchId()
          );
        }
      } else if (
        product?.trackStock !== false ||
        (product?.recipe && product.recipe.length > 0 && product.productionMode === 'BATCH')
      ) {
        // Simetría con buildConsumptionTargets: si trackStock === false,
        // consumeForSale nunca descontó este producto, así que reponerlo
        // aquí inflaría su stock sin motivo.
        // En cambio, un producto con receta BATCH maneja stock propio y se
        // debe restaurar incluso si `trackStock` quedó false por un caso
        // legacy/incorrecto.
        await this.increaseStock(item.productId, item.quantity, reason, performedBy, undefined, undefined, undefined, getCurrentBranchId());
      }
    }
  }

  /**
   * PASO 2 (auditoría Fase 2 — rama Panadería): "Producción" real — la
   * acción que faltaba entre Receta (RecipeEngine, solo lectura/cálculo) e
   * Inventario. Ejecuta UNA tanda de producción de un producto con receta
   * en modo `productionMode === 'BATCH'` (ej. "hoy horneé 40 panes"):
   *
   * 1. Descuenta cada ingrediente de la receta, en (cantidad_receta *
   *    cantidad_a_producir) — igual multiplicación que ya usa RecipeEngine
   *    para costo/capacidad, para no calcular dos veces con criterios
   *    distintos.
   * 2. Si todos los ingredientes se descontaron bien, suma `quantity` al
   *    stock PROPIO del producto elaborado (antes de esto, ese stock no
   *    se movía nunca — quedaba en 0 para siempre).
   *
   * Si un ingrediente falla a mitad de camino (stock cambió justo antes de
   * confirmar), revierte los que ya se habían descontado en ESTA tanda,
   * en orden inverso, antes de relanzar el error — mismo patrón que
   * consumeForSale(), para que una tanda nunca quede a medias.
   *
   * No se permite en productos 'ON_DEMAND': esos preparan al momento de
   * vender (ver consumeForSale), producir una tanda de ellos dejaría un
   * stock propio que el POS nunca va a leer ni descontar, y el negocio
   * pensaría que tiene unidades "listas" que en realidad no existen.
   */
  public async produceBatch(
    productId: string,
    quantity: number,
    performedBy?: string
  ): Promise<{ product: Product; consumed: { productId: string; name: string; quantity: number }[] }> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('INVALID_QUANTITY: la cantidad a producir debe ser mayor que cero.');
    }

    const allProducts = await this.repository.findAll();
    const productMap = new Map(allProducts.map((p) => [p.id, p]));
    const product = productMap.get(productId);

    if (!product) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    if (!product.recipe || product.recipe.length === 0) {
      throw new Error('PRODUCT_HAS_NO_RECIPE: este producto no tiene receta, no se puede producir por tanda.');
    }

    if (product.productionMode !== 'BATCH') {
      throw new Error(
        'NOT_BATCH_PRODUCT: este producto está configurado como "a la orden" (ON_DEMAND) — se prepara al vender, no por tandas. Cambia su modo de producción a "Por tanda" en el catálogo si de verdad se hornea/prepara con anticipación.'
      );
    }

    // Mismo pre-check de UX que consumeForSale: rechazar rápido con la
    // lista completa de lo que falta, en vez de un error a mitad de tanda.
    // No es lo que garantiza que no se sobreproduzca — eso lo da el
    // descuento atómico de abajo (decreaseStock -> adjustStock) — así que
    // no pasa nada si el stock cambia entre esta lectura y el descuento real.
    const allowNegativeStock = companyConfigStore.get().allowNegativeStock;
    const insufficient: string[] = [];
    const required: { productId: string; name: string; quantity: number }[] = [];

    for (const item of product.recipe) {
      const ingredient = productMap.get(item.productId);
      const neededQuantity = item.quantity * quantity;
      const name = ingredient?.name ?? 'Ingrediente eliminado';

      required.push({ productId: item.productId, name, quantity: neededQuantity });

      if (!ingredient) {
        insufficient.push(`"${name}" ya no existe en el inventario.`);
        continue;
      }

      if (!allowNegativeStock && ingredient.stock < neededQuantity) {
        insufficient.push(`"${name}": disponible ${ingredient.stock}, requerido ${neededQuantity}.`);
      }
    }

    if (insufficient.length > 0) {
      throw new Error(`INSUFFICIENT_STOCK: ${insufficient.join(' | ')}`);
    }

    const applied: { productId: string; quantity: number }[] = [];
    const branchId = getCurrentBranchId();

    for (const item of required) {
      try {
        await this.decreaseStock(
          item.productId,
          item.quantity,
          `Producción: ${quantity} x ${product.name}`,
          performedBy,
          undefined,
          undefined,
          branchId
        );
        applied.push({ productId: item.productId, quantity: item.quantity });
      } catch (error) {
        for (const done of [...applied].reverse()) {
          try {
            await this.increaseStock(
              done.productId,
              done.quantity,
              `Reversión automática: falló el descuento de otro ingrediente de la misma tanda (Producción: ${product.name})`,
              performedBy,
              undefined,
              undefined,
              undefined,
              branchId
            );
          } catch (rollbackError) {
            logError(rollbackError, {
              category: "inventory",
              context: { productId: done.productId, situation: "rollback_fallido_tanda_produccion" }
            });
          }
        }

        throw new Error(
          `INSUFFICIENT_STOCK: No se pudo descontar "${item.name}" (el stock cambió justo antes de confirmar). Se revirtió el resto de la tanda — intenta producir de nuevo.`
        );
      }
    }

    await this.increaseStock(
      productId,
      quantity,
      `Producción: ${quantity} unidades preparadas`,
      performedBy,
      undefined,
      undefined,
      undefined,
      branchId
    );

    const updated = await this.repository.findById(productId);
    if (!updated) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    return { product: updated, consumed: required };
  }
}