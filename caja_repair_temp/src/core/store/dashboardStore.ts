import { ObservableStore } from "./ObservableStore";

export interface DashboardData {
  sales: number;
  customers: number;
  orders: number;
  inventory: number;
  todaySales: number;
  cashAmount: number;
  productsSold: number;
  averageTicket: number;
  pendingKitchen: number;
}

/** Los 4 indicadores que muestran las tarjetas KPI del Dashboard. */
export interface DashboardMetrics {
  sales: number;
  customers: number;
  orders: number;
  inventory: number;
}

/** Snapshot completo que consume la UI: datos actuales + ayer + historial reciente. */
export interface DashboardSnapshot {
  data: DashboardData;
  /** Valor real de cada métrica al cierre de ayer, para calcular el ↑/↓ % de cada tarjeta. */
  yesterday: DashboardMetrics;
  /** Últimos 14 días reales de cada métrica, en orden cronológico, para las sparklines. */
  history: {
    sales: number[];
    customers: number[];
    orders: number[];
    inventory: number[];
  };
}

const INITIAL_DATA: DashboardData = {
  sales: 0,
  customers: 0,
  orders: 0,
  inventory: 0,
  todaySales: 0,
  cashAmount: 0,
  productsSold: 0,
  averageTicket: 0,
  pendingKitchen: 0
};

const INITIAL_YESTERDAY: DashboardMetrics = {
  sales: 0,
  customers: 0,
  orders: 0,
  inventory: 0
};

const INITIAL_HISTORY: DashboardSnapshot["history"] = {
  sales: [],
  customers: [],
  orders: [],
  inventory: []
};

/**
 * DashboardStore
 * ---------------------------------------------------------------------------
 * Cache 100% en memoria, sin persistencia (ni localStorage ni IndexedDB).
 * La fuente de verdad real vive en Supabase — useDashboardSync.ts la consulta
 * (SalesEngine / CustomerEngine / InventoryEngine / KitchenService) al montar
 * la app y cada vez que llega un evento "sale"/"customer"/"inventory"/"kitchen"
 * del bus interno, calcula `yesterday` e `history` con datos reales y los
 * escribe aquí con applyReconciled(). Todos los dispositivos del mismo negocio
 * terminan viendo exactamente los mismos números, siempre.
 *
 * Los métodos addSale/reverseSale/partialReverseSale/updateInventory/
 * updateKitchenPending (llamados desde checkout.ts y SalesEngine.ts) solo
 * dan una respuesta optimista instantánea en ESTE dispositivo mientras
 * useDashboardSync termina de reconciliar con el dato real. Estos métodos
 * modifican `optimistic` (NO tocan `data`), por lo que:
 * - Un dato optimista NUNCA puede confundirse con un dato reconciliado.
 * - applyReconciled() sobrescribe el snapshot publicado con datos reales,
 *   ignorando por completo cualquier modificación optimista previa.
 *
 * La regla arquitectónica es:
 *   optimista local = temporal  →  modifica `optimistic`  →  nunca persiste
 *   reconciliado    = fuente real →  modifica `data`/`yesterday`/`history`   →  aplicado por applyReconciled
 */
class DashboardStore extends ObservableStore<DashboardSnapshot> {
  private data: DashboardData = { ...INITIAL_DATA };
  private yesterday: DashboardMetrics = { ...INITIAL_YESTERDAY };
  private history: DashboardSnapshot["history"] = { ...INITIAL_HISTORY };
  /** Snapshot publicado combina data reconciliada + parche optimista. */
  private optimistic: Partial<DashboardData> = {};

  constructor() {
    super({
      data: { ...INITIAL_DATA },
      yesterday: { ...INITIAL_YESTERDAY },
      history: { ...INITIAL_HISTORY }
    });
  }

  private publishSnapshot() {
    this.publish({
      data: { ...this.data, ...this.optimistic },
      yesterday: { ...this.yesterday },
      history: {
        sales: [...this.history.sales],
        customers: [...this.history.customers],
        orders: [...this.history.orders],
        inventory: [...this.history.inventory]
      }
    });
  }

  /** Devuelve el snapshot tal como lo ve la UI en este instante (data + optimistic). */
  getData(): DashboardData {
    return this.snapshot.data;
  }

  /**
   * Único punto de escritura para `data`, `yesterday` e `history`.
   * Lo llama exclusivamente useDashboardSync.reconcile() con datos ya
   * calculados a partir de ventas/clientes/inventario reales de Supabase.
   *
   * CRÍTICO: al reconciliar, se DESCARTAN todas las modificaciones optimistas
   * previas. Un optimistic patch de un dispositivo no puede sobrevivir
   * después de que la fuente real diga lo contrario.
   */
  applyReconciled(
    data: DashboardData,
    yesterday: DashboardMetrics,
    history: DashboardSnapshot["history"]
  ) {
    this.data = data;
    this.yesterday = yesterday;
    this.history = history;
    this.optimistic = {};
    this.publishSnapshot();
  }

  /**
   * Actualización optimista: modifica SOLO el parche `optimistic`, nunca toca
   * `data` reconciliado. useDashboardSync puede llamar a applyReconciled() en
   * cualquier momento y sobrescribir este parche.
   */
  update(patch: Partial<DashboardData>) {
    this.optimistic = { ...this.optimistic, ...patch };
    this.publishSnapshot();
  }

  addSale(amount: number, products: number = 1, cashPortion: number = 0) {
    this.optimistic = {
      sales: (this.optimistic.sales ?? this.data.sales) + amount,
      todaySales: (this.optimistic.todaySales ?? this.data.todaySales) + amount,
      orders: (this.optimistic.orders ?? this.data.orders) + 1,
      cashAmount: (this.optimistic.cashAmount ?? this.data.cashAmount) + cashPortion,
      productsSold: (this.optimistic.productsSold ?? this.data.productsSold) + products,
      averageTicket:
        (this.optimistic.orders ?? this.data.orders) + 1 > 0
          ? ((this.optimistic.sales ?? this.data.sales) + amount) /
            ((this.optimistic.orders ?? this.data.orders) + 1)
          : 0
    };
    this.publishSnapshot();
  }

  addCustomer() {
    this.optimistic = {
      customers: (this.optimistic.customers ?? this.data.customers) + 1
    };
    this.publishSnapshot();
  }

  /**
   * Revierte el efecto de una venta cancelada o reembolsada. A diferencia
   * de addSale() (que siempre representa una venta nueva y por eso suma 1
   * a `orders`), aquí `orders` se resta, no se suma, y todo se recorta en 0
   * para que una reversión nunca deje contadores negativos en pantalla.
   */
  reverseSale(amount: number, products: number = 1, cashPortion: number = 0) {
    const base = this.optimistic;
    const baseSales = base.sales ?? this.data.sales;
    const baseToday = base.todaySales ?? this.data.todaySales;
    const baseCash = base.cashAmount ?? this.data.cashAmount;
    const baseProducts = base.productsSold ?? this.data.productsSold;
    const baseOrders = base.orders ?? this.data.orders;

    this.optimistic = {
      sales: Math.max(0, baseSales - amount),
      todaySales: Math.max(0, baseToday - amount),
      orders: Math.max(0, baseOrders - 1),
      cashAmount: Math.max(0, baseCash - cashPortion),
      productsSold: Math.max(0, baseProducts - products),
      averageTicket:
        baseOrders > 0 ? Math.max(0, baseSales - amount) / Math.max(1, baseOrders - 1) : 0
    };
    this.publishSnapshot();
  }

  /**
   * Igual que reverseSale(), pero para un reembolso PARCIAL: la venta
   * sigue existiendo (solo se le devolvieron algunos productos, no
   * todos), así que a diferencia de reverseSale() NO se resta 1 de
   * `orders` — la orden como tal no desapareció, solo vale menos.
   */
  partialReverseSale(amount: number, products: number, cashPortion: number = 0) {
    const base = this.optimistic;
    const baseSales = base.sales ?? this.data.sales;
    const baseToday = base.todaySales ?? this.data.todaySales;
    const baseCash = base.cashAmount ?? this.data.cashAmount;
    const baseProducts = base.productsSold ?? this.data.productsSold;
    const baseOrders = base.orders ?? this.data.orders;

    this.optimistic = {
      sales: Math.max(0, baseSales - amount),
      todaySales: Math.max(0, baseToday - amount),
      cashAmount: Math.max(0, baseCash - cashPortion),
      productsSold: Math.max(0, baseProducts - products),
      averageTicket:
        baseOrders > 0 ? Math.max(0, baseSales - amount) / baseOrders : 0
    };
    this.publishSnapshot();
  }

  updateInventory(total: number) {
    this.optimistic = { inventory: total };
    this.publishSnapshot();
  }

  discountInventory(quantity: number) {
    this.optimistic = {
      inventory: Math.max(0, (this.optimistic.inventory ?? this.data.inventory) - quantity)
    };
    this.publishSnapshot();
  }

  updateKitchenPending(total: number) {
    this.optimistic = { pendingKitchen: total };
    this.publishSnapshot();
  }
}

export const dashboardStore = new DashboardStore();
