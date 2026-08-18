import { Sale } from "../entities/Entities";
import { Receipt } from "../engines/ReceiptEngine";
import { container } from "../../infrastructure/di/CompositionRoot";
import { dashboardStore } from "../store/dashboardStore";
import { companyConfigStore } from "../store/companyConfigStore";
import { businessStore } from "../store/businessStore";
import { printReceiptDocument } from "../../presentation/utils/printReceiptDocument";
import { toast } from "../store/toastStore";
import { subscriptionStore } from "../store/subscriptionStore";
import { subscriptionEngine } from "../engines/SubscriptionEngine";

/**
 * checkout.ts
 * ---------------------------------------------------------------------------
 * Reglas compartidas por TODO cobro real (mostrador y mesas), para que no
 * existan dos copias que puedan divergir con el tiempo.
 *
 * Antes: processSale.ts (mostrador) y CloseTableDialog.tsx (mesas) tenían
 * cada uno su propia copia de "qué pasa después de cobrar". Ya divergieron
 * una vez (mostrador respetaba companyConfigStore.autoPrintReceipt, mesas no;
 * mostrador exigía turno de caja abierto, mesas no). Esta es ahora la única
 * fuente de verdad para esas reglas.
 */

/**
 * Verifica que haya un turno de caja abierto antes de permitir cualquier
 * cobro. Aplica igual a mostrador y a mesas: cobrar sin turno abierto deja
 * el dinero recibido sin dueño en el arqueo de caja.
 *
 * Devuelve true si se puede cobrar. Si no, muestra el aviso y devuelve false
 * para que el llamador aborte el cobro sin lanzar una excepción a mitad de
 * un flujo que ya podría haber tocado datos (carrito, mesa, etc).
 */
export async function assertShiftOpen(): Promise<boolean> {
  const currentShift = await container.shiftEngine.getCurrentShift();

  if (!currentShift) {
    toast.error('La caja está cerrada. Abre un turno en la pestaña "Turno de caja" antes de cobrar.');
    return false;
  }

  return true;
}

/**
 * VIMDY — FASE 7, PASO 5 y PASO 9: "no registrar nuevas ventas hasta
 * activar un plan", pero "nunca perder información / nunca eliminar
 * ventas, inventario o clientes". Este es el único punto por el que pasa
 * todo cobro real (mostrador y mesas, ver PrintableSaleItem de abajo), así
 * que basta bloquear aquí para que ninguna pantalla pueda cobrar con el
 * plan vencido — el resto de la app (Dashboard, Reportes, Inventario,
 * Configuración) sigue 100% disponible para consulta.
 */
export async function assertSubscriptionActive(): Promise<boolean> {
  const subscription = subscriptionStore.getSnapshot().subscription;
  if (!subscription) return true; // aún no se cargó: no bloquea de más por una carrera de red

  if (subscriptionEngine.isBlocked(subscription)) {
    toast.error("Tu prueba gratuita ha finalizado. Activa un plan para seguir registrando ventas.");
    return false;
  }

  return true;
}

export interface PrintableSaleItem {
  name: string;
  quantity: number;
  price: number;
  unit?: string;
  quantityRaw?: number;
  selectedSizeId?: string;
  selectedExtraIds?: readonly string[];
  discount?: { type: "PERCENT" | "FIXED"; value: number };
  taxRate?: number;
}

/**
 * Imprime el recibo solo si el negocio tiene activada la impresión
 * automática (Configuración > Impresión). Antes CloseTableDialog imprimía
 * siempre sin consultar esa configuración; ahora se comporta igual que
 * mostrador en los dos flujos.
 */
export function printReceiptIfEnabled(
  receipt: Receipt,
  items: PrintableSaleItem[]
): void {
  if (companyConfigStore.get().autoPrintReceipt) {
    printReceiptDocument(receipt, items, businessStore.get());
  }
}

/**
 * Sincroniza el Dashboard con el efecto real de una venta ya cobrada.
 * Los tres valores salen de los engines que ya procesaron la venta
 * (InventoryEngine y KitchenEngine reales) — nada se inventa ni se estima.
 * Compartida por mostrador y mesas para que ambos muevan las mismas
 * tarjetas del Dashboard de la misma forma.
 */
export async function syncDashboardAfterSale(sale: Sale): Promise<void> {
  const totalProductsSold = sale.items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  dashboardStore.addSale(sale.total, totalProductsSold);

  const [remainingProducts, activeKitchenOrders] = await Promise.all([
    container.inventoryEngine.listAll(),
    container.kitchenService.getOrders()
  ]);

  dashboardStore.updateInventory(
    remainingProducts.reduce((sum, product) => sum + product.stock, 0)
  );
  dashboardStore.updateKitchenPending(activeKitchenOrders.length);
}

/**
 * Revierte en el Dashboard el efecto de una venta cancelada o reembolsada.
 * SalesEngine ya revierte inventario/caja (engines reales); esto solo hace
 * que las tarjetas del Dashboard (capa de UI) dejen de mostrar una venta
 * que ya no existe, en vez de quedar infladas hasta el próximo refresh.
 */
export async function syncDashboardAfterReversal(sale: Sale): Promise<void> {
  const totalProductsReturned = sale.items.reduce(
    (sum, item) => sum + item.quantity,
    0
  );
  dashboardStore.reverseSale(sale.total, totalProductsReturned);

  const [remainingProducts, activeKitchenOrders] = await Promise.all([
    container.inventoryEngine.listAll(),
    container.kitchenService.getOrders()
  ]);

  dashboardStore.updateInventory(
    remainingProducts.reduce((sum, product) => sum + product.stock, 0)
  );
  dashboardStore.updateKitchenPending(activeKitchenOrders.length);
}