import { useEffect, useSyncExternalStore } from "react";
import { productCatalogStore } from "./productCatalogStore";

/**
 * Reemplazo de los usos directos de productStore en componentes.
 * Dispara la carga inicial desde InventoryEngine (una sola vez) y se
 * suscribe a los cambios, igual que useCart/useSearch.
 */
export function useProductCatalog() {
  const products = useSyncExternalStore(
    productCatalogStore.subscribe,
    productCatalogStore.getSnapshot
  );

  useEffect(() => {
    productCatalogStore.init();
  }, []);

  return {
    products,
    search: productCatalogStore.search.bind(productCatalogStore),
    getByCategory: productCatalogStore.getByCategory.bind(productCatalogStore),
    getById: productCatalogStore.getById.bind(productCatalogStore),
    getByBarcode: productCatalogStore.getByBarcode.bind(productCatalogStore),
    refresh: productCatalogStore.refresh.bind(productCatalogStore),
  };
}