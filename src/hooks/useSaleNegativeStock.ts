import { useMemo } from "react";
import type { CartItem } from "../core/store/cartStore";
import { useProductCatalog } from "../core/store/useProductCatalog";
import { container } from "../infrastructure/di/CompositionRoot";
import { findSaleNegativeStock, type SaleNegativeStockRow } from "../core/utils/saleNegativeStock";

/**
 * Qué insumos o productos dejaría en negativo la venta que hay en el carrito.
 * Solo lectura y solo informativo (Opción B: la venta nunca se bloquea). Si algo
 * no se puede calcular (producto que ya no está en el catálogo, receta circular),
 * devuelve vacío en vez de romper la Caja.
 */
export function useSaleNegativeStock(items: readonly CartItem[]): SaleNegativeStockRow[] {
  const { products } = useProductCatalog();

  return useMemo(() => {
    if (items.length === 0 || products.length === 0) return [];
    try {
      const stockItems = items
        .filter((item) => item.quantity > 0)
        .map((item) => ({ productId: item.id, quantity: item.quantity }));
      const consumption = container.inventoryEngine.get().previewSaleConsumption(stockItems, products);
      return findSaleNegativeStock(consumption, products);
    } catch {
      return [];
    }
  }, [items, products]);
}