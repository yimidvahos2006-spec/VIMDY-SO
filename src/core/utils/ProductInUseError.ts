// src/core/errors/ProductInUseError.ts
/* ===========================================================================
   ProductInUseError
   ---------------------------------------------------------------------------
   BLOQUEANTE (auditoría "eliminar un ingrediente usado", 2026-08-06):
   antes `InventoryEngine.deleteProduct()` borraba el producto sin revisar
   si otro producto lo usa como ingrediente (en su receta general, o en la
   receta propia de un tamaño/extra). Borrar "Queso" mientras "Pizza
   Personal" lo tiene en su receta dejaba esa receta apuntando a un
   `productId` que ya no existe -- una referencia rota silenciosa que solo
   se nota cuando alguien vende esa pizza e InventoryEngine.consumeForSale
   intenta descontar un ingrediente fantasma.

   Se lanza desde `InventoryEngine.deleteProduct()` cuando `findUsages()`
   encuentra al menos un producto que referencia el que se quiere borrar.
   Lleva la lista de productos afectados (id + nombre) para que la UI
   pueda mostrar exactamente "está siendo utilizado en: Pizza Personal,
   Pizza Grande, Lasaña" en vez de un mensaje genérico, y ofrecer "Ir a
   las recetas" sobre esos productos puntuales.

   Mismo patrón que DuplicateNameError/OptimisticLockError: una clase de
   error con datos estructurados, no solo un `Error('CODE')` de texto,
   porque este caso necesita mostrarle al usuario CUÁLES productos son
   los responsables, no solo que la operación fue rechazada.
=========================================================================== */

export interface ProductUsageRef {
  readonly productId: string;
  readonly productName: string;
}

export class ProductInUseError extends Error {
  /** Productos que usan el producto que se intentó borrar como ingrediente. */
  public readonly usedBy: readonly ProductUsageRef[];

  constructor(usedBy: readonly ProductUsageRef[]) {
    super("PRODUCT_IN_USE");
    this.name = "ProductInUseError";
    this.usedBy = usedBy;
  }
}

/** Type guard cómodo para los `catch (err)` de la capa de negocio. */
export function isProductInUseError(err: unknown): err is ProductInUseError {
  return err instanceof ProductInUseError;
}