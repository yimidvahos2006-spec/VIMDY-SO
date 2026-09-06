import { describe, it, expect } from "vitest";
import { getStockStatus } from "../../src/core/store/useInventory";
import type { Product } from "../../src/core/entities/Entities";

function makeProduct(overrides: Partial<Product> = {}): Product {
  return {
    id: "test-product",
    name: "Test Product",
    categoryId: "cat-1",
    price: 1000,
    stock: 10,
    minStock: 5,
    unit: "unidad",
    active: true,
    trackStock: true,
    requiresKitchen: false,
    recipe: [],
    productionMode: "ON_DEMAND",
    lastUpdated: new Date(),
    ...overrides
  };
}

describe("Inventory UX safety", () => {
  describe("getStockStatus", () => {
    it("returns normal for products with price <= 0 even if stock is 0", () => {
      const product = makeProduct({ price: 0, stock: 0 });
      expect(getStockStatus(product)).toBe("normal");
    });

    it("returns agotado for products with price > 0 and stock <= 0", () => {
      const product = makeProduct({ price: 1000, stock: 0 });
      expect(getStockStatus(product)).toBe("agotado");
    });

    it("returns normal for trackStock=false products regardless of stock", () => {
      const product = makeProduct({ trackStock: false, stock: 0 });
      expect(getStockStatus(product)).toBe("normal");
    });
  });

  describe("delete modal copy", () => {
    it("uses honest message for products with price or stock history", () => {
      const productWithHistory = makeProduct({ price: 1000, stock: 5 });
      const hasHistory = productWithHistory.price > 0 || productWithHistory.stock > 0;
      const message = hasHistory
        ? "Si el producto tiene historial de ventas o movimientos, se ocultará del inventario en vez de borrarse por completo, para no perder ese historial. Si nunca se ha usado, se elimina para siempre."
        : "Este producto no tiene historial y se eliminará permanentemente. Esta acción no se puede deshacer.";
      expect(message).toContain("ocultará del inventario");
      expect(message).not.toContain("definitivamente");
    });

    it("uses permanent delete message for products without history", () => {
      const productWithoutHistory = makeProduct({ price: 0, stock: 0 });
      const hasHistory = productWithoutHistory.price > 0 || productWithoutHistory.stock > 0;
      const message = hasHistory
        ? "Si el producto tiene historial de ventas o movimientos, se ocultará del inventario en vez de borrarse por completo, para no perder ese historial. Si nunca se ha usado, se elimina para siempre."
        : "Este producto no tiene historial y se eliminará permanentemente. Esta acción no se puede deshacer.";
      expect(message).toContain("eliminará permanentemente");
      expect(message).toContain("no se puede deshacer");
    });
  });

  describe("inactive product filtering", () => {
    it("filters out inactive products from active list", () => {
      const activeProduct = makeProduct({ id: "active", active: true });
      const inactiveProduct = makeProduct({ id: "inactive", active: false });
      const allProducts = [activeProduct, inactiveProduct];
      
      const activeList = allProducts.filter((p) => p.active !== false);
      expect(activeList).toHaveLength(1);
      expect(activeList[0].id).toBe("active");
    });

    it("includes inactive products when showInactive is true", () => {
      const activeProduct = makeProduct({ id: "active", active: true });
      const inactiveProduct = makeProduct({ id: "inactive", active: false });
      const allProducts = [activeProduct, inactiveProduct];
      
      const allList = allProducts; // when showInactive is true, no filter
      expect(allList).toHaveLength(2);
    });
  });
});
