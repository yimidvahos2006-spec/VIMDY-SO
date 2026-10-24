import { describe, expect, it } from "vitest";
import type { Product } from "../../src/core/entities/Entities";
import {
  describeStock,
  hasMaskedStock,
  isStockMasked,
  maskedStockStatus,
  stockCoversQuantity,
  stockMaskBadge
} from "../../src/core/utils/stockMask";

const product = (over: Partial<Product>): Product =>
  ({ id: "p", name: "P", stock: 10, minStock: 3, ...over }) as Product;

describe("stockMask · estado amigable con stock enmascarado", () => {
  it("detecta productos enmascarados", () => {
    expect(isStockMasked(product({ stockMasked: true }))).toBe(true);
    expect(isStockMasked(product({}))).toBe(false);
    expect(isStockMasked(null)).toBe(false);
    expect(hasMaskedStock([product({}), product({ stockMasked: true })])).toBe(true);
    expect(hasMaskedStock([product({})])).toBe(false);
  });

  it("usa el estado del servidor y, si falta, lo deriva de la banda", () => {
    expect(maskedStockStatus(product({ stockStatus: "LOW", stock: 99 }))).toBe("LOW");
    expect(maskedStockStatus(product({ stock: 0 }))).toBe("OUT");
    expect(maskedStockStatus(product({ stock: 3 }))).toBe("LOW");
    expect(maskedStockStatus(product({ stock: 4 }))).toBe("AVAILABLE");
  });

  it("el badge trae emoji y texto, nunca una cifra", () => {
    expect(stockMaskBadge(product({ stockStatus: "AVAILABLE" })).text).toBe("🟢 Disponible");
    expect(stockMaskBadge(product({ stockStatus: "LOW" })).text).toBe("🟡 Stock bajo");
    expect(stockMaskBadge(product({ stockStatus: "OUT" })).text).toBe("🔴 Agotado");
  });

  it("enmascarado solo rechaza la venta si está agotado (la banda no sirve para cantidades)", () => {
    expect(stockCoversQuantity(product({ stockMasked: true, stockStatus: "AVAILABLE", stock: 4 }), 50)).toBe(true);
    expect(stockCoversQuantity(product({ stockMasked: true, stockStatus: "OUT", stock: 0 }), 1)).toBe(false);
    expect(stockCoversQuantity(product({ stock: 4 }), 5)).toBe(false);
    expect(stockCoversQuantity(product({ stock: 5 }), 5)).toBe(true);
  });

  it("describeStock muestra la cifra real o el estado si está enmascarado", () => {
    expect(describeStock(product({ stock: 10 }), "10 kg")).toBe("10 kg");
    expect(describeStock(product({ stockMasked: true, stockStatus: "OUT", stock: 0 }), "0 kg")).toBe("🔴 Agotado");
  });
});