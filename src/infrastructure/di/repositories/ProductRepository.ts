import { Product } from "../../../core/entities/Entities";
import { SupabaseRepository, reviveDates } from "./SupabaseRepository";
import { IProductRepository } from "./IProductRepository";
import { supabase } from "../../supabase/supabaseClient";
import { ProductLocalRepository } from "./ProductLocalRepository";
import { connectionStore } from "../../../core/store/connectionStore";
import { logWarning } from "../../logging/opsLogger";
import { getCurrentBusinessId, getCurrentBranchId } from "../../supabase/supabaseClient";

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
  public async findAll(): Promise<Product[]> {
    const cached = await this.local.findAll();

    if (connectionStore.isOnline()) {
      void super
        .findAll()
        .then((fresh) => this.local.replaceAll(fresh))
        .catch((error) => {
          logWarning("[ProductRepository] No se pudo refrescar el catálogo desde Supabase", { category: "offline", context: { error: String(error) } });
        });
    }

    const currentBusinessId = getCurrentBusinessId();
    const currentBranchId = getCurrentBranchId();

    return cached.filter((product) => {
      if (currentBusinessId && product.businessId && product.businessId !== currentBusinessId) return false;
      if (currentBranchId && product.branchId && product.branchId !== currentBranchId) return false;
      return true;
    });
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
    try {
      await this.local.save(product);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo guardar el producto nuevo en caché local", { category: "offline", context: { error: String(error) } });
    }
  }

  public async update(product: Product): Promise<void> {
    await super.update(product);
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
    try {
      await this.local.delete(id);
    } catch (error) {
      logWarning("[ProductRepository] No se pudo eliminar el producto de la caché local", { category: "offline", context: { error: String(error) } });
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
    allowNegative: boolean = false
  ): Promise<Product> {
    const { data, error } = await supabase.rpc("adjust_product_stock", {
      p_product_id: id,
      p_delta: delta,
      p_extra_fields: extraFields,
      p_allow_negative: allowNegative
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
}