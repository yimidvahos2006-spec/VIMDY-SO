import type {
  Category,
  InventoryMovement,
  IsoDateString,
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
import { getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { INVENTORY_AUDIT_ACTIONS, INVENTORY_AUDIT_MODULE } from "../utils/inventoryFeed";
import { isIsoDateString } from "../utils/isoDate";

/** Lo mínimo que InventoryEngine necesita del registro de auditoría (AuditEngine lo cumple). */
export interface InventoryAuditSink {
  log(actorId: string, action: string, module: string, description: string, entityId?: string): Promise<unknown>;
}

const money = (value: number | undefined): string =>
  value === undefined ? "sin dato" : `$${value.toLocaleString("es-CO")}`;

export type ProductInput = Partial<Product> & { name: string };

export interface BatchFailure {
  /** Posición de la fila dentro de la lista enviada (0 = primera). */
  index: number;
  name: string;
  error: string;
}

export interface BatchCreateResult {
  created: Product[];
  failed: BatchFailure[];
}

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
    private readonly categoryRepository?: IRepository<Category>,
    private readonly audit?: InventoryAuditSink
  ) {}

  /**
   * Deja constancia en "Últimos movimientos" de algo que pasó en el catálogo
   * (crear, editar, eliminar, importar...). Es un rastro: si falla, la
   * operación ya hecha NO se deshace ni se interrumpe.
   */
  private async note(action: string, description: string, entityId?: string, actor?: string): Promise<void> {
    if (!this.audit) return;
    try {
      await this.audit.log(actor ?? "Sistema", action, INVENTORY_AUDIT_MODULE, description, entityId);
    } catch {
      /* el rastro nunca debe tumbar la operación */
    }
  }

  /**
   * Los insumos (materia prima) solo existen para alimentar recetas: no se
   * venden sueltos, así que no llevan código de barras. (El precio de venta se
   * deja en 0 DESPUÉS de validar, para que un precio inválido se siga rechazando.)
   */
  private static withoutDirectSaleFields(input: ProductInput): ProductInput {
    if (input.isIngredient !== true) return input;
    return { ...input, barcode: undefined };
  }

  private kindWord(product: Pick<Product, "isIngredient">): string {
    return product.isIngredient === true ? "insumo" : "producto";
  }

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

  /**
   * Lista completa para DECIDIR (no para pintar): validar nombre duplicado,
   * saber si un producto es ingrediente de una receta, eliminar todos.
   * `listAll()` responde con la caché al instante y puede traer unos segundos
   * de atraso; aquí se espera al servidor (con tope) cuando el repositorio lo ofrece.
   */
  private async listForCatalogDecision(): Promise<Product[]> {
    const repository = this.getRepository();
    return repository.findAllPreferFresh ? repository.findAllPreferFresh() : repository.findAll();
  }

  /**
   * Catálogo leído DIRECTO de la base de datos en este instante (nunca del caché
   * local). Lanza error si el servidor no responde. Úsalo siempre que el stock
   * leído se convierta en una "foto" para calcular diferencias (ej. conteo de
   * inventario); `listAll()` es solo para pintar pantallas y puede venir del caché.
   */
  public async listAllAuthoritative(): Promise<Product[]> {
    return this.getRepository().findAllAuthoritative();
  }

  /**
   * Recarga el catálogo desde el servidor y reemplaza el caché local. Úsalo cuando
   * cambia lo que el servidor le entrega a esta persona (ej. al abrir un conteo a
   * ciegas su stock llega enmascarado y el caché anterior tendría cifras reales).
   * Lanza error si el servidor no responde.
   */
  public async reloadFromServer(): Promise<Product[]> {
    return this.getRepository().reloadCatalogFromServer();
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

   /** Para comparar nombres sin importar mayúsculas, tildes ni espacios de más ("Café" = " cafe "). */
  private static normalizeName(value: string): string {
    return value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  /**
   * Reglas que valen SIEMPRE, sin importar desde qué pantalla se guarde
   * (formulario, importación con IA, onboarding...): antes solo las revisaba
   * la pantalla y el motor aceptaba cualquier cosa.
   * `selfId` = el producto que se está editando (para no chocar consigo mismo).
   */
  private async validateProductInput(input: ProductInput, selfId?: string, preloaded?: Product[]): Promise<void> {
    const isNumberOrUndefined = (v: unknown) => v === undefined || v === null || (typeof v === "number" && Number.isFinite(v));

    if (!isNumberOrUndefined(input.price) || (input.price ?? 0) < 0) {
      throw new Error("PRECIO_INVALIDO");
    }
    if (!isNumberOrUndefined(input.purchasePrice) || (input.purchasePrice ?? 0) < 0) {
      throw new Error("El costo no puede ser negativo ni inválido.");
    }
    if (!isNumberOrUndefined(input.minStock) || (input.minStock ?? 0) < 0) {
      throw new Error("El stock mínimo no puede ser negativo ni inválido.");
    }
    if (!isNumberOrUndefined(input.taxRate) || (input.taxRate ?? 0) < 0 || (input.taxRate ?? 0) > 100) {
      throw new Error("El IVA debe estar entre 0 y 100.");
    }
    if (selfId === undefined && (!isNumberOrUndefined(input.stock) || (input.stock ?? 0) < 0)) {
      throw new Error("El stock inicial no puede ser negativo ni inválido.");
    }

    const all = preloaded ?? (await this.listForCatalogDecision());
    const wantedName = InventoryEngine.normalizeName(input.name);
    const wantsIngredient = input.isIngredient === true;
    const nameTaken = all.some(
      (p) =>
        p.id !== selfId &&
        p.active !== false &&
        (p.isIngredient === true) === wantsIngredient &&
        InventoryEngine.normalizeName(p.name) === wantedName
    );
    if (nameTaken) {
      throw new Error("NOMBRE_DUPLICADO");
    }

    // El código de barras es único por negocio/sucursal (índice en la base de datos, incluye productos
    // inactivos e insumos). Se avisa aquí con un mensaje claro en vez de esperar el rechazo de la base.
    const wantedBarcode = !wantsIngredient && typeof input.barcode === "string" ? input.barcode.trim() : "";
    if (wantedBarcode && all.some((p) => p.id !== selfId && (p.barcode ?? "").trim() === wantedBarcode)) {
      throw new Error("BARCODE_DUPLICADO");
    }

    if (input.recipe && input.recipe.length > 0) {
      const byId = new Map(all.map((p) => [p.id, p]));
      const seen = new Set<string>();
      for (const item of input.recipe) {
        if (seen.has(item.productId)) {
          throw new Error("INGREDIENTE_DUPLICADO");
        }
        seen.add(item.productId);
        if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
          throw new Error("INGREDIENTE_CANTIDAD_INVALIDA");
        }
        if (selfId !== undefined && item.productId === selfId) {
          throw new Error("Un producto no puede usarse a sí mismo en su receta.");
        }
        const ingredient = byId.get(item.productId);
        if (!ingredient) {
          throw new Error("INGREDIENTE_INEXISTENTE");
        }
      }
    }
  }

  /**
   * `options.knownProducts`: catálogo que la pantalla ya tiene cargado. Evita
   * volver a bajar TODO el catálogo (con sus fotos) solo para revisar nombres
   * repetidos; el llamador responde de que esté razonablemente fresco.
   * `options.deferAudit`: no espera el registro de "Últimos movimientos" (es un
   * rastro que nunca falla la operación) para devolver el producto creado.
   */
  public async createProduct(
    input: ProductInput,
    performedBy?: string,
    options?: { knownProducts?: Product[]; deferAudit?: boolean }
  ): Promise<Product> {
    const name = input.name.trim();
    if (!name) {
      throw new Error('PRODUCT_NAME_REQUIRED');
    }

    // Un insumo no se vende suelto: nunca lleva código de barras ni precio de venta.
    input = InventoryEngine.withoutDirectSaleFields(input);

    // Todas las reglas (nombre repetido, precios, receta...) en un solo lugar.
    await this.validateProductInput(input, undefined, options?.knownProducts);

    const categoryId = input.categoryId ?? "uncategorized";
    // Un insumo nunca va a cocina (se fuerza false más abajo): no hace falta
    // consultar la categoría, que era un viaje de red de más.
    const categoryDefault = input.requiresKitchen === undefined && input.isIngredient !== true
      ? (await this.categoryRepository?.findById(categoryId))?.requiresKitchenByDefault
      : undefined;
    const now = new Date();
    const product: Product = {
      ...input,
      id: input.id ?? crypto.randomUUID(),
      name,
      categoryId,
      price: input.isIngredient === true ? 0 : (input.price ?? 0),
      stock: input.stock ?? 0,
      minStock: input.minStock ?? 0,
      active: input.active ?? true,
      trackStock: input.isIngredient ? true : (input.trackStock ?? true),
      requiresKitchen: input.isIngredient ? false : (input.requiresKitchen ?? categoryDefault ?? false),
      isIngredient: input.isIngredient ?? false,
      lastUpdated: input.lastUpdated ?? now,
      createdAt: input.createdAt ?? now,
    };

     const repository = this.getRepository();
     const branchId = getCurrentBranchId() ?? undefined;

     // El kardex (inventory_movements) es de SOLO LECTURA para el navegador:
     // las escrituras van por funciones del servidor (ver migración
     // 20261005000000). Por eso, si el repositorio lo soporta, el producto se
     // guarda con stock 0 y el stock inicial se aplica con el RPC atómico, que
     // actualiza el stock Y escribe el movimiento "Stock inicial" juntos.
     if (product.stock > 0 && repository.adjustStockWithKardex) {
       const initialStock = product.stock;
       await repository.save({ ...product, stock: 0 });
       try {
         const updated = await repository.adjustStockWithKardex({
           productId: product.id,
           delta: initialStock,
           reason: "Stock inicial",
           type: "INCREASE",
           performedBy: performedBy ?? undefined,
           movementId: crypto.randomUUID(),
           branchId,
           allowNegative: false
         });
         const noted = this.note(INVENTORY_AUDIT_ACTIONS.created, `Creaste el ${this.kindWord(product)} "${product.name}"`, product.id, performedBy);
         if (!options?.deferAudit) await noted;
         return { ...product, ...updated, stock: updated?.stock ?? initialStock };
       } catch (error) {
         // No dejar un producto a medias (sin stock ni historial): se deshace
         // para que el usuario pueda reintentar sin chocar con "nombre duplicado".
         try {
           await repository.delete(product.id);
         } catch {
           /* si el rollback falla, el error original es el importante */
         }
         throw error;
       }
     }

     await repository.save(product);

     if (product.stock > 0) {
       await this.getKardex().record(
         product.id,
         product.stock,
         "INCREASE",
         "Stock inicial",
         performedBy ?? undefined,
         undefined,
         undefined,
         undefined,
         undefined,
         undefined,
         branchId,
         0,
         product.stock
       );
     }

     const noted = this.note(INVENTORY_AUDIT_ACTIONS.created, `Creaste el ${this.kindWord(product)} "${product.name}"`, product.id, performedBy);
     if (!options?.deferAudit) await noted;
     return product;
  }

  /**
   * Crea muchos productos de una vez (importación CSV). Usa las MISMAS reglas
   * que `createProduct` (validateProductInput), pero carga el catálogo UNA vez
   * y guarda por lotes: productos con `saveMany` y stock inicial con el RPC
   * atómico por lotes (kardex "Stock inicial"). Nunca lanza por una fila mala:
   * devuelve qué se creó y qué falló, con el motivo.
   */
  public async createProductsBatch(
    inputs: ProductInput[],
    performedBy?: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<BatchCreateResult> {
    const repository = this.getRepository();
    const failed: BatchFailure[] = [];
    const working: Product[] = [...(await this.listForCatalogDecision())];
    const accepted: Array<{ index: number; product: Product }> = [];
    const now = new Date();

    for (let index = 0; index < inputs.length; index += 1) {
      const input = inputs[index];
      const name = (input.name ?? "").trim();
      try {
        if (!name) throw new Error("PRODUCT_NAME_REQUIRED");
        await this.validateProductInput({ ...input, name }, undefined, working);
        const product: Product = {
          ...input,
          id: input.id ?? crypto.randomUUID(),
          name,
          categoryId: input.categoryId ?? "uncategorized",
          price: input.price ?? 0,
          stock: input.stock ?? 0,
          minStock: input.minStock ?? 0,
          active: input.active ?? true,
          trackStock: input.isIngredient ? true : (input.trackStock ?? true),
          requiresKitchen: input.isIngredient ? false : (input.requiresKitchen ?? false),
          isIngredient: input.isIngredient ?? false,
          lastUpdated: now,
          createdAt: now
        };
        accepted.push({ index, product });
        // Para que dos filas con el mismo nombre dentro del lote se detecten entre sí.
        working.push(product);
      } catch (error) {
        failed.push({ index, name, error: error instanceof Error ? error.message : String(error) });
      }
    }

    const created: Product[] = [];
    const total = accepted.length;
    const SAVE_CHUNK = 100;
    const STOCK_CHUNK = 200;
    const branchId = getCurrentBranchId() ?? undefined;
    let done = 0;

    for (let start = 0; start < accepted.length; start += SAVE_CHUNK) {
      const chunk = accepted.slice(start, start + SAVE_CHUNK);

      // 1) Productos (con stock 0: el stock inicial va por el RPC, que escribe el kardex).
      try {
        await repository.saveMany(chunk.map(({ product }) => ({ ...product, stock: 0 })));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        chunk.forEach(({ index, product }) => failed.push({ index, name: product.name, error: message }));
        done += chunk.length;
        onProgress?.(done, total);
        continue;
      }

      // 2) Stock inicial con kardex, en lotes.
      const withStock = chunk.filter(({ product }) => product.stock > 0);
      const stockFailed = new Map<string, string>();
      for (let s = 0; s < withStock.length; s += STOCK_CHUNK) {
        const part = withStock.slice(s, s + STOCK_CHUNK);
        try {
          if (repository.adjustStockBatchWithKardex) {
            await repository.adjustStockBatchWithKardex(
              crypto.randomUUID(),
              part.map(({ product }) => ({
                productId: product.id,
                delta: product.stock,
                reason: "Stock inicial",
                type: "INCREASE" as const,
                branchId
              }))
            );
          } else if (repository.adjustStockWithKardex) {
            for (const { product } of part) {
              await repository.adjustStockWithKardex({
                productId: product.id,
                delta: product.stock,
                reason: "Stock inicial",
                type: "INCREASE",
                performedBy: performedBy ?? undefined,
                movementId: crypto.randomUUID(),
                branchId,
                allowNegative: false
              });
            }
          } else {
            throw new Error("INVENTORY_KARDEX_REQUIRED");
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          // No dejar productos a medias (sin stock ni historial): se deshacen para poder reintentar.
          for (const { product } of part) {
            try {
              await repository.delete(product.id);
            } catch {
              /* si el rollback falla, el error original es el importante */
            }
            stockFailed.set(product.id, message);
          }
        }
      }

      for (const { index, product } of chunk) {
        const reason = stockFailed.get(product.id);
        if (reason) failed.push({ index, name: product.name, error: reason });
        else created.push(product);
      }
      done += chunk.length;
      onProgress?.(done, total);
    }

    if (created.length > 0) {
      const failNote = failed.length > 0 ? ` (${failed.length.toLocaleString("es-CO")} filas con problemas)` : "";
      await this.note(
        INVENTORY_AUDIT_ACTIONS.imported,
        `Importaste ${created.length.toLocaleString("es-CO")} ${created.length === 1 ? "producto nuevo" : "productos nuevos"}${failNote}`,
        undefined,
        performedBy
      );
    }
    return { created, failed: failed.sort((a, b) => a.index - b.index) };
  }

  /**
   * Actualiza muchos productos existentes (importación CSV con "Actualizar").
   * Pasa el catálogo ya cargado para no volver a pedirlo por cada fila.
   * El stock NUNCA cambia aquí (updateProduct ya lo protege).
   */
  public async updateProductsBatch(
    updates: Array<{ id: string; input: ProductInput }>,
    onProgress?: (done: number, total: number) => void
  ): Promise<{ updated: number; failed: BatchFailure[] }> {
    const catalog = await this.listForCatalogDecision();
    const failed: BatchFailure[] = [];
    let updated = 0;
    for (let index = 0; index < updates.length; index += 1) {
      const { id, input } = updates[index];
      try {
        await this.updateProduct(id, input, catalog, { silent: true });
        updated += 1;
      } catch (error) {
        failed.push({ index, name: input.name, error: error instanceof Error ? error.message : String(error) });
      }
      onProgress?.(index + 1, updates.length);
    }
    if (updated > 0) {
      await this.note(
        INVENTORY_AUDIT_ACTIONS.importUpdated,
        `Actualizaste ${updated.toLocaleString("es-CO")} ${updated === 1 ? "producto" : "productos"} desde un archivo`
      );
    }
    return { updated, failed };
  }

  public async updateProduct(
    id: string,
    input: ProductInput,
    preloaded?: Product[],
    options?: { silent?: boolean }
  ): Promise<Product> {
    const existing = await this.getRepository().findById(id);
    if (!existing) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    // Un insumo no se vende suelto: nunca lleva código de barras ni precio de venta
    // (también limpia los que hubiera guardado antes).
    if ((input.isIngredient ?? existing.isIngredient) === true) {
      input = InventoryEngine.withoutDirectSaleFields({ ...input, isIngredient: true });
    }

    await this.validateProductInput(input, id, preloaded);

    const updatedIsIngredient = (input.isIngredient ?? existing.isIngredient) === true;
    const updated: Product = {
      ...existing,
      ...input,
      id,
      name: input.name.trim(),
      // El stock NUNCA se cambia al editar un producto: el formulario trae el
      // que tenía al abrirse y pisaría las ventas hechas mientras tanto. Para
      // cambiarlo existen Aumentar / Disminuir / Ajustar stock (con kardex).
      stock: existing.stock,
      // Un insumo nunca se vende: su precio de venta siempre es 0.
      ...(updatedIsIngredient ? { price: 0 } : {}),
      lastUpdated: new Date(),
    };

    if (input.recipe !== undefined && input.recipe.length === 0) {
      (updated as any).recipe = undefined;
    }
    if (input.sizes !== undefined && input.sizes.length === 0) {
      (updated as any).sizes = undefined;
    }
    if (input.extras !== undefined && input.extras.length === 0) {
      (updated as any).extras = undefined;
    }

    await this.getRepository().update(updated);

    if (!options?.silent) {
      const label = `"${existing.name}"`;
      const wasActive = existing.active !== false;
      const isActive = updated.active !== false;
      if (wasActive && !isActive) {
        await this.note(INVENTORY_AUDIT_ACTIONS.deactivated, `Desactivaste el ${this.kindWord(existing)} ${label}`, id);
      } else if (!wasActive && isActive) {
        await this.note(INVENTORY_AUDIT_ACTIONS.reactivated, `Reactivaste el ${this.kindWord(existing)} ${label}`, id);
      }

      const changes: string[] = [];
      if (existing.name !== updated.name) changes.push(`nombre: "${existing.name}" → "${updated.name}"`);
      if ((existing.price ?? 0) !== (updated.price ?? 0)) changes.push(`precio: ${money(existing.price)} → ${money(updated.price)}`);
      if (existing.purchasePrice !== updated.purchasePrice) {
        changes.push(`costo: ${money(existing.purchasePrice)} → ${money(updated.purchasePrice)}`);
      }
      if ((existing.minStock ?? 0) !== (updated.minStock ?? 0)) {
        changes.push(`stock mínimo: ${existing.minStock ?? 0} → ${updated.minStock ?? 0}`);
      }
      if (existing.categoryId !== updated.categoryId) changes.push("categoría");
      if (changes.length > 0) {
        await this.note(INVENTORY_AUDIT_ACTIONS.updated, `Editaste ${label}: ${changes.join(", ")}`, id);
      }
    }
    return updated;
  }

  public async deleteProduct(id: string): Promise<"deleted" | "deactivated"> {
    if (!(await this.getRepository().exists(id))) {
      throw new Error('PRODUCT_NOT_FOUND');
    }

    // Check if product is referenced as an ingredient in any recipe
    const allProducts = await this.listForCatalogDecision();
    for (const product of allProducts) {
      if (product.recipe && product.recipe.some((item) => item.productId === id)) {
        throw new Error('PRODUCT_IN_USE');
      }
    }

    // Soft-delete: deactivate products that have stock history (movimientos)
    const product = await this.getRepository().findById(id);
    if (product && this.kardex) {
      const hasMovements = await this.kardex.hasMovements(id);
      if (hasMovements) {
        await this.getRepository().update({ ...product, active: false });
        await this.note(
          INVENTORY_AUDIT_ACTIONS.deactivated,
          `Eliminaste el ${this.kindWord(product)} "${product.name}" (quedó desactivado porque tiene historial)`,
          id
        );
        return "deactivated";
      }
    }

    await this.getRepository().delete(id);
    if (product) {
      await this.note(INVENTORY_AUDIT_ACTIONS.deleted, `Eliminaste el ${this.kindWord(product)} "${product.name}"`, id);
    }
    return "deleted";
  }

  /**
   * Elimina DEFINITIVAMENTE todos los productos de venta (kind = "products")
   * o todos los insumos (kind = "insumos"), incluidos los desactivados.
   * No hace soft-delete ni valida recetas: es el "Eliminar todos" del panel
   * de eliminación y no se puede deshacer. Devuelve cuántos borró.
   */
  public async deleteAllByKind(kind: "products" | "insumos"): Promise<number> {
    const all = await this.listForCatalogDecision();
    const ids = all
      .filter((p) => (kind === "insumos" ? p.isIngredient === true : p.isIngredient !== true))
      .map((p) => p.id);
    if (ids.length === 0) return 0;
    await this.getRepository().deleteMany(ids);
    await this.note(
      INVENTORY_AUDIT_ACTIONS.deletedAll,
      `Eliminaste todos los ${kind === "insumos" ? "insumos" : "productos"} (${ids.length.toLocaleString("es-CO")})`
    );
    return ids.length;
  }

  public async increaseStock(
    id: string,
    quantity: number,
    reason: string,
    performedBy?: string,
    supplierId?: string,
    purchasePrice?: number,
    movementId?: string,
    branchId?: string | null,
    expiresAt?: IsoDateString
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
      lossCategory: undefined,
      expiresAt
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
    /**
     * Opción B: SOLO el descuento por venta puede dejar el stock en negativo.
     * Los ajustes manuales (increaseStock/decreaseStock) siguen estrictos.
     */
    allowNegative?: boolean;
    /** Vencimiento del lote que entra (solo entradas). Ver la rama "expiresAt" más abajo. */
    expiresAt?: IsoDateString;
  }): Promise<void> {
    const repository = this.getRepository();
    const product = await repository.findById(params.productId);
    if (!product) throw new Error("PRODUCT_NOT_FOUND");

    // BATCH products consume ingredients, not their own stock tracked via trackStock.
    // ON_DEMAND products with recipes also don't track their own stock.
    // Services (trackStock=false, no recipe) should not have stock adjusted.
    const isRecipeBased = product.recipe && product.recipe.length > 0;
    const isService = product.trackStock === false && !isRecipeBased && product.productionMode !== "BATCH";
    if (isService) {
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
      allowNegative: params.allowNegative ?? false,
      extraFields
    };

    // Entrada CON vencimiento: solo el RPC por lote (`adjust_stock_batch_with_kardex`)
    // guarda `expiresAt` en el Kardex; el RPC de un solo movimiento no lo conoce.
    // El RPC por lote solo acepta `lastUpdated` en extraFields, así que una entrada
    // con costo o proveedor no puede llevar vencimiento todavía: se rechaza en voz
    // alta en vez de perder la fecha en silencio.
    if (params.expiresAt !== undefined) {
      if (type !== "INCREASE" || !isIsoDateString(params.expiresAt)) {
        throw new Error("INVALID_EXPIRES_AT");
      }
      if (params.purchasePrice !== undefined || params.supplierId) {
        throw new Error("EXPIRES_AT_UNSUPPORTED_WITH_COST");
      }
      if (!repository.adjustStockBatchWithKardex) {
        throw new Error("EXPIRES_AT_UNSUPPORTED");
      }
      // movementId hace de operationId: un reintento (cola offline) repite el
      // mismo id y el servidor responde idempotente en vez de sumar dos veces.
      await repository.adjustStockBatchWithKardex(movementId, [
        {
          productId: params.productId,
          delta: params.quantity,
          reason: params.reason,
          type: "INCREASE",
          branchId,
          expiresAt: params.expiresAt,
          extraFields: { lastUpdated: extraFields.lastUpdated }
        }
      ]);
      return;
    }

    if (repository.adjustStockWithKardex) {
      await repository.adjustStockWithKardex(movement);
      return;
    }

     const kardex = this.getKardex();
     if (await kardex.exists(movementId)) return;

     const stockBefore = (await repository.findById(params.productId))?.stock ?? 0;
     const updatedProduct = await repository.adjustStock(
       params.productId,
       params.quantity,
       extraFields,
       params.allowNegative ?? false,
       branchId
     );
     const stockAfter = updatedProduct.stock;
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
       branchId,
       stockBefore,
       stockAfter
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
   * Vista previa para Caja (solo lectura, no toca stock ni base de datos):
   * cuánto descontaría esta venta de cada producto/ingrediente, con la MISMA
   * expansión de recetas que usa consumeForSale. Recibe el catálogo ya cargado.
   * Lanza PRODUCT_NOT_FOUND / RECIPE_CYCLE / INVALID_SALE_QUANTITY igual que la venta real.
   */
  public previewSaleConsumption(
    items: SaleStockItem[],
    products: readonly Product[]
  ): Map<string, number> {
    const productById = new Map(products.map((product) => [product.id, product]));
    return this.expandSaleConsumption(items, productById);
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
      // Opción B: una venta nunca se bloquea por falta de stock. Solo el
      // descuento lo pide; la reposición (INCREASE) no lleva el flag.
      ...(direction === "DECREASE" ? { allowNegative: true } : {}),
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
        lossCategory: undefined,
        // Opción B: una venta nunca se bloquea por falta de stock.
        allowNegative: direction === "DECREASE"
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
  ): Promise<{
    product: Product;
    consumed: Array<{ productId: string; name: string; quantity: number }>;
    reference: string;
  }> {
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error("INVALID_QUANTITY");
    }
    if (!productId) throw new Error("PRODUCT_NOT_FOUND");

    const repository = this.getRepository();
    const branchId = getCurrentBranchId();

    if (!branchId) {
      throw new Error("NO_BRANCH_CONTEXT");
    }

    if (!repository.produceBatch) {
      throw new Error("BATCH_PRODUCTION_NOT_SUPPORTED");
    }

    const reference = `PROD-${operationId.slice(0, 8).toUpperCase()}`;

    const product = await repository.findById(productId);
    if (!product) {
      throw new Error("PRODUCT_NOT_FOUND");
    }

    if (product.productionMode !== "BATCH") {
      throw new Error("NOT_BATCH_PRODUCT");
    }

    if (product.branchId && product.branchId !== branchId) {
      throw new Error("BRANCH_SCOPE_MISMATCH");
    }

    const recipe = product.recipe ?? [];
    if (recipe.length === 0) {
      throw new Error("NO_RECIPE");
    }

    const ingredientIds = Array.from(
      new Set(recipe.map((item) => item.productId))
    );
    const ingredients = await repository.findMany(ingredientIds);
    const ingredientMap = new Map(ingredients.map((ingredient) => [ingredient.id, ingredient]));

    // Producción por tandas: validación estricta siempre (Opción B). Producir
    // sin ingredientes suficientes es un error de digitación, no una venta.
    const consumed: Array<{ productId: string; name: string; quantity: number }> = [];

    for (const item of recipe) {
      if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
        throw new Error("INVALID_RECIPE_QUANTITY");
      }

      const ingredient = ingredientMap.get(item.productId);
      if (!ingredient) {
        throw new Error("PRODUCT_NOT_FOUND");
      }

      if (ingredient.businessId && product.businessId && ingredient.businessId !== product.businessId) {
        throw new Error("BUSINESS_SCOPE_MISMATCH");
      }

      if (ingredient.branchId && ingredient.branchId !== branchId) {
        throw new Error("BRANCH_SCOPE_MISMATCH");
      }

      const totalNeeded = item.quantity * quantity;
      if (!Number.isFinite(totalNeeded) || totalNeeded <= 0) {
        throw new Error("INVALID_RECIPE_QUANTITY");
      }

      if (ingredient.stock < totalNeeded) {
        throw new Error("INSUFFICIENT_STOCK");
      }

      consumed.push({
        productId: ingredient.id,
        name: ingredient.name,
        quantity: totalNeeded,
      });
    }

    // ProductionRepository.produceBatch() delegates directly to the atomic
    // Supabase RPC `produce_batch_atomic()`. That RPC already consumes the
    // recipe, increments finished stock, writes the Kardex and records the
    // operation ledger under `operationId`. The engine MUST NOT call
    // KardexEngine.record() again, because doing so would duplicate the
    // inventory history after every successful batch.
    const updatedProducts = await repository.produceBatch({
      operationId,
      productId,
      branchId,
      quantity,
      performedBy,
    });

    const updatedProduct =
      updatedProducts.find((item) => item.id === productId) ??
      (await repository.findById(productId));

    if (!updatedProduct) {
      throw new Error("BATCH_PRODUCTION_RESULT_MISSING");
    }

    return {
      product: updatedProduct,
      consumed,
      reference,
    };
  }
}

export const inventoryEngine = new InventoryEngine();