import { useSyncExternalStore } from "react";
import { searchStore } from "./searchStore";

/**
 * Antes: sondeaba searchStore cada 150ms con setInterval.
 * Ahora: se suscribe y solo re-renderiza cuando el texto de búsqueda
 * realmente cambia (al escribir o al limpiar).
 */
export function useSearch() {
  const value = useSyncExternalStore(searchStore.subscribe, searchStore.getSnapshot);

  const update = (text: string) => {
    searchStore.set(text);
  };

  const clear = () => {
    searchStore.clear();
  };

  return {
    value,
    update,
    clear
  };
}