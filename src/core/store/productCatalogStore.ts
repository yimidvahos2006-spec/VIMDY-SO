import { ObservableStore } from "./ObservableStore";
import { Product } from "../entities/Entities";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { logWarning } from "../../infrastructure/logging/opsLogger";

/* ===========================================================================
   ProductCatalogStore
   ---------------------------------------------------------------------------
   Reemplazo de core/store/productStore.ts.

   Antes: productStore guardaba su propia copia hardcodeada de productos,
   desconectada de InventoryEngine. Vender en Caja nunca bajaba este stock.

   Ahora: este store NO guarda productos propios. Es una capa reactiva
   (ObservableStore, igual que cartStore/searchStore) sobre
   container.inventoryEngine, la misma fuente que usa Inventario. Cuando el
   stock cambia (por una venta, un reabastecimiento, etc.) hay que llamar a
   refresh() para que el snapshot se actualice y los componentes suscritos
   (PosProducts, PosCategories) se re-rendericen.
=========================================================================== */
class ProductCatalogStore extends ObservableStore<Product[]> {
  private loaded = false;

  /**
   * PASO 1.6 — evita que dos componentes que montan casi al mismo tiempo
   * (ej. Caja y CloseTableDialog) disparen dos veces la carga inicial en
   * paralelo. Mientras haya una hidratación en curso, cualquier otro
   * `init()` se cuelga de la misma promesa en vez de duplicar el trabajo.
   */
  private initPromise: Promise<void> | null = null;

  constructor() {
    super([]);
  }

  /**
   * Se llama una vez al montar el POS (o cualquier pantalla que use
   * useProductCatalog). Si ya está cargado, no repite la consulta.
   *
   * PASO 1.6 (Catálogo sin internet) — al iniciar la app, este método
   * NUNCA se queda esperando a que responda Supabase:
   *   - `productsReady` (ver CompositionRoot.ts) ya resuelve de inmediato,
   *     no depende de red.
   *   - `container.inventoryEngine.listAll()` termina llamando a
   *     `ProductRepository.findAll()`, que desde los Pasos 1.1+1.2 lee
   *     primero del caché local en IndexedDB y responde con eso al
   *     instante — el fetch real a Supabase corre en paralelo, sin
   *     bloquear esta promesa.
   * En la práctica esto significa que `init()` hidrata el store con la
   * última copia conocida del catálogo aunque no haya internet, en vez de
   * dejar la pantalla en blanco "cargando" hasta que vuelva la señal.
   *
   * Si por cualquier motivo la hidratación falla (ej. IndexedDB bloqueada
   * por el navegador), no se marca `loaded = true`: el store queda listo
   * para reintentar en el próximo `init()` en vez de quedar atascado.
   */
  async init(): Promise<void> {
    if (this.loaded) return;
    if (this.initPromise) return this.initPromise;

    this.initPromise = this.hydrate();
    return this.initPromise;
  }

  private async hydrate(): Promise<void> {
    try {
      await productsReady;
      const products = await container.inventoryEngine.listAll();
      this.publish(products);
      this.loaded = true;
    } catch (error) {
      logWarning("[productCatalogStore] No se pudo hidratar el catálogo al iniciar", { category: "offline", context: { error: String(error) } });
    } finally {
      this.initPromise = null;
    }
  }

  /** Vuelve a leer del InventoryEngine (llamar después de vender, reabastecer, etc). */
  async refresh(): Promise<void> {
    const products = await container.inventoryEngine.listAll();
    this.publish(products);
  }

  /**
   * PASO 1.7 (Cola offline para escrituras) — actualización optimista en
   * memoria: cuando un ajuste de inventario queda encolado offline (ver
   * offlineInventory.ts), todavía no hay nada nuevo que leer de
   * InventoryEngine (el servidor no se tocó), así que no sirve llamar a
   * refresh(). Esto aplica el mismo delta que ya se guardó en la cola
   * directamente sobre el snapshot en memoria, para que Inventario y Caja
   * se vean actualizados al instante. Cuando el ajuste se sincroniza de
   * verdad (o si esta pestaña se cierra), refresh() vuelve a traer el
   * valor real desde IndexedDB/Supabase y reemplaza este valor optimista.
   */
  applyStockDelta(productId: string, delta: number): void {
    const next = this.snapshot.map((product) =>
      product.id === productId
        ? { ...product, stock: product.stock + delta, lastUpdated: new Date() }
        : product
    );
    this.publish(next);
  }

  getById(id: string): Product | undefined {
    return this.snapshot.find((product) => product.id === id);
  }

  getByBarcode(code: string): Product | undefined {
    return this.snapshot.find((product) => product.barcode === code);
  }

  getByCategory(categoryId: string): Product[] {
    if (categoryId === "Todos" || categoryId === "" || categoryId.toLowerCase() === "todos") {
      return [...this.snapshot];
    }

    // Categoría virtual: no existe en la tabla de categorías, filtra sobre
    // el flag real product.favorite (el mismo que ya usaba el badge de
    // estrella en la tarjeta de producto).
    if (categoryId === "Favoritos") {
      return this.snapshot.filter((product) => product.favorite);
    }

    return this.snapshot.filter(
      (product) => product.categoryId.toLowerCase() === categoryId.toLowerCase()
    );
  }

  /** Mismo comportamiento de búsqueda que tenía productStore.search(). */
  search(text: string): Product[] {
    const value = text.trim().toLowerCase();

    if (value === "") {
      return [...this.snapshot];
    }

    return this.snapshot.filter((product) => {
      if (product.name.toLowerCase().includes(value)) return true;
      if (product.categoryId.toLowerCase().includes(value)) return true;
      if (product.barcode && product.barcode.includes(value)) return true;
      if (product.aliases?.some((alias) => alias.toLowerCase().includes(value))) return true;
      return false;
    });
  }
}

export const productCatalogStore = new ProductCatalogStore();