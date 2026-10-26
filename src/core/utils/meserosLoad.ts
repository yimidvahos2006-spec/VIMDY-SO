/* ===========================================================================
   loadMeserosScreen
   ---------------------------------------------------------------------------
   Carga inicial de la pantalla de Meseros con stale-while-revalidate.

   Antes se esperaba un Promise.all de mesas, productos, meseros y duración
   promedio: la pantalla abría cuando respondía la consulta MÁS LENTA. Ahora:

     - Mesas y productos se esperan (ambos leen primero de su caché local, así
       que normalmente resuelven en milisegundos): con eso ya hay algo que pintar.
     - Meseros: si hay copia local se aplica YA y la lista fresca llega por
       detrás. Sin copia (primer uso en el dispositivo) se espera la red, para
       no mostrar un selector de mesero vacío.
     - La duración promedio solo afina la urgencia de cada mesa: nunca bloquea.

   La promesa resuelve cuando la pantalla ya puede mostrarse; rechaza solo si
   no hay nada que mostrar (mesas, productos, o meseros sin copia local).
   Es lógica pura (sin React ni IndexedDB) para probarla con vitest.
=========================================================================== */

export interface MeserosLoadOptions<TTable, TProduct, TWaiter> {
  loadTables: () => Promise<TTable[]>;
  loadProducts: () => Promise<TProduct[]>;
  /** Pide los meseros a la red (y quien llama decide si los guarda en la copia local). */
  fetchWaiters: () => Promise<TWaiter[]>;
  /** Copia local de meseros; null si nunca se guardó. */
  readCachedWaiters: () => TWaiter[] | null;
  /** Opcional: duración promedio de las mesas. Un fallo se ignora. */
  fetchAverage?: () => Promise<number>;
  onTables: (tables: TTable[]) => void;
  onProducts: (products: TProduct[]) => void;
  onWaiters: (waiters: TWaiter[], source: "cache" | "network") => void;
  onAverage: (ms: number) => void;
  /** Fallos que NO impiden mostrar la pantalla (meseros frescos con copia local). */
  onBackgroundError?: (error: unknown) => void;
  /** true cuando la pantalla se desmontó: no se entrega nada más. */
  isCancelled?: () => boolean;
}

export async function loadMeserosScreen<TTable, TProduct, TWaiter>(
  options: MeserosLoadOptions<TTable, TProduct, TWaiter>
): Promise<void> {
  const cancelled = (): boolean => options.isCancelled?.() ?? false;

  // Todo arranca a la vez: nada espera a otra consulta para empezar.
  const tablesRequest = options.loadTables();
  const productsRequest = options.loadProducts();
  const waitersRequest = options.fetchWaiters();
  // Si más abajo se espera, el error se maneja allí; si no, se reporta como secundario.
  waitersRequest.catch(() => undefined);
  // Si falla una de las dos lecturas críticas, la otra no debe quedar como "rechazo sin atender".
  tablesRequest.catch(() => undefined);
  productsRequest.catch(() => undefined);

  const cachedWaiters = options.readCachedWaiters();
  if (cachedWaiters && !cancelled()) {
    options.onWaiters(cachedWaiters, "cache");
    waitersRequest.then(
      (fresh) => {
        if (!cancelled()) options.onWaiters(fresh, "network");
      },
      (error) => options.onBackgroundError?.(error)
    );
  }

  if (options.fetchAverage) {
    options
      .fetchAverage()
      .then(
        (ms) => {
          if (!cancelled()) options.onAverage(ms);
        },
        () => undefined
      );
  }

  const [tables, products] = await Promise.all([tablesRequest, productsRequest]);
  if (cancelled()) return;
  options.onTables(tables);
  options.onProducts(products);

  if (!cachedWaiters) {
    const fresh = await waitersRequest;
    if (cancelled()) return;
    options.onWaiters(fresh, "network");
  }
}