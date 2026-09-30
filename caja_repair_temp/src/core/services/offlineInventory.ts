import { pendingInventoryAdjustmentsStore } from "../offline/pendingInventoryAdjustmentsStore";
import { productCatalogStore } from "../store/productCatalogStore";
import { toast } from "../store/toastStore";
import { LossCategory } from "../entities/Entities";
import { ProductLocalRepository } from "../../infrastructure/di/repositories/ProductLocalRepository";
import { logWarning } from "../../infrastructure/logging/opsLogger";

/**
 * offlineInventory.ts
 * ---------------------------------------------------------------------------
 * PASO 1.7 del plan offline: equivalente de offlineSale.ts para ajustes de
 * inventario. `isNetworkFailure` para esta operación se reutiliza tal cual
 * desde offlineSale.ts (ver useInventory.ts) — la distinción entre error de
 * red y error de negocio (ej. 'INSUFFICIENT_STOCK', 'PRODUCT_NOT_FOUND') no
 * depende de qué operación se esté haciendo.
 *
 * Encola el ajuste en pendingInventoryAdjustmentsStore Y aplica el mismo
 * delta de inmediato sobre productCatalogStore (actualización optimista),
 * para que Inventario y Caja muestren el stock correcto sin esperar a que
 * vuelva la conexión.
 */

const OFFLINE_INCREASE_MESSAGE =
  "Sin conexión: la entrada de stock quedó guardada en este dispositivo y se sincronizará sola cuando vuelva internet.";

const OFFLINE_DECREASE_MESSAGE =
  "Sin conexión: la salida de stock quedó guardada en este dispositivo y se sincronizará sola cuando vuelva internet.";

export async function queueIncreaseStockOffline(params: {
  id?: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  performedBy?: string;
  supplierId?: string;
  purchasePrice?: number;
}): Promise<void> {
  const offlineId = params.id ?? crypto.randomUUID();

  await pendingInventoryAdjustmentsStore.enqueue({
    id: offlineId,
    productId: params.productId,
    productName: params.productName,
    type: "INCREASE",
    quantity: params.quantity,
    reason: params.reason,
    performedBy: params.performedBy,
    supplierId: params.supplierId,
    purchasePrice: params.purchasePrice
  });

  productCatalogStore.applyStockDelta(params.productId, params.quantity);

  try {
    const localRepository = new ProductLocalRepository();
    const product = await localRepository.findById(params.productId);
    if (product) {
      await localRepository.save({
        ...product,
        stock: product.stock + params.quantity,
        lastUpdated: new Date()
      });
    }
  } catch (error) {
    logWarning("No se pudo actualizar el stock optimista en el caché local", {
      category: "offline",
      context: { error: String(error), productId: params.productId, change: params.quantity }
    });
  }

  toast.warning(OFFLINE_INCREASE_MESSAGE);
}

export async function queueDecreaseStockOffline(params: {
  id?: string;
  productId: string;
  productName: string;
  quantity: number;
  reason: string;
  performedBy?: string;
  lossCategory?: LossCategory;
}): Promise<void> {
  const offlineId = params.id ?? crypto.randomUUID();

  await pendingInventoryAdjustmentsStore.enqueue({
    id: offlineId,
    productId: params.productId,
    productName: params.productName,
    type: "DECREASE",
    quantity: params.quantity,
    reason: params.reason,
    performedBy: params.performedBy,
    lossCategory: params.lossCategory
  });

  productCatalogStore.applyStockDelta(params.productId, -params.quantity);

  try {
    const localRepository = new ProductLocalRepository();
    const product = await localRepository.findById(params.productId);
    if (product) {
      await localRepository.save({
        ...product,
        stock: product.stock - params.quantity,
        lastUpdated: new Date()
      });
    }
  } catch (error) {
    logWarning("No se pudo actualizar el stock optimista en el caché local", {
      category: "offline",
      context: { error: String(error), productId: params.productId, change: -params.quantity }
    });
  }

  toast.warning(OFFLINE_DECREASE_MESSAGE);
}