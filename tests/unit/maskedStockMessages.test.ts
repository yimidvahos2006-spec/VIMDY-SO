import { describe, expect, it } from "vitest";
import type { BusinessSnapshot } from "../../src/core/types/CopilotTypes";
import type { Product } from "../../src/core/entities/Entities";
import type { BusinessAnalyzer } from "../../src/core/engines/BusinessAnalyzer";
import { QuestionRouter } from "../../src/core/engines/QuestionRouter";
import { AIEngine } from "../../src/core/engines/AIEngine";
import { InventoryAI } from "../../src/core/ia/InventoryAI";
import { snapshotToPrompt } from "../../src/application/services/CopilotService";
import { buildManagerPriorities } from "../../src/presentation/components/dashboard/managerPriorities";

/**
 * Conteo a ciegas: mientras el stock llega enmascarado, ningún mensaje de la IA, del Copilot
 * ni de los feeds puede llevar una cifra de stock (ni derivada: días, cantidad a comprar,
 * capacidad de producción). Solo el estado: 🟢 Disponible / 🟡 Stock bajo / 🔴 Agotado.
 * Los números de más abajo son "valores de banda": si aparecieran en un texto, sería una fuga.
 */

const SNAPSHOT_BASE = {
  businessName: "Demo",
  currency: "COP",
  generatedAt: "2026-10-24T10:00:00Z",
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

const snapshot = (over: Record<string, unknown>) => ({ ...SNAPSHOT_BASE, ...over }) as unknown as BusinessSnapshot;
const ask = (s: BusinessSnapshot, question: string) =>
  new QuestionRouter({ buildSnapshot: async () => s } as unknown as BusinessAnalyzer).answer(question, "Demo", "COP");

const maskedSnapshot = snapshot({
  stockMasked: true,
  lowStockProducts: [{ name: "Harina", stock: 0, minStock: 0, stockMasked: true, stockStatus: "LOW" }],
  purchaseSuggestions: [
    { productId: "h", name: "Harina", currentStock: 0, avgDailySales: 2, daysUntilStockout: null, suggestedQuantity: 0, hasSalesHistory: true, stockMasked: true, stockStatus: "LOW" }
  ],
  productionAlerts: [
    { productId: "p", productName: "Pan", status: "DISPONIBLE", level: "ADVERTENCIA", maxUnits: 0, limitingIngredientName: "Harina", stockMasked: true },
    { productId: "q", productName: "Torta", status: "AGOTADO", level: "CRITICO", maxUnits: 0, limitingIngredientName: "Huevos", stockMasked: true }
  ]
});

const realSnapshot = snapshot({
  lowStockProducts: [{ name: "Harina", stock: 7, minStock: 10 }],
  purchaseSuggestions: [
    { productId: "h", name: "Harina", currentStock: 7, avgDailySales: 2, daysUntilStockout: 3, suggestedQuantity: 20, hasSalesHistory: true }
  ],
  productionAlerts: [
    { productId: "p", productName: "Pan", status: "DISPONIBLE", level: "ADVERTENCIA", maxUnits: 12, limitingIngredientName: "Harina" }
  ]
});

describe("QuestionRouter con stock enmascarado", () => {
  it("'qué productos se están agotando' muestra el estado, sin cifras", async () => {
    const answer = (await ask(maskedSnapshot, "¿Qué productos se están agotando?")) ?? "";
    expect(answer).toContain("Harina: 🟡 Stock bajo");
    expect(answer).not.toMatch(/\d/);
  });

  it("'qué debo comprar' no da cantidades ni días", async () => {
    const answer = (await ask(maskedSnapshot, "¿Qué debo comprar?")) ?? "";
    expect(answer).toContain("🟡 Stock bajo");
    expect(answer).not.toMatch(/comprar \d|\d unidades|~\d|día\(s\)/);
  });

  it("'qué puedo preparar' no da unidades, pero sí dice cuando no se puede preparar nada", async () => {
    const answer = (await ask(maskedSnapshot, "¿Qué puedo preparar?")) ?? "";
    expect(answer).toContain("Pan: tu capacidad está limitada");
    expect(answer).toContain("Torta: no puedes preparar ninguna unidad");
    expect(answer).not.toMatch(/puedes preparar \d/);
  });

  it("sin enmascarar sigue dando las cifras de siempre", async () => {
    expect(await ask(realSnapshot, "¿Qué productos se están agotando?")).toContain("stock 7 (mínimo 10)");
    expect(await ask(realSnapshot, "¿Qué debo comprar?")).toContain("comprar 20 unidades");
    expect(await ask(realSnapshot, "¿Qué puedo preparar?")).toContain("puedes preparar 12 unidad(es)");
  });
});

describe("Prompt del Copilot (lo que se envía a la IA externa)", () => {
  it("con stock enmascarado avisa que no hay cantidades y no manda cifras de stock", () => {
    const prompt = snapshotToPrompt(maskedSnapshot as never);
    expect(prompt).toContain("conteo de inventario a ciegas");
    expect(prompt).toContain("Harina: 🟡 Stock bajo");
    expect(prompt).not.toMatch(/stock actual|stock \d|mínimo \d/);
  });

  it("sin enmascarar incluye las cifras reales", () => {
    const prompt = snapshotToPrompt(realSnapshot as never);
    expect(prompt).toContain("stock actual 7, mínimo 10");
    expect(prompt).not.toContain("conteo de inventario a ciegas");
  });
});

describe("Prioridades del gerente con stock enmascarado", () => {
  const t = (key: string, params?: Record<string, unknown>) => `${key}|${JSON.stringify(params ?? {})}`;

  it("la compra y la producción limitada salen sin cifras", () => {
    const messages = buildManagerPriorities(maskedSnapshot, t as never).map((p) => p.message);
    expect(messages.some((m) => m.startsWith("priority.purchase.masked"))).toBe(true);
    expect(messages.some((m) => m.startsWith("priority.production.limitedWithIngredient"))).toBe(true);
    expect(messages.join(" ")).not.toMatch(/priority\.purchase\.(urgent|simple)|warningWithIngredient|"stock"|"maxUnits"|"days"/);
  });
});

describe("AIEngine e InventoryAI con stock enmascarado", () => {
  const masked = { id: "h", name: "Harina", stock: 3, minStock: 3, stockMasked: true, stockStatus: "LOW" } as unknown as Product;
  const real = { id: "a", name: "Arroz", stock: 2, minStock: 10 } as unknown as Product;

  it("la recomendación de compra habla del estado, no de unidades", () => {
    const [masked1, real1] = new AIEngine().generatePurchaseRecommendation([masked, real]);
    expect(masked1).toBe('Reponer "Harina" (🟡 Stock bajo).');
    expect(real1).toContain("Stock actual: 2");
  });

  it("las recomendaciones estructuradas no llevan cantidades inventadas", () => {
    const [rec] = new InventoryAI().generatePurchaseRecommendations([masked]);
    expect(rec).toMatchObject({ productId: "h", currentStock: 0, recommendedPurchase: 0, stockMasked: true });
  });
});