import { ObservableStore } from "./ObservableStore";
import type { ProductSizeOption, ProductExtraOption } from "../entities/Entities";

export interface VariantSelectorProduct {
  readonly id: string;
  readonly name: string;
  readonly price: number;
  readonly requiresKitchen?: boolean;
  readonly sizes?: readonly ProductSizeOption[];
  readonly extras?: readonly ProductExtraOption[];
}

export interface VariantSelectorState {
  readonly product: VariantSelectorProduct | null;
}

const INITIAL_STATE: VariantSelectorState = {
  product: null
};

class VariantSelectorStore extends ObservableStore<VariantSelectorState> {
  constructor() {
    super({ ...INITIAL_STATE });
  }

  needsSelector(product: {
    sizes?: readonly ProductSizeOption[];
    extras?: readonly ProductExtraOption[];
  }): boolean {
    return (product.sizes?.length ?? 0) > 0 || (product.extras?.length ?? 0) > 0;
  }

  open(product: VariantSelectorProduct) {
    this.publish({ product });
  }

  close() {
    this.publish({ ...INITIAL_STATE });
  }
}

export const variantSelectorStore = new VariantSelectorStore();
