import { productCatalogStore } from "../store/productCatalogStore";
import { Product } from "../entities/Entities";
import { VoiceOrder } from "./voiceParser";

export interface VoiceMatch {

  product: Product;

  quantity: number;

}

export function matchVoiceOrders(
  orders: VoiceOrder[]
): VoiceMatch[] {

  const matches: VoiceMatch[] = [];

  const products = productCatalogStore.getSnapshot();

  for (const order of orders) {

    const text = order.product.toLowerCase();

    const product = products.find(p => {

      if (
        p.name.toLowerCase().includes(text)
      ) {
        return true;
      }

      if (
        text.includes(p.name.toLowerCase())
      ) {
        return true;
      }

      if (
        p.aliases?.some(alias =>
          alias.toLowerCase().includes(text) ||
          text.includes(alias.toLowerCase())
        )
      ) {
        return true;
      }

      return false;

    });

    if (product) {

      matches.push({

        product,

        quantity: order.quantity

      });

    }

  }

  return matches;

}