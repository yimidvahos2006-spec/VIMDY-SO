import { useState, useCallback } from "react";

import { startSpeechRecognition, SpeechResult } from "./speechRecognition";

import { parseVoice, VoiceOrder } from "./voiceParser";

import { matchVoiceOrders } from "./voiceMatcher";

export interface VoiceProcessResult {

  success: boolean;

  added: string[];

  notFound: string[];

}

export interface UseVoiceOrderOptions {

  onSuccess?: (result: VoiceProcessResult) => void;

  onError?: (error: string) => void;

  /** Handler personalizado para agregar items. Si no se provee, no hace nada. */

  onAddItem?: (order: VoiceOrder, match: { product: { id: string; name: string; price: number } }) => void;

}

export function useVoiceOrder(options: UseVoiceOrderOptions = {}) {

  const [listening, setListening] = useState(false);

  const [result, setResult] = useState<VoiceProcessResult | null>(null);

  const listen = useCallback(async (): Promise<VoiceProcessResult | null> => {

    setListening(true);

    setResult(null);

    try {

      const speech: SpeechResult = await startSpeechRecognition();

      if (!speech.success || !speech.text.trim()) {

        const error = speech.error ?? "No se reconoció ninguna orden.";

        options.onError?.(error);

        setResult({ success: false, added: [], notFound: [] });

        return null;

      }

      const orders = parseVoice(speech.text);

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

        options.onAddItem?.({ ...order, note }, match);

        const noteText = note ? ` (${note})` : "";

        added.push(

          `${match.quantity} x ${match.product.name}${noteText}`

        );

      });

      const processed: VoiceProcessResult = {

        success: added.length > 0,

        added,

        notFound

      };

      setResult(processed);

      if (processed.success) {

        options.onSuccess?.(processed);

      } else if (processed.notFound.length > 0) {

        options.onError?.(

          `No se encontraron: ${processed.notFound.join(", ")}`

        );

      }

      return processed;

    } finally {

      setListening(false);

    }

  }, [options]);

  return {

    listening,

    result,

    listen

  };

}
