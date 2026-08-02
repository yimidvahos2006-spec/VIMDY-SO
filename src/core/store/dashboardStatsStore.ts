export interface DashboardStats {

  sales: number;

  orders: number;

  customers: number;

  products: number;

  inventory: number;

  pendingKitchen: number;

  cash: number;

}

class DashboardStatsStore {

  private stats: DashboardStats = {

    sales: 0,

    orders: 0,

    customers: 0,

    products: 0,

    inventory: 0,

    pendingKitchen: 0,

    cash: 0

  };

  get() {

    return { ...this.stats };

  }

  update(data: Partial<DashboardStats>) {

    this.stats = {

      ...this.stats,

      ...data

    };

  }

  addSale(amount: number) {

    this.stats.sales += amount;

    this.stats.orders++;

  }

  addCustomer() {

    this.stats.customers++;

  }

  addProducts(quantity: number) {

    this.stats.products += quantity;

  }

  setInventory(total: number) {

    this.stats.inventory = total;

  }

  setPendingKitchen(total: number) {

    this.stats.pendingKitchen = total;

  }

  setCash(amount: number) {

    this.stats.cash = amount;

  }

  reset() {

    this.stats = {

      sales: 0,

      orders: 0,

      customers: 0,

      products: 0,

      inventory: 0,

      pendingKitchen: 0,

      cash: 0

    };

  }

}

export const dashboardStatsStore = new DashboardStatsStore();