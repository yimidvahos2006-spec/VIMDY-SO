import { InventoryMovement, IsoDateString, LossCategory, Product } from "../../../core/entities/Entities";
import { IRepository } from "./IRepository";

/**
 * IProductRepository
 * ---------------------------------------------------------------------------
 * Extiende IRepository<Product> con `adjustStock`, la operación ATÓMICA de
 * descuento/aumento de stock (ver función `adjust_product_stock` en
 * supabase/schema.sql). InventoryEngine depende de esta interfaz, no de la
 * clase concreta ProductRepository, para no romper la separación
 * core/infrastructure — mismo estilo que ya usa IRepository en este mismo
 * directorio.
 */
export interface IProductRepository extends IRepository<Product> {
  /**
   * Lectura AUTORITATIVA del catálogo: va directo a la base de datos en este
   * instante. A diferencia de `findAll()`, NUNCA responde con el caché local
   * (ni sin red, ni por lentitud del servidor, ni porque el fetch falló) y
   * nunca reutiliza una lectura que ya venía en vuelo: si no hay respuesta
   * real del servidor, LANZA error. Es la única lectura válida para tomar
   * "fotos" de stock que luego se usan para calcular diferencias (conteo).
   */
  findAllAuthoritative(): Promise<Product[]>;

  /**
   * `findAll()` es la lectura RÁPIDA: devuelve la caché local al instante y
   * revalida por detrás (puede traer unos segundos de atraso). Esta variante
   * espera al servidor (con tope) y es para operaciones de administración que
   * deciden con la lista completa: nombre duplicado, receta en uso, eliminar
   * todos. Opcional: un repositorio sin caché puede omitirla (findAll ya es fresco).
   */
  findAllPreferFresh?(): Promise<Product[]>;

  /**
   * Recarga el catálogo desde el servidor y REEMPLAZA el caché local con lo que
   * este usuario recibe ahora. Se usa cuando cambia lo que el servidor le
   * entrega (ej. se abre un conteo a ciegas y su stock pasa a llegar enmascarado):
   * el caché guardado antes todavía tendría las cifras reales. Si el servidor no
   * responde LANZA error y el caché queda como estaba (nunca se improvisa).
   */
  reloadCatalogFromServer(): Promise<Product[]>;

  transferStock?(input: {
    operationId: string;
    productId: string;
    fromBranchId: string;
    toBranchId: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]>;
  produceBatch?(input: {
    operationId: string;
    productId: string;
     branchId?: string;
    quantity: number;
    performedBy?: string;
  }): Promise<Product[]>;

  adjustStockBatchWithKardex?(
    operationId: string,
    movements: readonly StockMovementBatchItem[]
  ): Promise<Product[]>;

  /**
   * Suma `delta` (negativo para descontar) al stock del producto en UNA
   * sola operación SQL atómica — nunca hace "leer stock, calcular, guardar"
   * en pasos separados, que es lo que permitía la sobreventa en ventas
   * concurrentes.
   *
   * @param extraFields Campos adicionales del producto a actualizar en la
   * misma operación (ej. purchasePrice, lastPurchaseDate) — evita un
   * segundo UPDATE separado que podría pisar un cambio de stock concurrente
   * ocurrido entre medio.
   * @param allowNegative Opción B: si es `true` (solo el descuento por venta
   * lo envía así), la operación NO rechaza el descuento aunque el stock
   * resultante quede en negativo. Por defecto `false`: los ajustes manuales,
   * transferencias y producción por tandas siguen siendo estrictos.
   * @throws Error('PRODUCT_NOT_FOUND') si el producto no existe (o no
   * pertenece al negocio activo).
   * @throws Error('INSUFFICIENT_STOCK') si el stock actual no alcanza para
   * el delta pedido y `allowNegative` es `false` (solo aplica cuando delta
   * es negativo).
   */
  adjustStock(
    id: string,
    delta: number,
    extraFields?: Record<string, unknown>,
    allowNegative?: boolean,
    branchId?: string
  ): Promise<Product>;

  /**
   * Ajusta stock y registra el movimiento de Kardex dentro de la misma
   * transacción Postgres. Este es el camino requerido para operaciones
   * productivas; `adjustStock` queda para compatibilidad y casos sin Kardex.
   */
  adjustStockWithKardex?(params: {
    productId: string;
    delta: number;
    reason: string;
    type: InventoryMovement["type"];
    performedBy?: string;
    supplierId?: string;
    supplierName?: string;
    lossCategory?: LossCategory;
    movementId: string;
    branchId?: string;
    allowNegative?: boolean;
    extraFields?: Record<string, unknown>;
  }): Promise<Product>;

  findBySkuAndBranch(sku: string, branchId: string): Promise<Product | null>;
}

export interface StockMovementBatchItem {
  productId: string;
  delta: number;
  reason: string;
  type: InventoryMovement["type"];
  branchId?: string;
  /**
   * Opción B: solo el descuento por venta (type DECREASE) lo envía en `true`;
   * el RPC `adjust_stock_batch_with_kardex` entonces NO rechaza el movimiento
   * aunque el stock quede en negativo. Ausente o `false` = estricto
   * (INSUFFICIENT_STOCK), que es lo que usan los ajustes manuales y las
   * recepciones de compra.
   */
  allowNegative?: boolean;
  /**
   * Vencimiento del lote que entra. SOLO con type INCREASE: el RPC
   * `adjust_stock_batch_with_kardex` rechaza la fecha en cualquier otro tipo
   * (INVALID_INVENTORY_BATCH_ITEM) y un formato distinto de YYYY-MM-DD
   * (INVALID_EXPIRES_AT). Queda en el Kardex (`inventory_movements.expires_at`).
   */
  expiresAt?: IsoDateString;
  extraFields?: Record<string, unknown>;
}