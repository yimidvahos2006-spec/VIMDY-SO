import { KitchenOrder, Product, Table, User, Waiter, Category } from "../entities/Entities";

/* ===========================================================================
   kitchenOrderEnrichment
   ---------------------------------------------------------------------------
   KitchenOrder solo guarda ids (productId, waiterId) y el origen crudo de
   SalesEngine ("Mesa {uuid}"). Ni la vista de comandas activas ni el
   historial de entregados deben mostrar eso directamente: ambas necesitan
   el mismo cruce contra InventoryEngine, TableEngine y UserEngine. Este
   módulo centraliza esa lógica para no duplicarla entre
   useKitchenOrders y useKitchenHistory.
=========================================================================== */

export interface KitchenOrderItemView {
  productId: string;
  productName: string;
  quantity: number;
  price: number;
  /** Product.estimatedPrepMinutes de este item, si el negocio lo definió. */
  estimatedPrepMinutes?: number;
  /**
   * Estación de impresión/preparación resuelta para este item:
   * Product.printStationOverride si lo tiene, si no
   * Category.printStation de su categoría. undefined = el negocio no
   * configuró estaciones — el ticket no se separa.
   */
  station?: string;
  /** Nota específica del item (ej. "sin arroz", "sin cebolla", "con hielo"). */
  note?: string;
}

export interface KitchenOrderView extends Omit<KitchenOrder, "items"> {
  items: KitchenOrderItemView[];
  total: number;
  /** Nombre real del mesero/cajero que envió la comanda, ya resuelto. */
  waiterName?: string;
  /**
   * Tiempo estimado de TODA la comanda: el máximo entre los items (cocina
   * prepara en paralelo, así que la comanda está lista cuando termina el
   * item más demorado, no cuando suman todos). undefined si ningún item
   * de la comanda tiene tiempo estimado definido.
   */
  estimatedPrepMinutes?: number;
}

const TABLE_ORIGIN_PREFIX = "Mesa ";

/**
 * SalesEngine guarda el origen de una comanda de mesa como "Mesa {tableId}",
 * y tableId es el UUID interno de la mesa (no un número legible). Aquí lo
 * resolvemos contra el nombre real de la mesa (ej. "Mesa 5") para que la
 * tarjeta de Cocina y el anuncio de voz lean algo humano, no un UUID.
 */
export function resolveOrigin(origin: string | undefined, tableNameById: Map<string, string>): string | undefined {
  if (!origin || !origin.startsWith(TABLE_ORIGIN_PREFIX)) {
    return origin;
  }

  const rawTableId = origin.slice(TABLE_ORIGIN_PREFIX.length);
  return tableNameById.get(rawTableId) ?? origin;
}

export interface KitchenEnrichmentLookups {
  products: Product[];
  tables: Table[];
  users: User[];
  /**
   * Meseros ligeros (sin login, ver Waiter en Entities.ts). Opcional para
   * no romper a quien todavía no lo pasa: si falta, waiterId solo se
   * resuelve contra `users` como antes.
   */
  waiters?: Waiter[];
  /**
   * Categorías reales del negocio, para resolver la estación de impresión
   * de cada item (ver KitchenOrderItemView.station). Opcional por el
   * mismo motivo que `waiters`: si falta, ningún item trae estación y el
   * ticket simplemente no se separa (mismo comportamiento que antes de
   * este campo).
   */
  categories?: Category[];
}

/** Convierte comandas crudas de KitchenEngine en vistas listas para pantalla. */
export function enrichKitchenOrders(
  rawOrders: KitchenOrder[],
  { products, tables, users, waiters = [], categories = [] }: KitchenEnrichmentLookups
): KitchenOrderView[] {
  const productById = new Map(products.map(product => [product.id, product]));
  const categoryById = new Map(categories.map(category => [category.id, category]));
  const tableNameById = new Map(tables.map(table => [table.id, table.name]));
  // El mismo waiterId puede venir de un User con login o de un Waiter
  // ligero (mesero sin login) — se resuelve contra ambos en un solo mapa.
  const userNameById = new Map<string, string>();
  users.forEach(user => userNameById.set(user.id, user.name));
  waiters.forEach(waiter => userNameById.set(waiter.id, waiter.name));

  return rawOrders.map(order => {
    const items = order.items.map(item => {
      const product = productById.get(item.productId);
      const category = product ? categoryById.get(product.categoryId) : undefined;

      return {
        productId: item.productId,
        productName: product?.name ?? "Producto",
        quantity: item.quantity,
        price: item.price,
        estimatedPrepMinutes: product?.estimatedPrepMinutes,
        station: product?.printStationOverride ?? category?.printStation,
        note: item.note
      };
    });

    const itemsWithTime = items
      .map(i => i.estimatedPrepMinutes)
      .filter((m): m is number => typeof m === "number");

    return {
      ...order,
      origin: resolveOrigin(order.origin, tableNameById),
      waiterName: order.waiterId ? userNameById.get(order.waiterId) : undefined,
      items,
      total: items.reduce((sum, item) => sum + item.price * item.quantity, 0),
      estimatedPrepMinutes: itemsWithTime.length > 0 ? Math.max(...itemsWithTime) : undefined
    };
  });
}