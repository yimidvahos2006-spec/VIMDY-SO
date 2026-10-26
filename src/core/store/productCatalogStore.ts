import { ObservableStore } from "./ObservableStore";
import { Product } from "../entities/Entities";
import { normalizeSearchText, productMatchesSearch } from "../utils/searchText";
import { isStockMasked } from "../utils/stockMask";
import { container, productsReady } from "../../infrastructure/di/CompositionRoot";
import { logWarning } from "../../infrastructure/logging/opsLogger";
import { vimdyCore } from "../VimdyCore";

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

  /**
   * Se incrementa en cada reset() (cierre de sesión / cambio de negocio).
   * Una carga que empezó con el negocio anterior y termina después NO debe
   * escribir su catálogo en el store del negocio nuevo.
   */
  private epoch = 0;

  /** Escucha del evento "inventory" (ver listenForCatalogChanges). Una sola vez. */
  private stopListening: (() => void) | null = null;

  /** Refrescos por evento: nunca dos a la vez; una ráfaga se resuelve con UNA lectura más. */
  private eventRefreshRunning = false;
  private eventRefreshQueued = false;

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
   *   - `container.inventoryEngine.get().listAll()` termina llamando a
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
    const epoch = this.epoch;
    try {
      await productsReady;
      const products = await container.inventoryEngine.get().listAll();
      if (epoch !== this.epoch) return;
      this.publish(products);
      this.loaded = true;
      this.listenForCatalogChanges();
    } catch (error) {
      logWarning("[productCatalogStore] No se pudo hidratar el catálogo al iniciar", { category: "offline", context: { error: String(error) } });
    } finally {
      if (epoch === this.epoch) this.initPromise = null;
    }
  }

  /**
   * ProductRepository.findAll() responde con la caché local al instante y
   * revalida por detrás; si el servidor trae algo distinto (stock, precio,
   * productos nuevos o borrados en otro dispositivo) emite "inventory". Sin
   * esta escucha la Caja se quedaba con la foto vieja hasta la siguiente
   * venta o recarga. La lectura que dispara el evento ya sale de la caché
   * actualizada, así que no hay bucle: la segunda revalidación no encuentra
   * diferencias y no vuelve a emitir.
   */
  private listenForCatalogChanges(): void {
    if (this.stopListening) return;
    this.stopListening = vimdyCore.on("inventory", () => {
      if (this.loaded) void this.refreshFromEvent();
    });
  }

  private async refreshFromEvent(): Promise<void> {
    if (this.eventRefreshRunning) {
      this.eventRefreshQueued = true;
      return;
    }
    this.eventRefreshRunning = true;
    try {
      do {
        this.eventRefreshQueued = false;
        try {
          await this.refresh();
        } catch (error) {
          logWarning("[productCatalogStore] No se pudo refrescar el catálogo tras un cambio", { category: "offline", context: { error: String(error) } });
        }
      } while (this.eventRefreshQueued);
    } finally {
      this.eventRefreshRunning = false;
    }
  }

  /** Vacía el catálogo en memoria (cierre de sesión / cambio de negocio). */
  reset(): void {
    this.epoch += 1;
    this.loaded = false;
    this.initPromise = null;
    this.publish([]);
  }

  /** Vuelve a leer del InventoryEngine (llamar después de vender, reabastecer, etc). */
  async refresh(): Promise<void> {
    const epoch = this.epoch;
    const products = await container.inventoryEngine.get().listAll();
    if (epoch !== this.epoch) return;
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
    const next = this.snapshot.map((product) => {
      if (product.id !== productId) return product;
      // Enmascarado (conteo a ciegas): `stock` es un valor de banda, no la
      // cantidad real. Sumarle el delta inventaría una cifra que además podría
      // cambiar el estado (🟢/🟡/🔴). Se deja tal cual hasta el próximo refresh().
      if (isStockMasked(product)) return product;
      return { ...product, stock: product.stock + delta, lastUpdated: new Date() };
    });
    this.publish(next);
  }

  private getSellableSnapshot(): Product[] {
    return this.snapshot.filter((product) => product.isIngredient !== true);
  }

  getById(id: string): Product | undefined {
    return this.getSellableSnapshot().find((product) => product.id === id);
  }

  getByBarcode(code: string): Product | undefined {
    return this.getSellableSnapshot().find((product) => product.barcode === code);
  }

  getByCategory(categoryId: string): Product[] {
    const sellable = this.getSellableSnapshot();

    if (categoryId === "Todos" || categoryId === "" || categoryId.toLowerCase() === "todos") {
      return [...sellable];
    }

    // Categoría virtual: no existe en la tabla de categorías, filtra sobre
    // el flag real product.favorite (el mismo que ya usaba el badge de
    // estrella en la tarjeta de producto).
    if (categoryId === "Favoritos") {
      return sellable.filter((product) => product.favorite);
    }

    return sellable.filter(
      (product) => product.categoryId.toLowerCase() === categoryId.toLowerCase()
    );
  }

  /**
   * Búsqueda del POS. Sin tildes ni mayúsculas ("cafe" encuentra "Café") y por
   * nombre, SKU, código de barras, categoría y alias (misma regla que
   * Inventario, ver productMatchesSearch). `categoryNameById` es opcional: el
   * store solo conoce el id de la categoría, así que quien llama pasa los
   * nombres para que escribir "bebidas" también encuentre por categoría.
   */
  search(text: string, categoryNameById?: Readonly<Record<string, string>>): Product[] {
    const value = normalizeSearchText(text);
    const sellable = this.getSellableSnapshot();

    if (value === "") {
      return [...sellable];
    }

    return sellable.filter((product) =>
      productMatchesSearch(product, value, categoryNameById?.[product.categoryId])
    );
  }
}

export const productCatalogStore = new ProductCatalogStore();