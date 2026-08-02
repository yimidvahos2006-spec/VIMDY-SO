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
 * ANTES: persistía `data`, `yesterday` e `history` en localStorage
 * (STORAGE_KEY = "vimdy_dashboard_state_v1") y calculaba el cambio de día
 * comparando contra lo que EL MISMO navegador tenía guardado. Eso rompía
 * la sincronización entre dispositivos de dos formas: (1) dos computadores
 * del mismo negocio podían mostrar un % de tendencia distinto porque cada
 * uno detectaba el "cierre del día" en un momento distinto, con datos
 * potencialmente desactualizados; y (2) en un navegador compartido entre
 * negocios (kiosko, PC de pruebas), un negocio podía llegar a ver por un
 * instante las cifras que dejó guardadas el negocio anterior.
 *
 * AHORA: es un cache 100% en memoria, sin persistencia. La fuente de
 * verdad real vive en Supabase — useDashboardSync.ts la consulta
 * (SalesEngine / CustomerEngine / InventoryEngine / KitchenService) al
 * montar la app y cada vez que llega un evento "sale"/"customer"/
 * "inventory"/"kitchen" del bus interno (incluyendo los que dispara
 * realtimeSync.ts cuando OTRO dispositivo hizo el cambio), calcula
 * `yesterday` e `history` con datos reales y los escribe aquí con
 * applyReconciled(). Todos los dispositivos del mismo negocio terminan
 * viendo exactamente los mismos números, siempre.
 *
 * Los métodos addSale/reverseSale/addCustomer/updateInventory/
 * updateKitchenPending (llamados desde checkout.ts y SalesEngine.ts) solo
 * dan una respuesta optimista instantánea en ESTE dispositivo mientras
 * useDashboardSync termina de reconciliar con el dato real — nunca se
 * guardan en ningún lado, así que jamás quedan "pegados" entre sesiones.
 */
class DashboardStore extends ObservableStore<DashboardSnapshot> {
  private data: DashboardData = { ...INITIAL_DATA };
  private yesterday: DashboardMetrics = { ...INITIAL_YESTERDAY };
  private history: DashboardSnapshot["history"] = { ...INITIAL_HISTORY };

  constructor() {
    super({
      data: { ...INITIAL_DATA },
      yesterday: { ...INITIAL_YESTERDAY },
      history: { ...INITIAL_HISTORY }
    });
  }

  private publishSnapshot() {
    this.publish({
      data: { ...this.data },
      yesterday: { ...this.yesterday },
      history: {
        sales: [...this.history.sales],
        customers: [...this.history.customers],
        orders: [...this.history.orders],
        inventory: [...this.history.inventory]
      }
    });
  }

  getData(): DashboardData {
    return this.snapshot.data;
  }

  /**
   * Único punto de escritura para `yesterday` e `history`. Lo llama
   * exclusivamente useDashboardSync.reconcile() con datos ya calculados
   * a partir de ventas/clientes/inventario reales de Supabase.
   */
  applyReconciled(
    data: DashboardData,
    yesterday: DashboardMetrics,
    history: DashboardSnapshot["history"]
  ) {
    this.data = data;
    this.yesterday = yesterday;
    this.history = history;
    this.publishSnapshot();
  }

  update(data: Partial<DashboardData>) {
    this.data = { ...this.data, ...data };
    this.publishSnapshot();
  }

  addSale(amount: number, products: number = 1) {
    this.data.sales += amount;
    this.data.todaySales += amount;
    this.data.orders++;
    this.data.cashAmount += amount;
    this.data.productsSold += products;

    this.data.averageTicket =
      this.data.orders > 0 ? this.data.sales / this.data.orders : 0;

    this.publishSnapshot();
  }

  addCustomer() {
    this.data.customers++;
    this.publishSnapshot();
  }

  /**
   * Revierte el efecto de una venta cancelada o reembolsada. A diferencia
   * de addSale() (que siempre representa una venta nueva y por eso suma 1
   * a `orders`), aquí `orders` se resta, no se suma, y todo se recorta en 0
   * para que una reversión nunca deje contadores negativos en pantalla.
   */
  reverseSale(amount: number, products: number = 1) {
    this.data.sales = Math.max(0, this.data.sales - amount);
    this.data.todaySales = Math.max(0, this.data.todaySales - amount);
    this.data.orders = Math.max(0, this.data.orders - 1);
    this.data.cashAmount = Math.max(0, this.data.cashAmount - amount);
    this.data.productsSold = Math.max(0, this.data.productsSold - products);

    this.data.averageTicket =
      this.data.orders > 0 ? this.data.sales / this.data.orders : 0;

    this.publishSnapshot();
  }

  /**
   * Igual que reverseSale(), pero para un reembolso PARCIAL: la venta
   * sigue existiendo (solo se le devolvieron algunos productos, no
   * todos), así que a diferencia de reverseSale() NO se resta 1 de
   * `orders` — la orden como tal no desapareció, solo vale menos.
   */
  partialReverseSale(amount: number, products: number) {
    this.data.sales = Math.max(0, this.data.sales - amount);
    this.data.todaySales = Math.max(0, this.data.todaySales - amount);
    this.data.cashAmount = Math.max(0, this.data.cashAmount - amount);
    this.data.productsSold = Math.max(0, this.data.productsSold - products);

    this.data.averageTicket =
      this.data.orders > 0 ? this.data.sales / this.data.orders : 0;

    this.publishSnapshot();
  }

  updateInventory(total: number) {
    this.data.inventory = total;
    this.publishSnapshot();
  }

  // Compatibilidad con dashboardSync.ts
  discountInventory(quantity: number) {
    this.data.inventory = Math.max(0, this.data.inventory - quantity);
    this.publishSnapshot();
  }

  updateKitchenPending(total: number) {
    this.data.pendingKitchen = total;
    this.publishSnapshot();
  }
}

export const dashboardStore = new DashboardStore();