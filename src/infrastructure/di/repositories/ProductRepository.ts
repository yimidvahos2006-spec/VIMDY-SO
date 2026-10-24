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

/** Máximo que findAllAuthoritative() espera al servidor. Pasado este tiempo falla (nunca cae al caché). */
const AUTHORITATIVE_WAIT_MS = 15000;

/** Productos que se piden por página a la función segura de lectura (máximo del servidor: 1000). */
const SAFE_READ_PAGE_SIZE = 1000;
const SAFE_READ_MAX_PAGES = 200; // tope de seguridad: 200.000 productos

/**
 * Mensaje cuando el servidor tiene a esta persona en "stock enmascarado" (conteo a
 * ciegas abierto): su sesión no ve las filas reales de products, así que
 * editar/borrar no haría nada o sobrescribiría con valores de banda.
 */
const COUNT_MASKED_WRITE_MESSAGE =
  "Tienes un conteo a ciegas abierto: mientras siga abierto no puedes modificar productos. Pide a un administrador que lo cierre.";

/** La función no existe todavía en la base (migración sin aplicar): PostgREST PGRST202 o Postgres 42883. */
function isMissingFunctionError(error: { code?: string; message?: string }): boolean {
  return error.code === "PGRST202" || error.code === "42883" || /could not find the function/i.test(error.message ?? "");
}

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

  /** true cuando la última lectura completa llegó con el stock enmascarado por el servidor. */
  private catalogMasked = false;

  /** false = la base no tiene inventory_products_read todavía (se lee la tabla como antes). */
  private safeReadAvailable = true;

  /**
   * ÚNICO camino de lectura del catálogo hacia el servidor.
   *
   * Pide los productos a la función inventory_products_read, que decide EN EL
   * SERVIDOR si esta persona ve el stock/costo reales o una copia enmascarada
   * (conteo a ciegas abierto). Así el navegador, su caché local (IndexedDB) y la
   * pantalla nunca reciben la cifra real cuando no deben.
   *
   * Si la función aún no existe (migración sin aplicar) cae a la lectura directa
   * de la tabla, que es el comportamiento anterior.
   */
  private async readFromServer(productIds?: string[]): Promise<Product[]> {
    const businessId = getCurrentBusinessId();
    const legacy = () => (productIds ? super.findMany(productIds) : super.findAll());
    if (!businessId || !this.safeReadAvailable) return legacy();

    const branchId = getCurrentBranchId() ?? null;
    const rows: Product[] = [];
    let afterId: string | null = null;

    for (let page = 0; page < SAFE_READ_MAX_PAGES; page += 1) {
      const { data, error } = await supabase.rpc("inventory_products_read", {
        p_business_id: businessId,
        p_branch_id: branchId,
        p_product_ids: productIds ?? null,
        p_after_id: afterId,
        p_limit: SAFE_READ_PAGE_SIZE
      });

      if (error) {
        if (isMissingFunctionError(error)) {
          this.safeReadAvailable = false;
          logWarning("[ProductRepository] inventory_products_read no existe en la base: se lee la tabla directamente", {
            category: "offline",
            context: { error: error.message }
          });
          return legacy();
        }
        throw new Error(`SUPABASE_FIND_ALL_FAILED (products): ${error.message}`);
      }

      const batch = (data ?? []) as Array<{ id: string; data: unknown; version: number }>;
      for (const row of batch) rows.push(this.reviveRow(row));
      if (batch.length < SAFE_READ_PAGE_SIZE) break;
      afterId = batch[batch.length - 1].id;
    }

    if (!productIds) this.catalogMasked = rows.some((product) => product.stockMasked === true);
    return rows;
  }

  /**
   * Antes de escribir en products: si la última lectura llegó enmascarada se
   * confirma con el servidor que SIGUE enmascarado (puede haberse cerrado el
   * conteo desde otro equipo). Si lo sigue, no se escribe nada.
   */
  private async assertCatalogWritable(): Promise<void> {
    if (!this.catalogMasked) return;
    const businessId = getCurrentBusinessId();
    if (businessId) {
      const { data, error } = await supabase.rpc("inventory_count_user_is_masked", { p_business_id: businessId });
      if (!error && data === false) {
        this.catalogMasked = false;
        return;
      }
    }
    throw new Error(COUNT_MASKED_WRITE_MESSAGE);
  }

  /** Un solo fetch a la vez; null = el resultado quedó viejo (hubo una escritura en medio). */
  private fetchFresh(): Promise<Product[] | null> {
    if (this.inflightFresh) return this.inflightFresh;
    const epoch = this.writeEpoch;
    const run = (async () => {
      const fresh = this.recentDeletes.filter(await this.readFromServer());
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
   * Lectura AUTORITATIVA (ver IProductRepository.findAllAuthoritative).
   *
   * Por qué NO reutiliza `fetchFresh()` ni `findAll()`:
   *  - `findAll()` puede devolver el caché local (sin red, servidor lento >2,5 s,
   *    fetch fallido o descartado por una escritura en medio).
   *  - `fetchFresh()` comparte un fetch que ya venía en vuelo: esa lectura pudo
   *    empezar ANTES de una venta/compra reciente, o sea que no sería "ahora".
   *  - `fetchFresh()` devuelve null si hubo una escritura local en medio; aquí
   *    la lectura al servidor sigue siendo válida (la escritura ya está en la base).
   *
   * Tampoco depende de `connectionStore.isOnline()` (es una heurística con ping
   * cada 20 s): el intento real contra el servidor es la única verdad. Si falla,
   * se lanza el error; jamás se responde con datos locales.
   *
   * A propósito no escribe en el caché: no toca el estado que usan las pantallas.
   */
  public async findAllAuthoritative(): Promise<Product[]> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const fromServer = await Promise.race([
        this.readFromServer(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error("AUTHORITATIVE_READ_TIMEOUT")), AUTHORITATIVE_WAIT_MS);
        })
      ]);
      return this.scopeToCurrent(fromServer);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Recarga el catálogo desde el servidor y reemplaza el caché local (IndexedDB).
   *
   * Cuándo: cuando cambia lo que el servidor entrega a esta persona. Caso real:
   * al abrir un conteo a ciegas su stock/costo pasa a llegar enmascarado, pero el
   * caché guardado ANTES aún tiene las cifras reales y `findAll()` lo serviría si
   * el servidor tarda o no hay red.
   *
   * - `touchLocal()` invalida cualquier lectura que ya venía en vuelo: esa pudo
   *   empezar antes del cambio y, al terminar, volvería a escribir cifras viejas
   *   en el caché.
   * - Lee con `findAllAuthoritative()`: si el servidor no responde LANZA y el
   *   caché queda intacto.
   */
  public async reloadCatalogFromServer(): Promise<Product[]> {
    this.touchLocal();
    const fresh = this.recentDeletes.filter(await this.findAllAuthoritative());
    await this.local.replaceAll(fresh);
    return fresh;
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
        const fresh = id ? ((await this.readFromServer([id]))[0] ?? null) : null;

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
    await this.assertCatalogWritable();
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
    await this.assertCatalogWritable();
    await super.saveMany(products);
    this.touchLocal();
    try {
      await Promise.all(products.map((product) => this.local.save(product)));
    } catch (error) {
      logWarning("[ProductRepository] No se pudo guardar el lote de productos en caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  public async update(product: Product): Promise<void> {
    await this.assertCatalogWritable();
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
    await this.assertCatalogWritable();
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
    await this.assertCatalogWritable();
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

  /** Igual que findById: por la función segura de lectura (respeta el stock enmascarado). */
  public async findMany(ids: string[]): Promise<Product[]> {
    if (ids.length === 0) return [];
    return this.readFromServer(ids);
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