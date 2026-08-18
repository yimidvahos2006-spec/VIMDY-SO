import { cartStore } from "../store/cartStore";
import { parseVoice } from "./voiceParser";
import { matchVoiceOrders } from "./voiceMatcher";

export interface VoiceProcessResult {

  success: boolean;

  added: string[];

  notFound: string[];

}

export function processVoice(text: string): VoiceProcessResult {

  const orders = parseVoice(text);

  const matches = matchVoiceOrders(orders);

  const added: string[] = [];

  const notFound: string[] = [];

  orders.forEach(order => {

    const match = matches.find(

      item => item.product.name === order.product ||

        item.product.aliases?.includes(order.product)

    );

    if (!match) {

      notFound.push(order.product);

      return;

    }

    const note = order.modifiers.length > 0 ? order.modifiers.join(", ") : undefined;

    for (let i = 0; i < match.quantity; i++) {

      cartStore.add({

        id: match.product.id,

        name: match.product.name,

        price: match.product.price,

        note

      });

    }

    const noteText = note ? ` (${note})` : "";

    added.push(

      `${match.quantity} x ${match.product.name}${noteText}`

    );

  });

  return {

    success: added.length > 0,

    added,

    notFound

  };

}