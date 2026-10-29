/**
 * Órdenes de compra: listado de órdenes activas y recepción de mercancía.
 *
 * Módulo autocontenido y puro (sin efectos secundarios ni dependencias del
 * proyecto). Todas las funciones devuelven nuevas estructuras y nunca mutan
 * sus argumentos, por lo que es seguro usarlas con stores inmutables.
 */

export type PurchaseOrderStatus =
  | 'Pendiente'
  | 'Enviada'
  | 'Recibida'
  | 'Cancelada';

export interface PurchaseOrderItem {
  /** Identificador del insumo/producto dentro del inventario. */
  readonly itemId: string;
  readonly quantity: number;
  readonly unitCost?: number;
}

export interface PurchaseOrder {
  readonly id: string;
  readonly supplierId?: string;
  readonly status: PurchaseOrderStatus;
  readonly items: readonly PurchaseOrderItem[];
  readonly createdAt: string;
  readonly receivedAt?: string;
}

/** Existencias por itemId. */
export type InventoryStock = Readonly<Record<string, number>>;

export interface ReceiveOrderResult {
  readonly order: PurchaseOrder;
  readonly inventory: InventoryStock;
}

export class PurchaseOrderError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PurchaseOrderError';
  }
}

/** Estados que cuentan como "activa" (aún pendiente de recibir). */
const ACTIVE_STATUSES: ReadonlySet<PurchaseOrderStatus> = new Set<PurchaseOrderStatus>([
  'Pendiente',
  'Enviada',
]);

export function isOrderActive(order: PurchaseOrder): boolean {
  return ACTIVE_STATUSES.has(order.status);
}

/**
 * Devuelve las órdenes activas (Pendiente o Enviada), de la más antigua a la
 * más reciente según `createdAt`.
 */
export function getActiveOrders(orders: readonly PurchaseOrder[]): PurchaseOrder[] {
  return orders
    .filter(isOrderActive)
    .slice()
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/**
 * Suma al inventario las cantidades de la orden. Los ítems repetidos se
 * acumulan correctamente.
 */
export function applyOrderToInventory(
  inventory: InventoryStock,
  items: readonly PurchaseOrderItem[],
): InventoryStock {
  const next: Record<string, number> = { ...inventory };
  for (const { itemId, quantity } of items) {
    next[itemId] = (next[itemId] ?? 0) + quantity;
  }
  return next;
}

/**
 * Marca una orden como 'Recibida' y suma sus ítems al inventario.
 *
 * Lanza `PurchaseOrderError` si la orden ya fue recibida, está cancelada o
 * contiene cantidades inválidas (no finitas o <= 0). De esta forma una
 * recepción repetida nunca duplica el stock.
 *
 * @param receivedAt Fecha ISO de recepción (por defecto, ahora).
 */
export function markOrderAsReceived(
  order: PurchaseOrder,
  inventory: InventoryStock,
  receivedAt: string = new Date().toISOString(),
): ReceiveOrderResult {
  if (order.status === 'Recibida') {
    throw new PurchaseOrderError(`La orden ${order.id} ya fue recibida.`);
  }
  if (order.status === 'Cancelada') {
    throw new PurchaseOrderError(`La orden ${order.id} está cancelada y no puede recibirse.`);
  }
  for (const item of order.items) {
    if (!Number.isFinite(item.quantity) || item.quantity <= 0) {
      throw new PurchaseOrderError(
        `Cantidad inválida (${item.quantity}) para el ítem ${item.itemId} en la orden ${order.id}.`,
      );
    }
  }

  return {
    order: { ...order, status: 'Recibida', receivedAt },
    inventory: applyOrderToInventory(inventory, order.items),
  };
}

/**
 * Variante para listas: recibe la orden por id y devuelve la lista actualizada
 * junto con el nuevo inventario.
 */
export function receiveOrderById(
  orders: readonly PurchaseOrder[],
  orderId: string,
  inventory: InventoryStock,
  receivedAt?: string,
): { orders: PurchaseOrder[]; inventory: InventoryStock } {
  const target = orders.find((o) => o.id === orderId);
  if (!target) {
    throw new PurchaseOrderError(`No existe la orden ${orderId}.`);
  }
  const result = markOrderAsReceived(target, inventory, receivedAt);
  return {
    orders: orders.map((o) => (o.id === orderId ? result.order : o)),
    inventory: result.inventory,
  };
}