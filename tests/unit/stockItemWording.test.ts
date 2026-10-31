import { describe, expect, it } from "vitest";
import {
  countItemTypes,
  describeItemCounts,
  isInsumoItem
} from "../../src/core/utils/stockItemWording";
import { buildPurchaseSummary } from "../../src/core/domain/notifications/purchaseAlertSummary";
import { BusinessAnalyzer } from "../../src/core/engines/BusinessAnalyzer";

const alertsFor = (out: { products: number; insumos: number }, low: { products: number; insumos: number }) => {
  const generate = (BusinessAnalyzer.prototype as unknown as {
    generateSmartAlerts: (input: Record<string, unknown>) => { message: string }[];
  }).generateSmartAlerts;
  return generate.call({}, {
    outOfStockCount: out.products + out.insumos,
    lowStockCount: low.products + low.insumos,
    outOfStockByType: out,
    lowStockByType: low,
    salesGrowthPercent: 0,
    todaySalesCount: 0,
    delayedOrdersCount: 0,
    kitchenPendingCount: 0,
    cashToday: 0,
    todaySales: 0,
    dailySalesGoal: 0
  }).map((a) => a.message);
};

describe("terminología de ítems de inventario", () => {
  it("detecta insumos por isIngredient", () => {
    expect(isInsumoItem({ isIngredient: true })).toBe(true);
    expect(isInsumoItem({ isIngredient: false })).toBe(false);
    expect(isInsumoItem({})).toBe(false);
    expect(countItemTypes([{ isIngredient: true }, {}, { isIngredient: true }])).toEqual({ products: 1, insumos: 2 });
  });

  it("describe los conteos según el tipo", () => {
    expect(describeItemCounts({ products: 3, insumos: 0 })).toBe("3 producto(s)");
    expect(describeItemCounts({ products: 0, insumos: 2 })).toBe("2 insumo(s)");
    expect(describeItemCounts({ products: 2, insumos: 3 })).toBe("2 producto(s) y 3 insumo(s)");
    expect(describeItemCounts({ products: 1, insumos: 1 }, "plain")).toBe("1 producto y 1 insumo");
    expect(describeItemCounts({ products: 0, insumos: 4 }, "plain")).toBe("4 insumos");
  });
});

describe("alertas inteligentes de stock con terminología precisa", () => {
  it("solo insumos agotados → 'insumo(s)'", () => {
    const [msg] = alertsFor({ products: 0, insumos: 2 }, { products: 0, insumos: 0 });
    expect(msg).toBe("Tienes 2 insumo(s) agotado(s). Repón cuanto antes para no perder ventas.");
  });

  it("solo productos → conserva 'producto(s)'", () => {
    const [msg] = alertsFor({ products: 3, insumos: 0 }, { products: 0, insumos: 0 });
    expect(msg).toBe("Tienes 3 producto(s) agotado(s). Repón cuanto antes para no perder ventas.");
  });

  it("mezcla de ambos en stock bajo", () => {
    const msgs = alertsFor({ products: 0, insumos: 0 }, { products: 2, insumos: 3 });
    expect(msgs).toContain("Tienes 2 producto(s) y 3 insumo(s) con stock bajo. Revísalos antes de que se agoten.");
  });
});

describe("resumen de reposición con terminología precisa", () => {
  const rec = (name: string, extra: Record<string, unknown> = {}) => ({
    productId: name, productName: name, currentStock: 0, recommendedPurchase: 5, priority: "CRITICAL" as const, ...extra
  });

  it("un insumo se nombra como insumo", () => {
    expect(buildPurchaseSummary([rec("Lechuga", { isIngredient: true })])?.message)
      .toBe('Reponer stock del insumo "Lechuga" (🔴 Agotado).');
  });

  it("varios insumos", () => {
    expect(buildPurchaseSummary([rec("A", { isIngredient: true }), rec("B", { isIngredient: true })])?.message)
      .toBe('Reponer stock de 2 insumos: "A" y "B" (🔴 2 agotados).');
  });

  it("mezcla de producto e insumos", () => {
    expect(buildPurchaseSummary([rec("Gaseosa"), rec("Harina", { isIngredient: true }), rec("Queso", { isIngredient: true })])?.message)
      .toBe('Reponer stock de 1 producto y 2 insumos: "Gaseosa", "Harina" y "Queso" (🔴 3 agotados).');
  });
});