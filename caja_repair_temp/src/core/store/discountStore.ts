export interface Discount {

  type: "percentage" | "fixed";

  value: number;

}

class DiscountStore {

  private discount: Discount = {

    type: "fixed",

    value: 0

  };

  get() {

    return this.discount;

  }

  set(discount: Discount) {

    this.discount = discount;

  }

  clear() {

    this.discount = {

      type: "fixed",

      value: 0

    };

  }

}

export const discountStore = new DiscountStore();