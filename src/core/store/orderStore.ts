export interface OrderTotals {

  subtotal: number;

  discount: number;

  tax: number;

  total: number;

}

class OrderStore {

  private totals: OrderTotals = {

    subtotal: 0,

    discount: 0,

    tax: 0,

    total: 0

  };

  get() {

    return this.totals;

  }

  update(values: OrderTotals) {

    this.totals = values;

  }

}

export const orderStore = new OrderStore();