import { describe, expect, it } from "vitest";
import type { Product } from "../../src/core/entities/Entities";
import type { BusinessSnapshot } from "../../src/core/types/CopilotTypes";
import type { BusinessAnalyzer } from "../../src/core/engines/BusinessAnalyzer";
import { AIEngine } from "../../src/core/engines/AIEngine";
import { AlertEngine } from "../../src/core/engines/AlertEngine";
import { QuestionRouter } from "../../src/core/engines/QuestionRouter";
import { snapshotToPrompt } from "../../src/application/services/CopilotService";
import { splitByItemType } from "../../src/core/utils/stockItemWording";

const item = (over: Record<string, unknown>) =>
  ({ id: String(over.name), stock: 0, minStock: 0, ...over }) as unknown as Product;

describe("Dashboard · AIEngine distingue insumos de productos", () => {
  const engine = new AIEngine();

  it("un insumo se compra en su unidad y se nombra como insumo", () => {
    const [text] = engine.generatePurchaseRecommendation([
      item({ name: "Harina", isIngredient: true, unit: "kg", stock: 2, minStock: 5 })
    ]);
    expect(text).toBe('Comprar 3 kg del insumo "Harina". Stock actual: 2 kg.');
  });

  it("un insumo no se redondea a unidades enteras", () => {
    const [text] = engine.generatePurchaseRecommendation([
      item({ name: "Queso", isIngredient: true, unit: "kg", stock: 1.5, minStock: 2 })
    ]);
    expect(text).toBe('Comprar 0,5 kg del insumo "Queso". Stock actual: 1,5 kg.');
  });

  it("el producto conserva su texto de siempre", () => {
    const [text] = engine.generatePurchaseRecommendation([
      item({ name: "Gaseosa", stock: 2, minStock: 10 })
    ]);
    expect(text).toBe('Comprar 8 unidades de "Gaseosa". Stock actual: 2.');
  });

  it("con stock enmascarado el insumo se nombra sin cifras", () => {
    const [text] = engine.generatePurchaseRecommendation([
      item({ name: "Harina", isIngredient: true, stockMasked: true, stockStatus: "OUT" })
    ]);
    expect(text).toBe('Reponer el insumo "Harina" (🔴 Agotado).');
  });

  it("un insumo con stock 0 y mínimo 0 sigue sin generar sugerencias vacías", () => {
    const [text] = engine.generatePurchaseRecommendation([
      item({ name: "Lechuga", isIngredient: true, unit: "kg", stock: 0, minStock: 0 })
    ]);
    expect(text).toBe("El inventario está en buen estado. No se requieren compras urgentes.");
  });
});

describe("Dashboard · AlertEngine", () => {
  it("titula los insumos como insumos y deja los productos igual", () => {
    const titles = new AlertEngine()
      .checkStockAlerts([
        item({ name: "Harina", isIngredient: true, stock: 0, minStock: 5 }),
        item({ name: "Queso", isIngredient: true, stock: 2, minStock: 5 }),
        item({ name: "Coca-Cola", stock: 0, minStock: 5 })
      ])
      .map((a) => a.title);
    expect(titles).toEqual(["Insumo Harina agotado", "Insumo Queso con stock bajo", "Coca-Cola agotado"]);
  });
});

const BASE = {
  businessName: "Demo", currency: "COP", generatedAt: "2026-10-30T10:00:00Z",
  todaySales: 0, yesterdaySales: 0, salesGrowthPercent: 0, totalSalesAllTime: 0, totalOrdersToday: 0,
  averageTicketToday: 0, todayProfit: 0, todayTopProduct: null, todayTopEmployee: null,
  outOfStockProducts: [], bestDayOfWeek: null, topProducts: [], topProfitProducts: [], topEmployees: [],
  topRefundingEmployees: [], slowMovers: [], tableTurnover: [], weeklyForecast: null, delayedOrders: [],
  smartAlerts: [], aiRecommendations: [], learnedPatterns: [], purchaseRecommendations: [],
  lowStockProducts: [], productionAlerts: [], purchaseSuggestions: [], starProductCapacity: null,
  outOfStockCount: 0, criticalAlertsCount: 0, kitchenPendingCount: 0, healthScore: 80, healthMessage: "ok",
  lossSummary: { monthLoss: 0, topLossProduct: null, topLossCategory: null },
  forecastSummary: {}, aiInsights: {},
  cash: { balance: 0, todayBalance: 0, openShifts: 0 },
  tableStatus: { free: 0, busy: 0, waitingFood: 0, waitingBill: 0, paying: 0, reserved: 0, total: 0 },
  customerStats: { totalCustomers: 0, newCustomersToday: 0, topCustomers: [] }
};
const snap = (over: Record<string, unknown>) => ({ ...BASE, ...over }) as unknown as BusinessSnapshot;
const ask = (s: BusinessSnapshot, q: string) =>
  new QuestionRouter({ buildSnapshot: async () => s } as unknown as BusinessAnalyzer).answer(q, "Demo", "COP");

const mixed = snap({
  lowStockProducts: [
    { name: "Gaseosa", stock: 1, minStock: 6 },
    { name: "Harina", stock: 2, minStock: 10, isIngredient: true }
  ],
  lowStockByType: { products: 1, insumos: 1 },
  outOfStockCount: 3,
  outOfStockByType: { products: 1, insumos: 2 }
});
const onlyInsumos = snap({
  lowStockProducts: [{ name: "Harina", stock: 2, minStock: 10, isIngredient: true }],
  lowStockByType: { products: 0, insumos: 1 }
});
const onlyProducts = snap({
  lowStockProducts: [{ name: "Gaseosa", stock: 1, minStock: 6 }],
  lowStockByType: { products: 1, insumos: 0 }
});

describe("Copiloto · Gerente Inteligente (QuestionRouter)", () => {
  it("solo productos: texto de siempre", async () => {
    const a = (await ask(onlyProducts, "¿Qué productos se están agotando?")) ?? "";
    expect(a.startsWith("Productos con inventario bajo:")).toBe(true);
  });

  it("solo insumos: los llama insumos", async () => {
    const a = (await ask(onlyInsumos, "¿Qué productos se están agotando?")) ?? "";
    expect(a).toBe("Insumos con inventario bajo:\n- Harina: stock 2 (mínimo 10)");
  });

  it("mezcla: secciones separadas", async () => {
    const a = (await ask(mixed, "¿Qué insumos se están acabando?")) ?? "";
    expect(a).toBe(
      "Inventario bajo:\nProductos:\n- Gaseosa: stock 1 (mínimo 6)\nInsumos:\n- Harina: stock 2 (mínimo 10)"
    );
  });
});

describe("Copiloto · prompt para la IA", () => {
  it("con insumos agrega la terminología y separa por tipo", () => {
    const prompt = snapshotToPrompt(mixed as never);
    expect(prompt).toContain("Productos (se venden en Caja):");
    expect(prompt).toContain("Insumos (materia prima de cocina/bodega):");
    expect(prompt).toContain("TERMINOLOGÍA");
    expect(prompt).toContain("Agotados: 1 producto y 2 insumos");
  });

  it("sin insumos el prompt queda como antes", () => {
    const prompt = snapshotToPrompt(onlyProducts as never);
    expect(prompt).not.toContain("TERMINOLOGÍA");
    expect(prompt).toContain("- Gaseosa: stock actual 1, mínimo 6");
    expect(prompt).toContain("Productos agotados: 0");
  });
});

describe("splitByItemType", () => {
  it("separa conservando el orden", () => {
    const { products, insumos } = splitByItemType([{ n: 1 }, { n: 2, isIngredient: true }, { n: 3 }]);
    expect(products.map((p) => p.n)).toEqual([1, 3]);
    expect(insumos.map((p) => p.n)).toEqual([2]);
  });
});