import { KitchenOrder } from "../entities/Entities";
import { pendingKitchenOrdersStore } from "./pendingKitchenOrdersStore";

/**
 * offlineKitchen.ts
 * ---------------------------------------------------------------------------
 * Parte 1 del plan de cocina offline: encola una comanda en el navegador
 * cuando no hay conexión, para que se sincronice contra Supabase más tarde
 * (ver syncPendingKitchenOrders.ts).
 *
 * No persiste nada por su cuenta: delega en pendingKitchenOrdersStore,
 * igual que offlineSale.ts delega en pendingSalesStore.
 */

export async function queueKitchenOrderOffline(order: KitchenOrder): Promise<void> {
  await pendingKitchenOrdersStore.enqueue(order);
}
