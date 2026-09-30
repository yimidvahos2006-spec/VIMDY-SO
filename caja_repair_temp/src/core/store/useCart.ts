import { useSyncExternalStore } from "react";
import { cartStore } from "./cartStore";

/**
 * Antes: sondeaba cartStore cada 150ms con setInterval, forzando un
 * re-render de PosCart/PosProducts/PosPayment ~6-7 veces por segundo
 * aunque el carrito no hubiera cambiado.
 *
 * Ahora: se suscribe al store y React solo re-renderiza cuando el
 * carrito realmente cambia (add/remove/increase/decrease/clear).
 */
export function useCart() {
  const items = useSyncExternalStore(cartStore.subscribe, cartStore.getSnapshot);

  return {
    items,
    total: cartStore.getTotal(),
    count: cartStore.getCount(),
    add: cartStore.add.bind(cartStore),
    remove: cartStore.remove.bind(cartStore),
    increase: cartStore.increase.bind(cartStore),
    decrease: cartStore.decrease.bind(cartStore),
    setQuantity: cartStore.setQuantity.bind(cartStore),
    updateNote: cartStore.updateNote.bind(cartStore),
    clear: cartStore.clear.bind(cartStore)
  };
}