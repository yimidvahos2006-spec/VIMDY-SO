import { SalesAnalysis, ProductRanking } from "../ia/SalesAI";
import { InventoryStatus, PurchaseRecommendation } from "../ia/InventoryAI";
import { FinanceAnalysis } from "../ia/FinanceAI";
import { CustomerAnalysis, CustomerRanking } from "../ia/CustomerAI";
import { PredictionResult } from "../ia/PredictionAI";
import { BusinessRecommendation } from "../ia/RecommendationAI";

/**
 * AIInsightsSnapshot
 * ---------------------------------------------------------------------------
 * PASO 3 — Integración de los módulos huérfanos de IA.
 *
 * Reúne en un solo objeto lo que calculan los 6 módulos que vivían en
 * src/core/ia/ sin estar conectados a nada:
 *
 *   SalesAI ─┐
 *   InventoryAI ─┤
 *   FinanceAI ─┤─→ AIInsightsSnapshot ─→ BusinessAnalyzer.buildSnapshot()
 *   CustomerAI ─┤
 *   PredictionAI ─┤
 *   RecommendationAI ─┘
 *
 * BusinessAnalyzer los calcula a partir de los MISMOS datos reales que ya
 * usa para el resto del snapshot (nunca inventan cifras), y expone el
 * resultado bajo `snapshot.aiInsights` para que lo consuman el Dashboard,
 * el Copiloto y QuestionRouter.
 */
export interface AIInsightsSnapshot {
  readonly sales: {
    readonly analysis: SalesAnalysis;
    readonly topProduct: ProductRanking | null;
    readonly recommendation: string;
  };

  readonly inventory: {
    readonly status: InventoryStatus;
    readonly recommendations: PurchaseRecommendation[];
  };

  readonly finance: {
    readonly analysis: FinanceAnalysis;
    readonly cashFlow: number;
    readonly status: "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL";
    readonly projectedIncome: number;
    readonly recommendation: string;
  };

  readonly customers: {
    readonly analysis: CustomerAnalysis;
    readonly bestCustomer: CustomerRanking | null;
  };

  readonly prediction: PredictionResult;

  /** Todas las recomendaciones combinadas (ventas, inventario, clientes, finanzas), priorizadas. */
  readonly recommendations: BusinessRecommendation[];
}