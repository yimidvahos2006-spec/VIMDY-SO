/**
 * CopilotTypes
 * ---------------------------------------------------------------------------
 * Tipos compartidos por el Copiloto VIMDY: los mensajes del chat y el
 * "snapshot" de contexto real del negocio que se le envía a Claude en cada
 * pregunta, para que las respuestas hablen de datos reales (ventas de hoy,
 * inventario bajo, producto estrella, etc.) y no inventadas.
 */

import { AIInsightsSnapshot } from "./AIInsightsTypes";
import type { ForecastSummary } from "../engines/ForecastEngine";
import type { PurchaseRecommendation } from "../engines/PurchaseIntelligenceEngine";

export type CopilotRole = "user" | "assistant";

export interface CopilotMessage {
  readonly id: string;
  readonly role: CopilotRole;
  readonly content: string;
  readonly createdAt: Date;
}

export interface CopilotTopProduct {
  readonly name: string;
  readonly quantity: number;
  readonly revenue: number;
}

export interface CopilotProfitProduct {
  readonly name: string;
  readonly unitsSold: number;
  readonly profit: number;
  readonly marginPercent: number;
}

export interface CopilotTopEmployee {
  readonly name: string;
  readonly salesCount: number;
  readonly revenue: number;
}

/**
 * BLOQUEANTE #5 (auditoría Fase 2): cuántas ventas canceló y cuántas
 * reembolsó (total o parcialmente) cada empleado, según el registro de
 * auditoría (AuditEngine — ver BusinessAnalyzer.buildEmployeeRefundStats).
 * `total` es la suma de ambas, y es lo que define el orden del ranking.
 */
export interface CopilotEmployeeRefundStats {
  readonly name: string;
  readonly cancelCount: number;
  readonly refundCount: number;
  readonly total: number;
}

/**
 * PASO 2.5 (Centro de Pérdidas): resumen mínimo y real de cuánto se ha
 * perdido este mes, cuál producto y cuál motivo concentran más pérdida.
 * Nunca inventa cifras: si un movimiento de pérdida no tiene costo
 * confiable, no se suma aquí (mismo criterio que topProfitProducts).
 */
export interface CopilotLossSummary {
  readonly monthLoss: number;
  readonly topLossProduct: { readonly name: string; readonly value: number } | null;
  readonly topLossCategory: { readonly label: string; readonly value: number } | null;
}

export interface CopilotPurchaseSuggestion {
  readonly productId: string;
  readonly name: string;
  readonly currentStock: number;
  readonly avgDailySales: number;
  readonly daysUntilStockout: number | null;
  readonly suggestedQuantity: number;
  /** false si todavía no hay ventas registradas de este producto — la cantidad sugerida es solo "completar hasta el mínimo", no una proyección de demanda real. */
  readonly hasSalesHistory: boolean;
  /** Proveedor principal del producto, si tiene uno asignado (para precargar "Crear orden"). */
  readonly supplierId?: string;
}

export interface CopilotSlowMover {
  readonly name: string;
  readonly stock: number;
  readonly unitsSoldLast30Days: number;
}

export interface CopilotTableTurnover {
  readonly tableName: string;
  readonly avgMinutes: number;
  readonly ordersCount: number;
}

export interface CopilotLowStockProduct {
  readonly name: string;
  readonly stock: number;
  readonly minStock: number;
}

/**
 * Estado de producción de un producto elaborado (con receta), tal como lo
 * calcula RecipeEngine.getProductionStatus(). Es lo que el Gerente
 * Inteligente (QuestionRouter) usa para decir cosas como "Solo puedes
 * preparar 12 hamburguesas" o "Te falta pan". Solo se listan aquí los
 * productos elaborados cuyo nivel NO es 'OK' (ver BusinessAnalyzer).
 */
export interface CopilotProductionAlert {
  readonly productId: string;
  readonly productName: string;
  readonly status: "DISPONIBLE" | "AGOTADO";
  readonly level: "ADVERTENCIA" | "CRITICO";
  /** Unidades que se pueden preparar HOY con el stock actual de ingredientes. */
  readonly maxUnits: number;
  /** Nombre del ingrediente que frena la producción. Null solo si la receta está vacía (no debería pasar aquí). */
  readonly limitingIngredientName: string | null;
}

/**
 * PASO 1 (FASE 5, cierre) — Resumen Ejecutivo: capacidad de producción HOY
 * del producto estrella (el más vendido del día, `todayTopProduct` /
 * `topProducts[0]`), para que la tarjeta "Capacidad de producción" del
 * Gerente Inteligente siempre tenga algo real que mostrar, sin depender de
 * que exista una alerta de producción (esas solo aparecen cuando el nivel
 * NO es 'OK'). Si el producto estrella tiene receta (BOM), `maxUnits` sale
 * de RecipeEngine.getProductionCapacity(); si es un producto simple (sin
 * receta), `maxUnits` es directamente su stock actual y `basedOn` lo indica,
 * para no confundir "unidades que se pueden preparar" con "unidades en
 * bodega".
 */
export interface CopilotStarProductCapacity {
  readonly productName: string;
  readonly maxUnits: number;
  readonly basedOn: "RECETA" | "STOCK";
}

export interface CopilotBestDay {
  readonly day: string;
  readonly total: number;
}

export interface CopilotWeeklyForecast {
  readonly projectedTotal: number;
  readonly byDay: { day: string; projected: number }[];
  readonly basedOnWeeks: number;
}

/** Nivel de una alerta inteligente (PASO 4 — Alertas Inteligentes). */
export type SmartAlertLevel = "RED" | "ORANGE" | "GREEN";

export interface SmartAlert {
  readonly level: SmartAlertLevel;
  readonly icon: "🔴" | "🟠" | "🟢";
  readonly message: string;
}

/** Un patrón detectado por PatternLearningEngine (PASO 9 — Aprendizaje). */
export interface CopilotLearnedPattern {
  readonly kind: "TREND" | "TOP_PRODUCT" | "BEST_WEEKDAY" | "INSUFFICIENT_DATA";
  readonly message: string;
}

export interface CopilotCashStatus {
  readonly balance: number;
  readonly todayBalance: number;
}

export interface CopilotTableStatusCounts {
  readonly free: number;
  readonly busy: number;
  readonly waitingFood: number;
  readonly waitingBill: number;
  readonly paying: number;
  readonly reserved: number;
  readonly total: number;
}

export interface CopilotDelayedOrder {
  readonly origin: string;
  readonly status: string;
  readonly minutesWaiting: number;
}

export interface CopilotTopCustomer {
  readonly name: string;
  readonly totalSpent: number;
  readonly purchaseCount: number;
}

export interface CopilotCustomerStats {
  readonly totalCustomers: number;
  readonly newCustomersToday: number;
  readonly topCustomers: CopilotTopCustomer[];
}

export interface CopilotContextSnapshot {
  readonly businessName: string;
  readonly currency: string;

  readonly todaySales: number;
  readonly yesterdaySales: number;
  readonly salesGrowthPercent: number;
  readonly totalSalesAllTime: number;
  readonly totalOrdersToday: number;
  readonly averageTicketToday: number;

  /** Ganancia real de HOY (precio - costo real, incluyendo receta/BOM) sobre las ventas de hoy. */
  readonly todayProfit: number;
  /** Producto más vendido HOY por ingresos (no histórico). Null si aún no hay ventas hoy. */
  readonly todayTopProduct: CopilotTopProduct | null;
  /** Empleado (cajero o mesero) con más ventas HOY. Null si aún no hay ventas hoy. */
  readonly todayTopEmployee: CopilotTopEmployee | null;
  /** Nombres de productos activos con stock en cero en este momento (foto en vivo). */
  readonly outOfStockProducts: string[];

  readonly bestDayOfWeek: CopilotBestDay | null;
  readonly topProducts: CopilotTopProduct[];
  readonly lowStockProducts: CopilotLowStockProduct[];
  /** Productos elaborados (con receta) cuya producción está en advertencia o crítica HOY. */
  readonly productionAlerts: CopilotProductionAlert[];

  readonly topProfitProducts: CopilotProfitProduct[];
  /** PASO 2.5 — Centro de Pérdidas: para que el Gerente Inteligente avise cuando se está perdiendo dinero de verdad. */
  readonly lossSummary: CopilotLossSummary;
  /** PASO 1 (cierre) — Resumen Ejecutivo: capacidad de producción del producto estrella. Null solo si aún no hay ventas hoy. */
  readonly starProductCapacity: CopilotStarProductCapacity | null;
  readonly topEmployees: CopilotTopEmployee[];
  /** BLOQUEANTE #5 (auditoría Fase 2): empleados que más cancelan/reembolsan ventas, ordenado de mayor a menor. Vacío si aún no hay cancelaciones ni reembolsos registrados. */
  readonly topRefundingEmployees: CopilotEmployeeRefundStats[];
  readonly purchaseSuggestions: CopilotPurchaseSuggestion[];
  /** FASE 6 — Centro de Comando: mismos datos reales de ForecastEngine que ya ve /pronostico. */
  readonly forecastSummary: ForecastSummary;
  /** FASE 6 — Centro de Comando: mismas recomendaciones reales de PurchaseIntelligenceEngine que ya ve /compras-inteligentes. */
  readonly purchaseRecommendations: readonly PurchaseRecommendation[];
  readonly slowMovers: CopilotSlowMover[];
  readonly tableTurnover: CopilotTableTurnover[];
  readonly weeklyForecast: CopilotWeeklyForecast | null;

  readonly cash: CopilotCashStatus;
  readonly tableStatus: CopilotTableStatusCounts;
  readonly delayedOrders: CopilotDelayedOrder[];
  readonly customerStats: CopilotCustomerStats;

  readonly criticalAlertsCount: number;
  readonly kitchenPendingCount: number;
  readonly outOfStockCount: number;
  readonly smartAlerts: SmartAlert[];

  readonly healthScore: number;
  readonly healthMessage: string;

  readonly aiRecommendations: string[];

  /**
   * PASO 3 — Integración de los módulos huérfanos: SalesAI, InventoryAI,
   * FinanceAI, CustomerAI, PredictionAI y RecommendationAI, todos
   * calculados por BusinessAnalyzer a partir de datos reales.
   */
  readonly aiInsights: AIInsightsSnapshot;

  /** PASO 9 — Aprendizaje: patrones detectados sobre el historial acumulado por PatternLearningEngine. */
  readonly learnedPatterns: CopilotLearnedPattern[];

  readonly generatedAt: string;
}

/**
 * BusinessSnapshot — alias de CopilotContextSnapshot usado por
 * BusinessAnalyzer. Es el mismo tipo: BusinessAnalyzer produce la "foto"
 * completa del negocio, y el Copiloto la consume para responder preguntas.
 */
export type BusinessSnapshot = CopilotContextSnapshot;