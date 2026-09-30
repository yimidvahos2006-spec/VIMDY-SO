import { ObservableStore } from "./ObservableStore";

export type DashboardCashStatus = "CLOSED" | "OPEN" | "NO_SHIFT";
export type DashboardInventoryValuationStatus = "COMPLETE" | "INCOMPLETE" | "NO_STOCK_TRACKING";
export type DashboardInventoryValueBasis = "RETAIL_PRICE" | "PURCHASE_COST" | "UNAVAILABLE";

export interface DashboardData {
  sales: number;
  customers: number;
  orders: number;
  /** Current inventory valuation. The UI must consult valuation metadata before presenting it as money. */
  inventory: number;
  todaySales: number;
  /** Backward-compatible field. This is reconciled current cash/closing cash, not sale cash movement. */
  cashAmount: number;
  productsSold: number;
  averageTicket: number;
  pendingKitchen: number;
  cashStatus: DashboardCashStatus;
  cashExpectedAmount: number | null;
  cashCountedAmount: number | null;
  cashDifference: number | null;
  cashClosedAt: string | null;
  inventoryValuationStatus: DashboardInventoryValuationStatus;
  inventoryValueBasis: DashboardInventoryValueBasis;
  inventoryLowStockCount: number;
  inventoryHistoricalValueAvailable: boolean;
  /** Comparable elapsed-period references; optional for backward compatibility with existing callers. */
  salesComparablePrevious?: number | null;
  transactionsComparablePrevious?: number | null;
  averageSaleComparablePrevious?: number | null;
  comparisonGeneratedAt?: string | null;
}

export interface DashboardMetrics {
  sales: number;
  customers: number;
  orders: number;
  inventory: number | null;
}

export interface DashboardSnapshot {
  data: DashboardData;
  yesterday: DashboardMetrics;
  history: {
    sales: number[];
    customers: number[];
    orders: number[];
    inventory: Array<number | null>;
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
  pendingKitchen: 0,
  cashStatus: "NO_SHIFT",
  cashExpectedAmount: null,
  cashCountedAmount: null,
  cashDifference: null,
  cashClosedAt: null,
  inventoryValuationStatus: "NO_STOCK_TRACKING",
  inventoryValueBasis: "UNAVAILABLE",
  inventoryLowStockCount: 0,
  inventoryHistoricalValueAvailable: false,
  salesComparablePrevious: null,
  transactionsComparablePrevious: null,
  averageSaleComparablePrevious: null,
  comparisonGeneratedAt: null,
};

const INITIAL_YESTERDAY: DashboardMetrics = { sales: 0, customers: 0, orders: 0, inventory: null };
const INITIAL_HISTORY: DashboardSnapshot["history"] = { sales: [], customers: [], orders: [], inventory: [] };

class DashboardStore extends ObservableStore<DashboardSnapshot> {
  private data: DashboardData = { ...INITIAL_DATA };
  private yesterday: DashboardMetrics = { ...INITIAL_YESTERDAY };
  private history: DashboardSnapshot["history"] = { ...INITIAL_HISTORY };
  private optimistic: Partial<DashboardData> = {};

  constructor() {
    super({ data: { ...INITIAL_DATA }, yesterday: { ...INITIAL_YESTERDAY }, history: { ...INITIAL_HISTORY } });
  }

  private publishSnapshot(): void {
    this.publish({
      data: { ...this.data, ...this.optimistic },
      yesterday: { ...this.yesterday },
      history: {
        sales: [...this.history.sales],
        customers: [...this.history.customers],
        orders: [...this.history.orders],
        inventory: [...this.history.inventory],
      },
    });
  }

  getData(): DashboardData {
    return this.snapshot.data;
  }

  applyReconciled(
    data: DashboardData,
    yesterday: DashboardMetrics,
    history: DashboardSnapshot["history"],
  ): void {
    this.data = { ...data };
    this.yesterday = { ...yesterday };
    this.history = {
      sales: [...history.sales],
      customers: [...history.customers],
      orders: [...history.orders],
      inventory: [...history.inventory],
    };
    this.optimistic = {};
    this.publishSnapshot();
  }

  update(patch: Partial<DashboardData>): void {
    this.optimistic = { ...this.optimistic, ...patch };
    this.publishSnapshot();
  }

  /**
   * Optimistic compatibility hook used by existing checkout/SalesEngine code.
   * Cash is deliberately NOT adjusted here: the authoritative cash state is
   * the reconciliation/shift state, not a client-side increment.
   */
  addSale(amount: number, products: number = 1, _legacyCashPortion: number = 0): void {
    const baseOrders = this.optimistic.orders ?? this.data.orders;
    const baseSales = this.optimistic.sales ?? this.data.sales;
    this.optimistic = {
      ...this.optimistic,
      sales: baseSales + amount,
      todaySales: (this.optimistic.todaySales ?? this.data.todaySales) + amount,
      orders: baseOrders + 1,
      productsSold: (this.optimistic.productsSold ?? this.data.productsSold) + products,
      averageTicket: baseSales + amount > 0 && baseOrders + 1 > 0 ? (baseSales + amount) / (baseOrders + 1) : 0,
    };
    this.publishSnapshot();
  }

  addCustomer(): void {
    this.optimistic = { customers: (this.optimistic.customers ?? this.data.customers) + 1 };
    this.publishSnapshot();
  }

  reverseSale(amount: number, products: number = 1, _legacyCashPortion: number = 0): void {
    const baseSales = this.optimistic.sales ?? this.data.sales;
    const baseToday = this.optimistic.todaySales ?? this.data.todaySales;
    const baseProducts = this.optimistic.productsSold ?? this.data.productsSold;
    const baseOrders = this.optimistic.orders ?? this.data.orders;
    const nextSales = Math.max(0, baseSales - amount);
    const nextOrders = Math.max(0, baseOrders - 1);
    this.optimistic = {
      ...this.optimistic,
      sales: nextSales,
      todaySales: Math.max(0, baseToday - amount),
      orders: nextOrders,
      productsSold: Math.max(0, baseProducts - products),
      averageTicket: nextOrders > 0 ? nextSales / nextOrders : 0,
    };
    this.publishSnapshot();
  }

  partialReverseSale(amount: number, products: number, _legacyCashPortion: number = 0): void {
    const baseSales = this.optimistic.sales ?? this.data.sales;
    const baseToday = this.optimistic.todaySales ?? this.data.todaySales;
    const baseProducts = this.optimistic.productsSold ?? this.data.productsSold;
    const baseOrders = this.optimistic.orders ?? this.data.orders;
    const nextSales = Math.max(0, baseSales - amount);
    this.optimistic = {
      ...this.optimistic,
      sales: nextSales,
      todaySales: Math.max(0, baseToday - amount),
      productsSold: Math.max(0, baseProducts - products),
      averageTicket: baseOrders > 0 ? nextSales / baseOrders : 0,
    };
    this.publishSnapshot();
  }

  updateInventory(total: number): void {
    this.optimistic = { inventory: total };
    this.publishSnapshot();
  }

  discountInventory(quantity: number): void {
    this.optimistic = { inventory: Math.max(0, (this.optimistic.inventory ?? this.data.inventory) - quantity) };
    this.publishSnapshot();
  }

  updateKitchenPending(total: number): void {
    this.optimistic = { pendingKitchen: total };
    this.publishSnapshot();
  }
}

export const dashboardStore = new DashboardStore();
