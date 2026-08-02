import { Order, Table, User, Customer, Sale, CashMovement, Product } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { DashboardEngine } from "./DashboardEngine";
import { InventoryEngine } from "./InventoryEngine";
import { RecipeEngine } from "./RecipeEngine";
import { ForecastEngine } from "./ForecastEngine";
import { PurchaseIntelligenceEngine } from "./PurchaseIntelligenceEngine";
import { KardexEngine } from "./KardexEngine";
import { LOSS_CATEGORY_LABEL } from "./lossCategoryLabels";
import { CashEngine } from "./CashEngine";
import { CustomerEngine } from "./CustomerEngine";
import { AuditEngine } from "./AuditEngine";
import { BusinessSnapshot, SmartAlert } from "../types/CopilotTypes";
import { AIInsightsSnapshot } from "../types/AIInsightsTypes";
import { SalesAI } from "../ia/SalesAI";
import { InventoryAI } from "../ia/InventoryAI";
import { FinanceAI } from "../ia/FinanceAI";
import { CustomerAI } from "../ia/CustomerAI";
import { PredictionAI } from "../ia/PredictionAI";
import { RecommendationAI } from "../ia/RecommendationAI";
import { companyConfigStore } from "../store/companyConfigStore";

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Ventana usada para "reciente" en velocidad de venta, rotación y mesas. */
const RECENT_WINDOW_DAYS = 30;
/** Cuántos días de cobertura sugerir al recomendar una compra. */
const REORDER_COVERAGE_DAYS = 14;
/** Minutos que puede esperar una comanda antes de considerarse retrasada. */
const KITCHEN_DELAY_THRESHOLD_MINUTES = 20;
/** Cuántas comandas pendientes se consideran una acumulación preocupante. */
const KITCHEN_BACKLOG_ALERT_THRESHOLD = 5;
/**
 * BLOQUEANTE #5 (auditoría Fase 2): acciones de AuditEngine que cuentan
 * como "anulación" de una venta para el ranking de empleados. Cubre
 * cancelación (antes de cobrar), reembolso total y reembolso parcial —
 * ver SalesEngine.cancelSale/refundSale/partialRefundSale, que son los
 * únicos que registran estas tres acciones.
 */
const SALE_REVERSAL_ACTIONS = ["SALE_CANCELLED", "SALE_REFUNDED", "SALE_PARTIALLY_REFUNDED"];

function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

function daysAgo(date: Date, from: Date): number {
  return (from.getTime() - date.getTime()) / (1000 * 60 * 60 * 24);
}

function minutesAgo(date: Date, from: Date): number {
  return (from.getTime() - date.getTime()) / (1000 * 60);
}

function sumTotal(sales: { total: number }[]): number {
  return sales.reduce((sum, sale) => sum + sale.total, 0);
}

/**
 * BusinessAnalyzer
 * ---------------------------------------------------------------------------
 * FASE 2 — El "cerebro" de VIMDY. Reúne en un solo lugar todo lo que ya
 * calculan los motores especializados del negocio:
 *
 *   SalesEngine ─┐
 *   InventoryEngine ─┤
 *   KitchenEngine ─┤─→ BusinessAnalyzer ─→ AIEngine / Copiloto
 *   DashboardEngine ─┤
 *   CashEngine ─┤
 *   CustomerEngine ─┤
 *   TableEngine (vía repositorio de mesas) ─┤
 *   UserEngine (vía repositorio de usuarios) ─┘
 *
 * Ningún otro módulo de IA debe leer los repositorios directamente: todos
 * consultan a BusinessAnalyzer, que nunca inventa cifras — solo agrega y
 * traduce datos reales ya calculados por los motores del negocio.
 */
export class BusinessAnalyzer {
  // PASO 3 — Módulos de IA antes huérfanos, ahora alimentando a BusinessAnalyzer.
  // Son motores sin estado (solo procesan los datos reales que ya llegan de
  // los repositorios/engines de negocio), por eso se instancian aquí mismo,
  // igual que ya hacía RecommendationAI internamente con los otros tres.
  private readonly salesAI = new SalesAI();
  private readonly inventoryAI = new InventoryAI();
  private readonly financeAI = new FinanceAI();
  private readonly customerAI = new CustomerAI();
  private readonly predictionAI = new PredictionAI();
  private readonly recommendationAI = new RecommendationAI();

  constructor(
    private readonly dashboardEngine: DashboardEngine,
    private readonly inventoryEngine: InventoryEngine,
    private readonly cashEngine: CashEngine,
    private readonly customerEngine: CustomerEngine,
    private readonly orderRepository: IRepository<Order>,
    private readonly tableRepository: IRepository<Table>,
    private readonly userRepository: IRepository<User>,
    // PASO 5 (Gerente Inteligente): fuente de verdad para costo real,
    // rentabilidad y capacidad de producción de productos con receta.
    // Reemplaza el cálculo de costo que antes vivía duplicado aquí mismo.
    private readonly recipeEngine: RecipeEngine,
    // PASO 2.5 (Centro de Pérdidas): fuente de verdad de los movimientos de
    // inventario, para que el Gerente Inteligente sepa cuánto se ha perdido.
    private readonly kardexEngine: KardexEngine,
    // FASE 6 (Centro de Comando): antes BusinessAnalyzer calculaba su propio
    // pronóstico y sus propias sugerencias de compra con lógica duplicada.
    // Ahora usa las mismas fuentes de verdad reales que ya tienen sus
    // propias pantallas (/pronostico, /compras-inteligentes), para que el
    // Gerente Inteligente diga exactamente lo mismo que esas pantallas.
    private readonly forecastEngine: ForecastEngine,
    private readonly purchaseIntelligenceEngine: PurchaseIntelligenceEngine,
    // BLOQUEANTE #5 (auditoría Fase 2): fuente real de quién cancela/
    // reembolsa cada venta (ver SALE_REVERSAL_ACTIONS más arriba).
    private readonly auditEngine: AuditEngine
  ) {}

  public async buildSnapshot(businessName: string, currency: string): Promise<BusinessSnapshot> {
    const [summary, products, lowStock, orders, tables, users, customers, cashBalance, cashToday, cashMovements, inventoryMovements, forecastSummary, purchaseRecommendations, saleReversalLogs] =
      await Promise.all([
        this.dashboardEngine.getExecutiveSummary(),
        this.inventoryEngine.listAll(),
        this.inventoryEngine.getLowStockProducts(),
        this.orderRepository.findAll(),
        this.tableRepository.findAll(),
        this.userRepository.findAll(),
        this.customerEngine.getAllCustomers(),
        this.cashEngine.getBalance(),
        this.cashEngine.getTodayBalance(),
        this.cashEngine.getAllMovements(),
        // PASO 2.5 (Centro de Pérdidas): mismos movimientos que ve useLossCenter.
        this.kardexEngine.getAllMovements(),
        // FASE 6 (Centro de Comando): mismos datos reales que ya ven
        // /pronostico y /compras-inteligentes, ahora también en el snapshot
        // que arma el Gerente Inteligente.
        this.forecastEngine.getSummary(),
        this.purchaseIntelligenceEngine.getRecommendations(),
        // BLOQUEANTE #5 (auditoría Fase 2): logs de cancelación/reembolso,
        // para saber qué empleado anula más ventas.
        this.auditEngine.getByActions(SALE_REVERSAL_ACTIONS)
      ]);

    const productById = new Map(products.map((p) => [p.id, p]));
    const userNameById = new Map(users.map((u) => [u.id, u.name]));
    const tableNameById = new Map(tables.map((t) => [t.id, t.name]));

    const now = new Date();
    const yesterday = new Date(now);
    yesterday.setDate(now.getDate() - 1);

    const todaySalesList = summary.sales.filter((sale) => isSameDay(new Date(sale.createdAt), now));
    const yesterdaySalesList = summary.sales.filter((sale) =>
      isSameDay(new Date(sale.createdAt), yesterday)
    );

    const todaySales = sumTotal(todaySalesList);
    const yesterdaySales = sumTotal(yesterdaySalesList);
    const totalSalesAllTime = sumTotal(summary.sales);
    const averageTicketToday = todaySalesList.length > 0 ? todaySales / todaySalesList.length : 0;

    const salesGrowthPercent =
      yesterdaySales === 0
        ? todaySales > 0
          ? 100
          : 0
        : Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100);

    // Mejor día de la semana histórico.
    const totalsByWeekday = new Map<number, number>();
    const countByWeekday = new Map<number, number>();
    summary.sales.forEach((sale) => {
      const day = new Date(sale.createdAt).getDay();
      totalsByWeekday.set(day, (totalsByWeekday.get(day) ?? 0) + sale.total);
      countByWeekday.set(day, (countByWeekday.get(day) ?? 0) + 1);
    });

    let bestDayOfWeek: BusinessSnapshot["bestDayOfWeek"] = null;
    if (totalsByWeekday.size > 0) {
      const [bestDayIndex, bestDayTotal] = [...totalsByWeekday.entries()].reduce((best, current) =>
        current[1] > best[1] ? current : best
      );
      bestDayOfWeek = { day: DAY_LABELS[bestDayIndex], total: bestDayTotal };
    }

    // Productos más vendidos y agregados por unidad (ganancia, rotación).
    const productAgg = new Map<string, { quantity: number; revenue: number }>();
    const productAgg30d = new Map<string, number>();
    summary.sales.forEach((sale) => {
      const isRecent = daysAgo(new Date(sale.createdAt), now) <= RECENT_WINDOW_DAYS;
      sale.items.forEach((item) => {
        const current = productAgg.get(item.productId) ?? { quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;
        productAgg.set(item.productId, current);

        if (isRecent) {
          productAgg30d.set(item.productId, (productAgg30d.get(item.productId) ?? 0) + item.quantity);
        }
      });
    });

    const topProducts = [...productAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([productId, agg]) => ({
        name: productById.get(productId)?.name ?? productId,
        quantity: agg.quantity,
        revenue: agg.revenue
      }));

    /**
     * Costo, ganancia y margen real por producto (RecipeEngine.getProfitability):
     * si tiene receta (BOM), el costo sale de sumar el costo real de cada
     * ingrediente; si no, de su propio purchasePrice. Antes esta cuenta vivía
     * duplicada aquí mismo (función unitCost); ahora RecipeEngine es la única
     * fuente de verdad, la misma que usan InventoryEngine y la UI de Inventario.
     */
    const topProfitProducts = [...productAgg.entries()]
      .map(([productId, agg]) => {
        const product = productById.get(productId);
        if (!product) return null;
        const profitability = this.recipeEngine.getProfitability(product, productById);
        if (profitability.costUnreliable) return null;
        const profit = profitability.profit * agg.quantity;
        const marginPercent = Math.round(profitability.marginPercent);
        return { name: product.name, unitsSold: agg.quantity, profit, marginPercent };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && row.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    /**
     * PASO 2.5 — Centro de Pérdidas: cuánto dinero real se ha perdido este
     * mes (movimientos DECREASE con lossCategory, valorizados al mismo
     * costo real que usa topProfitProducts arriba), y qué producto/motivo
     * concentra más pérdida. Un movimiento sin costo confiable (falta
     * purchasePrice/receta) no se suma, para no inventar una cifra.
     */
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const monthLossMovements = inventoryMovements.filter(
      (m) => m.type === "DECREASE" && m.lossCategory && new Date(m.date).getTime() >= monthStart.getTime()
    );
    const lossByProduct = new Map<string, number>();
    const lossByCategoryValue = new Map<string, number>();
    let monthLoss = 0;
    monthLossMovements.forEach((m) => {
      const product = productById.get(m.productId);
      if (!product) return;
      const profitability = this.recipeEngine.getProfitability(product, productById);
      if (profitability.costUnreliable) return;
      const value = profitability.cost * m.quantity;
      monthLoss += value;
      lossByProduct.set(product.name, (lossByProduct.get(product.name) ?? 0) + value);
      if (m.lossCategory) {
        const label = LOSS_CATEGORY_LABEL[m.lossCategory];
        lossByCategoryValue.set(label, (lossByCategoryValue.get(label) ?? 0) + value);
      }
    });
    const topLossProductEntry = [...lossByProduct.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const topLossCategoryEntry = [...lossByCategoryValue.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
    const lossSummary = {
      monthLoss,
      topLossProduct: topLossProductEntry ? { name: topLossProductEntry[0], value: topLossProductEntry[1] } : null,
      topLossCategory: topLossCategoryEntry ? { label: topLossCategoryEntry[0], value: topLossCategoryEntry[1] } : null
    };

    /**
     * PASO 5 — Gerente Inteligente: productos elaborados (con receta) cuya
     * producción está limitada HOY (advertencia o crítico), con su
     * ingrediente limitante. Usa el mismo productById que ya se cargó arriba
     * (productos = inventoryEngine.listAll()), así que no repite el fetch.
     */
    const productionAlerts = [...productById.values()]
      .map((product) => this.recipeEngine.getProductionStatus(product, productById))
      .filter((status): status is NonNullable<typeof status> => status !== null && status.level !== "OK")
      .map((status) => ({
        productId: status.productId,
        productName: status.productName,
        status: status.status,
        level: status.level as "ADVERTENCIA" | "CRITICO",
        maxUnits: status.maxUnits,
        limitingIngredientName: status.limitingIngredient?.name ?? null
      }));

    // Empleado que más vende (por cashierId y waiterId).
    const employeeAgg = new Map<string, { salesCount: number; revenue: number }>();
    summary.sales.forEach((sale) => {
      const employeeIds = new Set([sale.cashierId, sale.waiterId].filter(Boolean) as string[]);
      employeeIds.forEach((employeeId) => {
        const current = employeeAgg.get(employeeId) ?? { salesCount: 0, revenue: 0 };
        current.salesCount += 1;
        current.revenue += sale.total;
        employeeAgg.set(employeeId, current);
      });
    });

    const topEmployees = [...employeeAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([employeeId, agg]) => ({
        name: userNameById.get(employeeId) ?? "Empleado sin nombre registrado",
        salesCount: agg.salesCount,
        revenue: agg.revenue
      }));

    // BLOQUEANTE #5 (auditoría Fase 2) — empleado(s) que más anulan ventas
    // (cancelación antes de cobrar, reembolso total o reembolso parcial).
    // "system" se descarta: es el actorId de respaldo cuando la acción no
    // vino de un usuario logueado (ver SalesEngine actorId ?? sale.cashierId
    // ?? "system"), así que no identifica a ningún empleado real.
    const refundAgg = new Map<string, { cancelCount: number; refundCount: number }>();
    saleReversalLogs.forEach((log) => {
      if (!log.actorId || log.actorId === "system") return;
      const current = refundAgg.get(log.actorId) ?? { cancelCount: 0, refundCount: 0 };
      if (log.action === "SALE_CANCELLED") {
        current.cancelCount += 1;
      } else {
        current.refundCount += 1;
      }
      refundAgg.set(log.actorId, current);
    });

    const topRefundingEmployees = [...refundAgg.entries()]
      .map(([employeeId, agg]) => ({
        name: userNameById.get(employeeId) ?? "Empleado sin nombre registrado",
        cancelCount: agg.cancelCount,
        refundCount: agg.refundCount,
        total: agg.cancelCount + agg.refundCount
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    // Qué comprar (velocidad de venta real de los últimos 30 días).
    const purchaseSuggestions = lowStock
      .map((product) => {
        const sold30d = productAgg30d.get(product.id) ?? 0;
        const avgDailySales = sold30d / RECENT_WINDOW_DAYS;
        const daysUntilStockout = avgDailySales > 0 ? Math.floor(product.stock / avgDailySales) : null;
        const suggestedQuantity = Math.max(
          Math.ceil(avgDailySales * REORDER_COVERAGE_DAYS) - product.stock,
          product.minStock - product.stock,
          1
        );
        return {
          productId: product.id,
          name: product.name,
          currentStock: product.stock,
          avgDailySales: Math.round(avgDailySales * 10) / 10,
          daysUntilStockout,
          suggestedQuantity,
          hasSalesHistory: avgDailySales > 0,
          supplierId: product.supplierId
        };
      })
      .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999))
      .slice(0, 8);

    // Productos que casi no rotan (capital inmovilizado).
    const slowMovers = products
      .filter((product) => (product.stock ?? 0) > 0 && (product.active ?? true))
      .map((product) => ({
        name: product.name,
        stock: product.stock,
        unitsSoldLast30Days: productAgg30d.get(product.id) ?? 0
      }))
      .filter((row) => row.unitsSoldLast30Days <= 1)
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 8);

    // Mesas que más tardan (duración promedio de pedidos completados).
    const tableDurations = new Map<string, { totalMinutes: number; count: number }>();
    orders.forEach((order) => {
      if (order.source !== "TABLE" || !order.tableId) return;
      if (order.status !== "DELIVERED" && order.status !== "COMPLETED") return;
      const minutes = (new Date(order.updatedAt).getTime() - new Date(order.createdAt).getTime()) / 60000;
      if (minutes <= 0 || minutes > 24 * 60) return;
      const current = tableDurations.get(order.tableId) ?? { totalMinutes: 0, count: 0 };
      current.totalMinutes += minutes;
      current.count += 1;
      tableDurations.set(order.tableId, current);
    });

    const tableTurnover = [...tableDurations.entries()]
      .map(([tableId, agg]) => ({
        tableName: tableNameById.get(tableId) ?? tableId,
        avgMinutes: Math.round(agg.totalMinutes / agg.count),
        ordersCount: agg.count
      }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes)
      .slice(0, 8);

    // Estado actual de las mesas (foto en vivo, no histórico).
    const tableStatusCounts = {
      free: tables.filter((t) => t.status === "FREE").length,
      busy: tables.filter((t) => t.status === "BUSY").length,
      waitingFood: tables.filter((t) => t.status === "WAITING_FOOD").length,
      waitingBill: tables.filter((t) => t.status === "WAITING_BILL").length,
      paying: tables.filter((t) => t.status === "PAYING").length,
      reserved: tables.filter((t) => t.status === "RESERVED").length,
      total: tables.length
    };

    // Comandas de cocina retrasadas (pendientes o en preparación hace rato).
    const delayedOrders = summary.kitchen
      .filter((order) => order.status === "PENDIENTE" || order.status === "EN_PREPARACION")
      .map((order) => ({
        origin: order.origin ?? "Pedido",
        status: order.status,
        minutesWaiting: Math.round(minutesAgo(new Date(order.createdAt), now))
      }))
      .filter((row) => row.minutesWaiting >= KITCHEN_DELAY_THRESHOLD_MINUTES)
      .sort((a, b) => b.minutesWaiting - a.minutesWaiting)
      .slice(0, 10);

    // Clientes: totales, nuevos hoy, y quiénes más le compran al negocio.
    const customerLtv = new Map<string, { customer: Customer; total: number; count: number }>();
    summary.sales.forEach((sale) => {
      if (!sale.customerId) return;
      const customer = customers.find((c) => c.id === sale.customerId);
      if (!customer) return;
      const current = customerLtv.get(sale.customerId) ?? { customer, total: 0, count: 0 };
      current.total += sale.total;
      current.count += 1;
      customerLtv.set(sale.customerId, current);
    });

    const topCustomers = [...customerLtv.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((row) => ({ name: row.customer.name, totalSpent: row.total, purchaseCount: row.count }));

    const newCustomersToday = customers.filter(
      (c) => c.createdAt && isSameDay(new Date(c.createdAt), now)
    ).length;

    // Proyección de los próximos 7 días (promedio histórico por día).
    let weeklyForecast: BusinessSnapshot["weeklyForecast"] = null;
    if (summary.sales.length >= 7) {
      const oldestSaleMs = Math.min(...summary.sales.map((s) => new Date(s.createdAt).getTime()));
      const weeksOfData = Math.max(1, Math.round(daysAgo(new Date(oldestSaleMs), now) / 7));
      const byDay = Array.from({ length: 7 }, (_, i) => {
        const dayIndex = (now.getDay() + 1 + i) % 7;
        const total = totalsByWeekday.get(dayIndex) ?? 0;
        const count = countByWeekday.get(dayIndex) ?? 0;
        const avgPerOccurrence = count > 0 ? total / Math.max(1, Math.round(count / weeksOfData)) : 0;
        return { day: DAY_LABELS[dayIndex], projected: Math.round(avgPerOccurrence) };
      });
      weeklyForecast = {
        projectedTotal: byDay.reduce((sum, d) => sum + d.projected, 0),
        byDay,
        basedOnWeeks: weeksOfData
      };
    }

    const lowStockProducts = lowStock.slice(0, 10).map((product) => ({
      name: product.name,
      stock: product.stock,
      minStock: product.minStock
    }));

    // BLOQUEANTE (bug reportado en video 2026-07-31): mismo criterio que
    // InventoryEngine.getLowStockProducts — trackStock === false no debe
    // contar como "agotado" en el resumen del Gerente Inteligente.
    const outOfStockProductsList = products.filter(
      (p) => (p.active ?? true) && p.trackStock !== false && p.stock <= 0
    );
    const outOfStockCount = outOfStockProductsList.length;
    const outOfStockProducts = outOfStockProductsList.slice(0, 10).map((p) => p.name);

    /**
     * PASO 1 (FASE 5) — Gerente Inteligente: ganancia y "campeones" del día,
     * a diferencia de topProducts/topProfitProducts/topEmployees que son
     * históricos. Se recorre todaySalesList una sola vez (ya calculada
     * arriba) reutilizando recipeEngine.getProfitability(), sin inventar
     * ningún dato.
     */
    const todayProductAgg = new Map<string, { quantity: number; revenue: number }>();
    const todayEmployeeAgg = new Map<string, { salesCount: number; revenue: number }>();
    let todayProfit = 0;

    todaySalesList.forEach((sale) => {
      sale.items.forEach((item) => {
        const current = todayProductAgg.get(item.productId) ?? { quantity: 0, revenue: 0 };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;
        todayProductAgg.set(item.productId, current);

        const product = productById.get(item.productId);
        if (product) {
          const profitability = this.recipeEngine.getProfitability(product, productById);
          if (!profitability.costUnreliable) {
            todayProfit += (item.price - profitability.cost) * item.quantity;
          }
        }
      });

      const employeeIds = new Set([sale.cashierId, sale.waiterId].filter(Boolean) as string[]);
      employeeIds.forEach((employeeId) => {
        const current = todayEmployeeAgg.get(employeeId) ?? { salesCount: 0, revenue: 0 };
        current.salesCount += 1;
        current.revenue += sale.total;
        todayEmployeeAgg.set(employeeId, current);
      });
    });

    const [todayTopProductEntry] = [...todayProductAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    const todayTopProduct = todayTopProductEntry
      ? {
          name: productById.get(todayTopProductEntry[0])?.name ?? todayTopProductEntry[0],
          quantity: todayTopProductEntry[1].quantity,
          revenue: todayTopProductEntry[1].revenue
        }
      : null;

    /**
     * PASO 1 (cierre) — Resumen Ejecutivo: "Capacidad de producción" del
     * producto estrella de HOY (`todayTopProductEntry`), reutilizando
     * RecipeEngine.getProductionCapacity() — la misma fuente de verdad que
     * ya usan productionAlerts arriba. A diferencia de productionAlerts
     * (que solo lista productos con nivel distinto de 'OK'), esta tarjeta
     * debe verse SIEMPRE, incluso cuando la producción está sobrada, así
     * que se calcula aparte para el producto puntual del día.
     */
    let starProductCapacity: BusinessSnapshot["starProductCapacity"] = null;
    if (todayTopProductEntry) {
      const starProduct = productById.get(todayTopProductEntry[0]);
      if (starProduct) {
        const capacity = this.recipeEngine.getProductionCapacity(starProduct, productById);
        starProductCapacity = capacity
          ? { productName: starProduct.name, maxUnits: capacity.maxUnits, basedOn: "RECETA" }
          : { productName: starProduct.name, maxUnits: starProduct.stock, basedOn: "STOCK" };
      }
    }

    const [todayTopEmployeeEntry] = [...todayEmployeeAgg.entries()].sort((a, b) => b[1].revenue - a[1].revenue);
    const todayTopEmployee = todayTopEmployeeEntry
      ? {
          name: userNameById.get(todayTopEmployeeEntry[0]) ?? "Empleado sin nombre registrado",
          salesCount: todayTopEmployeeEntry[1].salesCount,
          revenue: todayTopEmployeeEntry[1].revenue
        }
      : null;
    const kitchenPendingCount = summary.kitchen.filter(
      (order) => order.status !== "ENTREGADO" && order.status !== "CANCELADO"
    ).length;
    const criticalAlertsCount = summary.alerts.filter((alert) => alert.priority === "CRITICAL").length;

    // Historial diario cronológico (últimos 14 días, del más viejo al más
    // reciente, incluyendo días en cero) para que PredictionAI pueda
    // detectar tendencia real de crecimiento/caída día a día.
    const PREDICTION_HISTORY_DAYS = 14;
    const dailySalesHistory = Array.from({ length: PREDICTION_HISTORY_DAYS }, (_, i) => {
      const day = new Date(now);
      day.setDate(now.getDate() - (PREDICTION_HISTORY_DAYS - 1 - i));
      return sumTotal(summary.sales.filter((sale) => isSameDay(new Date(sale.createdAt), day)));
    });

    const aiInsights = this.buildAIInsights({
      sales: summary.sales,
      products,
      customers,
      movements: cashMovements,
      dailySalesHistory
    });

    const smartAlerts = this.generateSmartAlerts({
      outOfStockCount,
      lowStockCount: lowStockProducts.length,
      salesGrowthPercent,
      todaySalesCount: todaySalesList.length,
      delayedOrdersCount: delayedOrders.length,
      kitchenPendingCount,
      cashToday,
      todaySales,
      dailySalesGoal: companyConfigStore.get().dailySalesGoal
    });

    return {
      businessName,
      currency,

      todaySales,
      yesterdaySales,
      salesGrowthPercent,
      totalSalesAllTime,
      totalOrdersToday: todaySalesList.length,
      averageTicketToday,

      todayProfit,
      todayTopProduct,
      todayTopEmployee,
      outOfStockProducts,

      bestDayOfWeek,
      topProducts,
      lowStockProducts,
      productionAlerts,

      topProfitProducts,
      lossSummary,
      starProductCapacity,
      topEmployees,
      topRefundingEmployees,
      purchaseSuggestions,
      // FASE 6 (Centro de Comando): datos reales de ForecastEngine y
      // PurchaseIntelligenceEngine — los mismos que ya ven /pronostico y
      // /compras-inteligentes — para que el Gerente Inteligente los muestre
      // sin que el dueño tenga que entrar a esas pantallas por separado.
      forecastSummary,
      purchaseRecommendations,
      slowMovers,
      tableTurnover,
      weeklyForecast,

      cash: { balance: cashBalance, todayBalance: cashToday },
      tableStatus: tableStatusCounts,
      delayedOrders,
      customerStats: {
        totalCustomers: customers.length,
        newCustomersToday,
        topCustomers
      },

      criticalAlertsCount,
      kitchenPendingCount,
      outOfStockCount,
      smartAlerts,

      healthScore: summary.health.score,
      healthMessage: summary.health.message,

      aiRecommendations: summary.aiRecommendations,
      aiInsights,
      // BusinessAnalyzer no acumula historial multi-día por sí mismo (eso es
      // trabajo de PatternLearningEngine, PASO 9): deja este campo vacío y
      // CopilotEngine lo completa al combinar ambas fuentes.
      learnedPatterns: [],
      generatedAt: now.toISOString()
    };
  }

  /**
   * PASO 3 — Integración de los módulos huérfanos.
   * Ejecuta SalesAI, InventoryAI, FinanceAI, CustomerAI, PredictionAI y
   * RecommendationAI sobre los mismos datos reales que ya trajo
   * buildSnapshot (nunca inventan cifras) y arma un único objeto listo
   * para el Dashboard, el Copiloto y QuestionRouter.
   */
  private buildAIInsights(input: {
    sales: Sale[];
    products: Product[];
    customers: Customer[];
    movements: CashMovement[];
    dailySalesHistory: number[];
  }): AIInsightsSnapshot {
    // SalesAI/CustomerAI usan sale.createdAt.getHours(), así que normalizamos
    // a instancias reales de Date (IndexedDB puede devolver strings).
    const normalizedSales = input.sales.map((sale) => ({
      ...sale,
      createdAt: new Date(sale.createdAt)
    }));

    const previousSales = input.dailySalesHistory.length >= 2
      ? input.dailySalesHistory[input.dailySalesHistory.length - 2]
      : 0;
    const currentSales = input.dailySalesHistory.length >= 1
      ? input.dailySalesHistory[input.dailySalesHistory.length - 1]
      : 0;

    const salesAnalysis = this.salesAI.generateAnalysis(normalizedSales, previousSales);
    const inventoryStatus = this.inventoryAI.generateInventoryStatus(input.products);
    const financeAnalysis = this.financeAI.generateFinanceAnalysis(normalizedSales, input.movements);
    const customerAnalysis = this.customerAI.generateCustomerAnalysis(input.customers, normalizedSales);
    const prediction = this.predictionAI.predictDailySales(input.dailySalesHistory);
    const growth = this.predictionAI.detectGrowth(input.dailySalesHistory);

    const recommendations = this.recommendationAI.generateAllRecommendations(
      input.products,
      input.customers,
      normalizedSales,
      input.movements
    );

    return {
      sales: {
        analysis: salesAnalysis,
        topProduct: this.salesAI.getTopProduct(normalizedSales),
        recommendation: this.salesAI.generateRecommendation(salesAnalysis)
      },
      inventory: {
        status: inventoryStatus,
        recommendations: this.inventoryAI.generatePurchaseRecommendations(input.products)
      },
      finance: {
        analysis: financeAnalysis,
        cashFlow: this.financeAI.calculateCashFlow(input.movements),
        status: this.financeAI.getFinancialStatus(normalizedSales, input.movements),
        projectedIncome: this.financeAI.projectNextMonthIncome(normalizedSales),
        recommendation: this.financeAI.generateRecommendation(normalizedSales, input.movements)
      },
      customers: {
        analysis: customerAnalysis,
        bestCustomer: this.customerAI.getBestCustomer(input.customers, normalizedSales)
      },
      prediction: {
        ...prediction,
        recommendation: this.predictionAI.generateRecommendation(currentSales, growth)
      },
      recommendations
    };
  }

  /**
   * PASO 4 — Alertas Inteligentes.
   * Traduce las cifras ya calculadas en alertas priorizadas (🔴🟠🟢), listas
   * para mostrarse en el dashboard o dentro de las respuestas del Copiloto.
   */
  private generateSmartAlerts(input: {
    outOfStockCount: number;
    lowStockCount: number;
    salesGrowthPercent: number;
    todaySalesCount: number;
    delayedOrdersCount: number;
    kitchenPendingCount: number;
    cashToday: number;
    todaySales: number;
    dailySalesGoal: number;
  }): SmartAlert[] {
    const alerts: SmartAlert[] = [];

    if (input.outOfStockCount > 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message: `Tienes ${input.outOfStockCount} producto(s) agotado(s). Repón cuanto antes para no perder ventas.`
      });
    }

    if (input.lowStockCount > 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message: `Tienes ${input.lowStockCount} producto(s) con stock bajo. Revísalos antes de que se agoten.`
      });
    }

    if (input.delayedOrdersCount > 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message: `Tienes ${input.delayedOrdersCount} pedido(s) retrasado(s) en cocina: llevan más de ${KITCHEN_DELAY_THRESHOLD_MINUTES} min esperando.`
      });
    }

    if (input.kitchenPendingCount >= KITCHEN_BACKLOG_ALERT_THRESHOLD) {
      alerts.push({
        level: "ORANGE",
        icon: "🟠",
        message: `Se están acumulando comandas en cocina: ${input.kitchenPendingCount} pendientes. Vale la pena revisarla.`
      });
    }

    if (input.salesGrowthPercent <= -15 && input.todaySalesCount > 0) {
      alerts.push({
        level: "ORANGE",
        icon: "🟠",
        message: `Las ventas de hoy van ${Math.abs(input.salesGrowthPercent)}% por debajo de ayer. Vale la pena revisar qué está pasando.`
      });
    }

    if (input.cashToday < 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message: "La caja de hoy está en saldo negativo. Revisa los movimientos registrados."
      });
    }

    if (input.salesGrowthPercent >= 15 && input.todaySalesCount > 0) {
      alerts.push({
        level: "GREEN",
        icon: "🟢",
        message: `Hoy vas ${input.salesGrowthPercent}% mejor que ayer. Sigue así.`
      });
    }

    // Meta alcanzada: solo si hay una meta configurada en Configuración > Impuestos y moneda.
    if (input.dailySalesGoal > 0 && input.todaySales >= input.dailySalesGoal) {
      alerts.push({
        level: "GREEN",
        icon: "🟢",
        message: `¡Meta del día alcanzada! Llevas ${Math.round(
          (input.todaySales / input.dailySalesGoal) * 100
        )}% de la meta diaria.`
      });
    }

    if (alerts.length === 0) {
      alerts.push({
        level: "GREEN",
        icon: "🟢",
        message: "Todo en orden: sin alertas críticas en este momento."
      });
    }

    const priority: Record<SmartAlert["level"], number> = { RED: 0, ORANGE: 1, GREEN: 2 };
    return alerts.sort((a, b) => priority[a.level] - priority[b.level]);
  }
}