import { useEffect } from "react";
import { commandIntentStore, CommandIntentType, CommandIntent } from "../core/store/commandIntentStore";

/**
 * Suscribe una pantalla a un tipo de comando del Copiloto. Revisa el intent
 * pendiente tanto al montar (cuando el Copiloto acaba de navegar a esta
 * página) como en cada cambio del store (cuando el usuario ya estaba en la
 * página y solo pidió el comando desde el chat).
 *
 * Ejemplo (InventoryDashboard.tsx):
 *   useCommandIntent("OPEN_NEW_PRODUCT", () => setShowNewProduct(true));
 */
export function useCommandIntent(
  type: CommandIntentType,
  handler: (intent: CommandIntent) => void
) {
  useEffect(() => {
    const check = () => {
      const intent = commandIntentStore.consume(type);
      if (intent) handler(intent);
    };

    check();

    const unsubscribe = commandIntentStore.subscribe(check);
    return unsubscribe;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type]);
}