import { InventoryMovement, LossCategory, Product } from "../../../core/entities/Entities";
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
   * @param allowNegative BLOQUEANTE #4 (auditoría Fase 2): si es `true`
   * (viene de `companyConfigStore.get().allowNegativeStock`), la operación
   * NO rechaza el descuento aunque el stock resultante quede en negativo.
   * Por defecto `false` — mismo comportamiento estricto de siempre.
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
  extraFields?: Record<string, unknown>;
}