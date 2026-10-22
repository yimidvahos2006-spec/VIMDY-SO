import { InventoryMovement, Product } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { IProductRepository, StockMovementBatchItem } from "./IProductRepository";
import { supabase } from "../../supabase/supabaseClient";
import { ProductLocalRepository } from "./ProductLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";
import { getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";
import { vimdyCore } from "../../../core/VimdyCore";
import { RecentDeletes } from "../../../core/utils/recentDeletes";

/** Huella barata del catálogo: sirve para saber si lo que llegó del servidor cambió algo en pantalla. */
function catalogSignature(list: Product[]): string {
  return [...list]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((p) => {
      const updated = p.lastUpdated instanceof Date ? p.lastUpdated.getTime() : String(p.lastUpdated ?? "");
      return `${p.id}|${p.version ?? 0}|${p.stock}|${p.active}|${p.price}|${p.name}|${updated}`;
    })
    .join(";");
}

/** Máximo que findAll() espera al servidor antes de pintar con el caché (red lenta no debe congelar la pantalla). */
const FRESH_WAIT_MS = 2500;

/**
 * ProductRepository
 * ---------------------------------------------------------------------------
 * Migrado de IndexedDbRepository a SupabaseRepository: los productos ya
 * no viven en el navegador, viven en la tabla `products` de Supabase
 * (ver supabase/schema.sql), filtrados automáticamente por el negocio
 * activo (business_id) y protegidos por Row Level Security.
 *
 * La interfaz pública (IRepository<Product>) no cambió, así que
 * InventoryEngine, CategoryEngine, SupplierEngine y DashboardEngine
 * siguen funcionando exactamente igual — no fue necesario tocarlos, salvo
 * InventoryEngine, que ahora usa `adjustStock` (abajo) para descontar/subir
 * stock de forma atómica en vez de leer-y-escribir en dos pasos.
 *
 * PASO 1.1 (Catálogo sin internet) — `findAll()` ya no depende de la red
 * para responder: ver el override más abajo.
 */
export class ProductRepository extends SupabaseRepository<Product> implements IProductRepository {
  protected tableName = "products" as const;

  /** Caché local en IndexedDB — ver ProductLocalRepository. */
  private readonly local = new ProductLocalRepository();

  /**
   * Antes: findAll() llamaba siempre directo a Supabase (heredado de
   * SupabaseRepository), así que sin internet la pantalla de Productos se
   * quedaba esperando para siempre.
   *
   * Ahora: primero lee lo último que haya guardado en IndexedDB y lo
   * devuelve DE INMEDIATO — aunque esté vacío o desactualizado — para que
   * la pantalla nunca dependa de la red para pintar algo. En paralelo, si
   * `connectionStore` (el mismo ping de 20s que ya usa Caja) confirma que
   * hay señal real, dispara el fetch de verdad contra Supabase para
   * refrescar.
   *
   * PASO 1.2 — al llegar la respuesta fresca de Supabase, además se
   * guarda en IndexedDB con `replaceAll` (borra + escribe en una sola
   * transacción), así:
   *   - el próximo `findAll()` ya devuelve lo nuevo de entrada, sin
   *     depender de que haya red en ese momento.
   *   - productos borrados en Supabase (por otro dispositivo, por
   *     ejemplo) también desaparecen del caché local, en vez de quedar
   *     "resucitados" para siempre.
   *
   * A propósito esto sigue sin avisarle a nadie (ningún store) que llegó
   * la actualización — eso es responsabilidad de Paso 1.6
   * (productCatalogStore), no de este repositorio.
   */
  /**
   * Contador de escrituras locales. Si mientras un fetch al servidor estaba
   * en vuelo se hizo un guardado/borrado, ese fetch pudo leer ANTES del
   * cambio: se descarta para no pisar el caché con datos viejos (así un
   * producto recién creado no "desaparece" ni uno borrado "resucita").
   */
  private writeEpoch = 0;
  private inflightFresh: Promise<Product[] | null> | null = null;
  /** Ids borrados hace poco: una lista vieja del servidor no puede traerlos de vuelta. */
  private readonly recentDeletes = new RecentDeletes();

  private touchLocal(): void {
    this.writeEpoch += 1;
  }

  /** Un solo fetch a la vez; null = el resultado quedó viejo (hubo una escritura en medio). */
  private fetchFresh(): Promise<Product[] | null> {
    if (this.inflightFresh) return this.inflightFresh;
    const epoch = this.writeEpoch;
    const run = (async () => {
      const fresh = this.recentDeletes.filter(await super.findAll());
      if (epoch !== this.writeEpoch) return null;
      await this.local.replaceAll(fresh);
      if (epoch !== this.writeEpoch) {
        // Hubo un borrado mientras se escribía el caché: se quitan de nuevo los borrados.
        const stale = fresh.filter((item) => this.recentDeletes.has(item.id)).map((item) => item.id);
        if (stale.length > 0) await this.local.deleteMany(stale);
        return null;
      }
      return fresh;
    })().finally(() => {
      this.inflightFresh = null;
    });
    this.inflightFresh = run;
    return run;
  }

  private scopeToCurrent(list: Product[]): Product[] {
    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();
    return list.filter((product) => {
      if (currentBusinessId && product.businessId && product.businessId !== currentBusinessId) return false;
      if (currentBranchId && product.branchId && product.branchId !== currentBranchId) return false;
      return true;
    });
  }

  /**
   * Con internet: espera el dato fresco del servidor hasta FRESH_WAIT_MS
   * (lo normal: <1s), así lo que ves es lo que hay en la base de datos —
   * un producto creado o borrado desde otro dispositivo aparece/desaparece
   * en el acto. Si el servidor tarda más, se pinta con el caché local y,
   * cuando llegue la respuesta, si algo cambió se avisa con el evento
   * "inventory" para que las pantallas se recarguen solas (antes se
   * actualizaba el caché en silencio y la pantalla quedaba un paso atrás
   * hasta recargar la página).
   * Sin internet (o si el servidor falla): caché local, sin esperar nada.
   */
  public async findAll(): Promise<Product[]> {
    if (!connectionStore.isOnline()) {
      return this.scopeToCurrent(await this.local.findAll());
    }

    const cached = this.scopeToCurrent(await this.local.findAll());
    const pending = this.fetchFresh().catch((error) => {
      logWarning("[ProductRepository] No se pudo refrescar el catálogo desde Supabase", { category: "offline", context: { error: String(error) } });
      return null;
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    const timedOut = Symbol("timeout");
    const winner = await Promise.race([
      pending,
      new Promise<typeof timedOut>((resolve) => {
        timer = setTimeout(() => resolve(timedOut), FRESH_WAIT_MS);
      })
    ]);
    if (timer) clearTimeout(timer);

    if (winner === timedOut) {
      const cachedSignature = catalogSignature(cached);
      void pending.then((fresh) => {
        if (fresh && catalogSignature(this.scopeToCurrent(fresh)) !== cachedSignature) {
          vimdyCore.emit("inventory", { source: "cache-refresh" });
        }
      });
      return cached;
    }

    if (winner) return this.scopeToCurrent(winner);

    // Falló el fetch o quedó viejo por una escritura en medio: lo local manda.
    return this.scopeToCurrent(await this.local.findAll());
  }

  /**
   * Hueco detectado en la revisión de Prioridad 1: `findById()` seguía
   * yendo directo a Supabase (heredado de SupabaseRepository) aunque
   * `findAll()` ya tuviera caché local. Sin internet, esto dejaba
   * colgado cualquier flujo que busque UN producto puntual por id — el
   * caso real es `InventoryEngine.restoreForSale` en una devolución/
   * cancelación de venta.
   *
   * A diferencia de `findAll()` (que sirve el caché de inmediato y
   * refresca en paralelo), aquí SÍ se espera la red cuando hay señal:
   * un detalle puntual (ej. precio/stock exacto para un reembolso) debe
   * ser lo más fresco posible, no lo último que quedó en caché. Solo se
   * cae al caché local si estamos offline o si la llamada a Supabase
   * falla — así nunca se queda colgado esperando una red que no
   * responde.
   */
  public async findById(id: string): Promise<Product | null> {
    if (connectionStore.isOnline()) {
      try {
        const fresh = await super.findById(id);

        if (fresh) {
          void this.local.save(fresh).catch((error) => {
            logWarning("[ProductRepository] No se pudo guardar el producto en caché local", { category: "offline", context: { error: String(error) } });
          });
        }

        return fresh;
      } catch (error) {
        logWarning("[ProductRepository] Falló findById contra Supabase, se usa caché local", { category: "offline", context: { error: String(error) } });
        return this.local.findById(id);
      }
    }

    return this.local.findById(id);
  }

  /**
   * PASO 1.1.1 (fix): `save`, `update` y `delete` NO estaban sobreescritos
   * acá — heredaban directo de SupabaseRepository, así que solo tocaban
   * Supabase y dejaban el caché local (IndexedDB) intacto. Como
   * `findAll()` (arriba) siempre devuelve primero lo que hay en ese
   * caché, un producto recién eliminado/editado/creado seguía viéndose
   * "como antes" en pantalla hasta que el refresh en segundo plano
   * alcanzaba a llegar solo — en la práctica, hasta recargar la página.
   *
   * Con estos tres overrides, apenas Supabase confirma la escritura, el
   * mismo cambio se aplica también al caché local, así que el próximo
   * `findAll()` (el que dispara `load()` justo después, en useInventory)
   * ya devuelve el dato correcto sin esperar nada ni recargar nada.
   */
  public async save(product: Product): Promise<void> {
    await super.save(product);
    this.touchLocal();
    try {
      await this.local.save(product);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo guardar el producto nuevo en caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  /**
   * Igual que `save`: tras confirmar Supabase, el caché local también recibe
   * los productos (si no, tras una importación masiva el catálogo se vería
   * vacío hasta el siguiente refresco en segundo plano).
   */
  public async saveMany(products: Product[]): Promise<void> {
    await super.saveMany(products);
    this.touchLocal();
    try {
      await Promise.all(products.map((product) => this.local.save(product)));
    } catch (error) {
      logWarning("[ProductRepository] No se pudo guardar el lote de productos en caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  public async update(product: Product): Promise<void> {
    await super.update(product);
    this.touchLocal();
    // El UPDATE real en Supabase incrementa la versión en el servidor
    // (ver SupabaseRepository.update); se refleja el mismo +1 acá para
    // que el caché local no quede una versión atrás.
    const cached: Product = { ...product, version: (product.version ?? 1) + 1 };
    try {
      await this.local.save(cached);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo actualizar el producto en caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  public async delete(id: string): Promise<void> {
    await super.delete(id);
    this.recentDeletes.mark([id]);
    this.touchLocal();
    try {
      await this.local.delete(id);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo eliminar el producto de la caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  public async deleteMany(ids: string[]): Promise<void> {
    await super.deleteMany(ids);
    this.recentDeletes.mark(ids);
    this.touchLocal();
    try {
      await this.local.deleteMany(ids);
    } catch (error) {
      logWarning("[ProductRepository] No se pudieron eliminar los productos de la caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  /**
   * Descuenta/aumenta stock en una sola operación SQL atómica (ver función
   * `adjust_product_stock` en supabase/schema.sql) — cierra el riesgo de
   * sobreventa por ventas concurrentes que tenía el patrón anterior
   * "leer stock -> calcular en JS -> guardar".
   */
  public async adjustStock(
    id: string,
    delta: number,
    extraFields: Record<string, unknown> = {},
    allowNegative: boolean = false,
    branchId?: string
  ): Promise<Product> {
    const { data, error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: id,
      p_delta: delta,
      p_extra_fields: extraFields,
      p_allow_negative: allowNegative,
      p_branch_id: branchId ?? null
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT_STOCK")) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      if (error.message.includes("PRODUCT_NOT_FOUND")) {
        throw new Error("PRODUCT_NOT_FOUND");
      }
      throw new Error(`SUPABASE_ADJUST_STOCK_FAILED: ${error.message}`);
    }

    const result = reviveDates(data as Product);
    this.touchLocal();

    // Mismo fix que save/update/delete: sin esto, un descuento de stock
    // por venta (o un ajuste manual) quedaba correcto en Supabase pero el
    // caché local seguía con el stock viejo hasta recargar la página.
    try {
      await this.local.save(result);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo actualizar el stock en caché local", { category: "offline", context: { error: String(error) } });
    }

    return result;
  }

  public async adjustStockWithKardex(params: {
    productId: string;
    delta: number;
    reason: string;
    type: InventoryMovement["type"];
    performedBy?: string;
    supplierId?: string;
    supplierName?: string;
    lossCategory?: InventoryMovement["lossCategory"];
    movementId: string;
    branchId?: string;
    allowNegative?: boolean;
    extraFields?: Record<string, unknown>;
  }): Promise<Product> {
    const { data, error } = await supabase.rpc("adjust_stock_with_kardex_and_fields", {
      p_product_id: params.productId,
      p_delta: params.delta,
      p_reason: params.reason,
      p_type: params.type,
      p_performed_by: params.performedBy ?? null,
      p_supplier_id: params.supplierId ?? null,
      p_supplier_name: params.supplierName ?? null,
      p_loss_category: params.lossCategory ?? null,
      p_movement_id: params.movementId,
      p_branch_id: params.branchId ?? null,
      p_allow_negative: params.allowNegative ?? false,
      p_extra_fields: params.extraFields ?? {}
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT_STOCK")) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      if (error.message.includes("PRODUCT_NOT_FOUND")) {
        throw new Error("PRODUCT_NOT_FOUND");
      }
      throw new Error(`SUPABASE_ADJUST_STOCK_WITH_KARDEX_FAILED: ${error.message}`);
    }

    const result = reviveDates(data as Product);
    this.touchLocal();
    try {
      await this.local.save(result);
    } catch (cacheError) {
      logWarning("[ProductRepository] No se pudo actualizar el stock en caché local", {
        category: "offline",
        context: { error: String(cacheError) }
      });
    }

    return result;
  }

  public async adjustStockBatchWithKardex(
    operationId: string,
    movements: readonly StockMovementBatchItem[]
  ): Promise<Product[]> {
    const { data, error } = await supabase.rpc("adjust_stock_batch_with_kardex", {
      p_operation_id: operationId,
      p_movements: movements.map((movement) => ({
        ...movement,
        branchId: movement.branchId ?? null,
        extraFields: movement.extraFields ?? {}
      }))
    });

    if (error) {
      if (error.message.includes("INSUFFICIENT_STOCK")) {
        throw new Error("INSUFFICIENT_STOCK");
      }
      if (error.message.includes("PRODUCT_NOT_FOUND")) {
        throw new Error("PRODUCT_NOT_FOUND");
      }
      if (error.message.includes("IDEMPOTENCY_KEY_REUSED")) {
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      }
      throw new Error(`SUPABASE_ADJUST_STOCK_BATCH_FAILED: ${error.message}`);
    }

    this.touchLocal();
    const products = Array.isArray(data)
      ? data.map((product) => reviveDates(product as Product))
      : [];
    await Promise.all(products.map(async (product) => {
      try {
        await this.local.save(product);
      } catch (cacheError) {
        logWarning("[ProductRepository] No se pudo actualizar el stock batch en caché local", {
          category: "offline",
          context: { productId: product.id, error: String(cacheError) }
        });
      }
    }));
    return products;
  }

  public async transferStock(input: {
    operationId: string;
    productId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]> {
    const { data, error } = await supabase.rpc("transfer_stock_atomic", {
      p_operation_id: input.operationId,
      p_product_id: input.productId,
      p_from_branch_id: input.fromBranchId,
      p_to_branch_id: input.toBranchId,
      p_quantity: input.quantity,
      p_performed_by: input.performedBy ?? null
    });
    if (error) {
      if (error.message.includes("INSUFFICIENT_STOCK")) throw new Error("INSUFFICIENT_STOCK");
      if (error.message.includes("TRANSFER_TARGET_PRODUCT_NOT_FOUND")) throw new Error("TRANSFER_TARGET_PRODUCT_NOT_FOUND");
      if (error.message.includes("IDEMPOTENCY_KEY_REUSED")) throw new Error("IDEMPOTENCY_KEY_REUSED");
      throw new Error(`SUPABASE_TRANSFER_STOCK_FAILED: ${error.message}`);
    }

    this.touchLocal();
    const products = Array.isArray(data) ? data.map((product) => reviveDates(product as Product)) : [];
    await Promise.all(products.map(async (product) => {
      try {
        await this.local.save(product);
      } catch (cacheError) {
        logWarning("[ProductRepository] No se pudo actualizar el stock transferido en caché local", {
          category: "offline",
          context: { productId: product.id, error: String(cacheError) }
        });
      }
    }));
    return products;
  }

  public async produceBatch(input: {
    operationId: string;
    productId: string;
    branchId: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]> {
    const { data, error } = await supabase.rpc("produce_batch_atomic", {
      p_operation_id: input.operationId,
      p_product_id: input.productId,
      p_branch_id: input.branchId,
      p_quantity: input.quantity,
      p_performed_by: input.performedBy ?? null
    });
    if (error) {
      if (error.message.includes("INSUFFICIENT_STOCK")) throw new Error("INSUFFICIENT_STOCK");
      if (error.message.includes("RECIPE_CYCLE")) throw new Error("RECIPE_CYCLE");
      if (error.message.includes("IDEMPOTENCY_KEY_REUSED")) throw new Error("IDEMPOTENCY_KEY_REUSED");
      throw new Error(`SUPABASE_PRODUCE_BATCH_FAILED: ${error.message}`);
    }

    this.touchLocal();
    const products = Array.isArray(data) ? data.map((product) => reviveDates(product as Product)) : [];
    await Promise.all(products.map(async (product) => {
      try {
        await this.local.save(product);
      } catch (cacheError) {
        logWarning("[ProductRepository] No se pudo actualizar el stock producido en caché local", {
          category: "offline",
          context: { productId: product.id, error: String(cacheError) }
        });
      }
    }));
    return products;
  }

  public async findBySkuAndBranch(sku: string, branchId: string): Promise<Product | null> {
    const businessId = getCurrentBusinessId();
    if (!businessId || !sku) return null;

    const { data, error } = await supabase
      .from("products")
      .select("data, version")
      .eq("business_id", businessId)
      .eq("branch_id", branchId)
      .eq("data->>sku", sku)
      .maybeSingle();

    if (error) throw new Error(`SUPABASE_FIND_BY_SKU_FAILED: ${error.message}`);
    return data ? this.reviveRow(data) : null;
  }
}