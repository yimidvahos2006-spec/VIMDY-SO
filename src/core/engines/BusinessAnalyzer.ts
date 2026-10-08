import { Order, Table, User, Customer, Sale, CashMovement, Product, InventoryMovement, Shift } from "../entities/Entities";
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
import { getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { getSaleNetTotal, getSaleNetItems, VALID_SALE_STATUSES } from "../utils/saleRefunds";
import {
  buildWeightedAverageCostMap,
  buildWeightedAverageCostTimeline,
  getHistoricalLineProfit,
  getWeightedAverageCostAt,
  type WeightedAverageCostMap
} from "../utils/historicalProfit";
import {
  getBusinessDateKey,
  getYesterdayKey,
  getDayKeyForOffset,
  startOfBusinessDay,
  startOfBusinessWeek,
  startOfBusinessMonth
} from "../utils/businessTime";

const DAY_LABELS = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
const RECENT_WINDOW_DAYS = 30;
const REORDER_COVERAGE_DAYS = 14;
const KITCHEN_DELAY_THRESHOLD_MINUTES = 20;
const KITCHEN_BACKLOG_ALERT_THRESHOLD = 5;
const SUSPICIOUS_LOSS_OCCURRENCES = 3;
const SUSPICIOUS_LOSS_VALUE = 100000;
const STOCK_EPSILON = 0.01;
const SALE_CONSUMPTION_TOLERANCE = 0.02;
const SALE_REVERSAL_ACTIONS = ["SALE_CANCELLED", "SALE_REFUNDED", "SALE_PARTIALLY_REFUNDED"];

function fixed2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function getBusinessDateParts(date: Date, tz: string): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);

  const map = new Map(parts.map((part) => [part.type, part.value]));
  return {
    year: Number(map.get("year")),
    month: Number(map.get("month")),
    day: Number(map.get("day"))
  };
}

function getBusinessWeekdayIndex(date: Date, tz: string): number {
  const parts = getBusinessDateParts(date, tz);
  return new Date(Date.UTC(parts.year, parts.month - 1, parts.day)).getUTCDay();
}

function isSameDay(a: Date, b: Date, tz: string): boolean {
  const da = getBusinessDateParts(a, tz);
  const db = getBusinessDateParts(b, tz);
  return da.year === db.year && da.month === db.month && da.day === db.day;
}

function daysAgo(date: Date, from: Date): number {
  return (from.getTime() - date.getTime()) / 86400000;
}

function minutesAgo(date: Date, from: Date): number {
  return (from.getTime() - date.getTime()) / 60000;
}

export interface DashboardProfitSnapshot {
  readonly grossRevenue: number;
  readonly netRevenue: number;
  readonly totalCost: number;
  readonly totalProfit: number;
  readonly marginPercentage: number;
  readonly ivaCollected: number;
  readonly impoconsumoCollected: number;
  readonly unreliableCostCount: number;
}

export interface HistoricalMarginAnalysis {
  readonly revenue: number;
  readonly netRevenue: number;
  readonly cost: number;
  readonly profit: number;
  readonly marginPercent: number;
  readonly iva: number;
  readonly impoconsumo: number;
  readonly totalIndirectTax: number;
  readonly reliableLines: number;
  readonly unreliableLines: number;
  readonly weightedAverageCostCount: number;
}

export type KardexIssueKind =
  | "ORPHAN_MOVEMENT"
  | "STOCK_CHAIN_BREAK"
  | "MOVEMENT_DELTA_MISMATCH"
  | "CURRENT_STOCK_MISMATCH"
  | "LOW_CONFIDENCE"
  | "SALE_CONSUMPTION_MISMATCH";

export interface KardexIntegrityIssue {
  readonly productId: string;
  readonly productName: string;
  readonly kind: KardexIssueKind;
  readonly severity: "HIGH" | "MEDIUM" | "INFO";
  readonly message: string;
}

export interface SuspiciousLoss {
  readonly productId: string;
  readonly productName: string;
  readonly value: number;
  readonly occurrences: number;
  readonly suspicious: boolean;
}

export interface KardexIntegrityAnalysis {
  readonly productsAnalyzed: number;
  readonly movementsAnalyzed: number;
  readonly issueCount: number;
  readonly highSeverityCount: number;
  readonly lowConfidenceCount: number;
  readonly issues: readonly KardexIntegrityIssue[];
  readonly suspiciousLosses: readonly SuspiciousLoss[];
  readonly alerts: readonly SmartAlert[];
}

export interface ClosedShiftAnalysis {
  readonly analyzed: number;
  readonly suspiciousCount: number;
  readonly rows: readonly {
    readonly shiftId: string;
    readonly cashierId: string;
    readonly openingAmount: number;
    readonly expectedAmount: number;
    readonly countedAmount: number;
    readonly difference: number;
    readonly movementCount: number;
    readonly suspicious: boolean;
  }[];
  readonly alerts: readonly SmartAlert[];
}

export interface BusinessAnalyzerRepositories {
  readonly saleRepository: IRepository<Sale>;
  readonly productRepository: IRepository<Product>;
  readonly movementRepository: IRepository<InventoryMovement>;
}

export interface ShiftClosureIntelligence {
  readonly shiftId: string;
  readonly saleCount: number;
  readonly revenue: number;
  readonly netRevenue: number;
  readonly cost: number;
  readonly profit: number;
  readonly marginPercent: number;
  readonly iva: number;
  readonly impoconsumo: number;
  readonly totalIndirectTax: number;
  readonly reliableLines: number;
  readonly unreliableLines: number;
  readonly wasteUnits: number;
  readonly wasteValue: number;
  readonly unreliableWasteValue: boolean;
  readonly stockDiscrepancies: readonly {
    readonly productId: string;
    readonly productName: string;
    readonly theoreticalStock: number;
    readonly realStock: number;
    readonly difference: number;
  }[];
}

export class BusinessAnalyzer {
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
    private readonly recipeEngine: RecipeEngine,
    private readonly kardexEngine: KardexEngine,
    private readonly forecastEngine: ForecastEngine,
    private readonly purchaseIntelligenceEngine: PurchaseIntelligenceEngine,
    private readonly auditEngine: AuditEngine
  ) {}

  public async buildSnapshot(
    businessName: string,
    currency: string
  ): Promise<BusinessSnapshot> {
    const [
      summary,
      products,
      lowStock,
      orders,
      tables,
      users,
      customers,
      cashBalance,
      cashToday,
      cashMovements,
      inventoryMovements,
      forecastSummary,
      purchaseRecommendations,
      saleReversalLogs
    ] = await Promise.all([
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
      this.kardexEngine.getAllMovements(),
      this.forecastEngine.getSummary(),
      this.purchaseIntelligenceEngine.getRecommendations(),
      this.auditEngine.getByActions(SALE_REVERSAL_ACTIONS)
    ]);

    // ProductCatalogStore es una proyección reactiva del mismo InventoryEngine.
    // BusinessAnalyzer consume ese mismo snapshot mediante DI para no crear un
    // ciclo CompositionRoot -> BusinessAnalyzer -> ProductCatalogStore.
    const catalogSnapshot = products;
    const productById = new Map(catalogSnapshot.map((product) => [product.id, product]));
    const userNameById = new Map(users.map((user) => [user.id, user.name]));
    const tableNameById = new Map(tables.map((table) => [table.id, table.name]));
    const weightedAverageCosts = buildWeightedAverageCostMap(
      inventoryMovements,
      catalogSnapshot
    );

    const now = new Date();
    const timezone = companyConfigStore.get().timezone || "America/Bogota";
    const todayKey = getBusinessDateKey(now, timezone);
    const yesterdayKey = getYesterdayKey(now, timezone);

    const todaySalesList = summary.sales.filter(
      (sale) => sale.createdAt && getBusinessDateKey(new Date(sale.createdAt), timezone) === todayKey
    );
    const yesterdaySalesList = summary.sales.filter(
      (sale) => sale.createdAt && getBusinessDateKey(new Date(sale.createdAt), timezone) === yesterdayKey
    );

    const todaySales = fixed2(
      todaySalesList.reduce((sum, sale) => sum + getSaleNetTotal(sale), 0)
    );
    const yesterdaySales = fixed2(
      yesterdaySalesList.reduce((sum, sale) => sum + getSaleNetTotal(sale), 0)
    );
    const totalSalesAllTime = fixed2(
      summary.sales.reduce((sum, sale) => sum + getSaleNetTotal(sale), 0)
    );
    const averageTicketToday = todaySalesList.length > 0
      ? fixed2(todaySales / todaySalesList.length)
      : 0;

    const salesGrowthPercent = yesterdaySales === 0
      ? todaySales > 0 ? 100 : 0
      : Math.round(((todaySales - yesterdaySales) / yesterdaySales) * 100);

    const totalsByWeekday = new Map<number, number>();
    const countByWeekday = new Map<number, number>();
    for (const sale of summary.sales) {
      if (!VALID_SALE_STATUSES.has(sale.status!)) continue;
      const weekday = getBusinessWeekdayIndex(new Date(sale.createdAt), timezone);
      totalsByWeekday.set(
        weekday,
        (totalsByWeekday.get(weekday) ?? 0) + getSaleNetTotal(sale)
      );
      countByWeekday.set(
        weekday,
        (countByWeekday.get(weekday) ?? 0) + 1
      );
    }

    let bestDayOfWeek: BusinessSnapshot["bestDayOfWeek"] = null;
    if (totalsByWeekday.size > 0) {
      const [index, total] = [...totalsByWeekday.entries()].reduce(
        (best, current) => current[1] > best[1] ? current : best
      );
      bestDayOfWeek = {
        day: DAY_LABELS[index],
        total: fixed2(total)
      };
    }

    const productAgg = new Map<
      string,
      { quantity: number; revenue: number; profit: number; reliableRevenue: number }
    >();
    const productAgg30d = new Map<string, number>();

    for (const sale of summary.sales) {
      if (!VALID_SALE_STATUSES.has(sale.status!)) continue;
      const recent = daysAgo(new Date(sale.createdAt), now) <= RECENT_WINDOW_DAYS;

      for (const item of getSaleNetItems(sale)) {
        const current = productAgg.get(item.productId) ?? {
          quantity: 0,
          revenue: 0,
          profit: 0,
          reliableRevenue: 0
        };

        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;

        const line = getHistoricalLineProfit(item, {
          product: productById.get(item.productId),
          weightedAverageCosts,
          fallbackIvaRate: companyConfigStore.get().tax
        });

        if (!line.costUnreliable) {
          current.profit += line.profit;
          current.reliableRevenue += line.netRevenue;
        }

        productAgg.set(item.productId, current);

        if (recent) {
          productAgg30d.set(
            item.productId,
            (productAgg30d.get(item.productId) ?? 0) + item.quantity
          );
        }
      }
    }

    const topProducts = [...productAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([productId, aggregate]) => ({
        name: productById.get(productId)?.name ?? productId,
        quantity: fixed2(aggregate.quantity),
        revenue: fixed2(aggregate.revenue)
      }));

    const topProfitProducts = [...productAgg.entries()]
      .map(([productId, aggregate]) => {
        const product = productById.get(productId);
        if (!product || aggregate.reliableRevenue <= 0) return null;
        return {
          name: product.name,
          unitsSold: fixed2(aggregate.quantity),
          profit: fixed2(aggregate.profit),
          marginPercent: Math.round((aggregate.profit / aggregate.reliableRevenue) * 100)
        };
      })
      .filter((row): row is NonNullable<typeof row> => row !== null && row.profit > 0)
      .sort((a, b) => b.profit - a.profit)
      .slice(0, 5);

    const monthStart = startOfBusinessMonth(now, timezone);
    const monthLossMovements = inventoryMovements.filter(
      (movement) =>
        movement.type === "DECREASE" &&
        Boolean(movement.lossCategory) &&
        new Date(movement.date).getTime() >= monthStart.getTime()
    );

    const lossByProduct = new Map<string, number>();
    const lossByCategoryValue = new Map<string, number>();
    let monthLoss = 0;

    for (const movement of monthLossMovements) {
      const product = productById.get(movement.productId);
      const weighted = weightedAverageCosts.get(movement.productId);
      if (!product || !weighted?.reliable) continue;

      const value = fixed2(weighted.unitCost * movement.quantity);
      monthLoss += value;
      lossByProduct.set(
        product.name,
        (lossByProduct.get(product.name) ?? 0) + value
      );

      if (movement.lossCategory) {
        const label = LOSS_CATEGORY_LABEL[movement.lossCategory];
        lossByCategoryValue.set(
          label,
          (lossByCategoryValue.get(label) ?? 0) + value
        );
      }
    }

    const topLossProductEntry = [...lossByProduct.entries()]
      .sort((a, b) => b[1] - a[1])[0] ?? null;
    const topLossCategoryEntry = [...lossByCategoryValue.entries()]
      .sort((a, b) => b[1] - a[1])[0] ?? null;

    const lossSummary = {
      monthLoss: fixed2(monthLoss),
      topLossProduct: topLossProductEntry
        ? { name: topLossProductEntry[0], value: fixed2(topLossProductEntry[1]) }
        : null,
      topLossCategory: topLossCategoryEntry
        ? { label: topLossCategoryEntry[0], value: fixed2(topLossCategoryEntry[1]) }
        : null
    };

    const productionAlerts = [...productById.values()]
      .map((product) => this.recipeEngine.getProductionStatus(product, productById))
      .filter(
        (status): status is NonNullable<typeof status> =>
          status !== null && status.level !== "OK"
      )
      .map((status) => ({
        productId: status.productId,
        productName: status.productName,
        status: status.status,
        level: status.level as "ADVERTENCIA" | "CRITICO",
        maxUnits: status.maxUnits,
        limitingIngredientName: status.limitingIngredient?.name ?? null
      }));

    const employeeAgg = new Map<string, { salesCount: number; revenue: number }>();
    for (const sale of summary.sales) {
      if (!VALID_SALE_STATUSES.has(sale.status!)) continue;
      const employeeIds = new Set(
        [sale.cashierId, sale.waiterId].filter(Boolean) as string[]
      );
      for (const employeeId of employeeIds) {
        const current = employeeAgg.get(employeeId) ?? {
          salesCount: 0,
          revenue: 0
        };
        current.salesCount += 1;
        current.revenue += getSaleNetTotal(sale);
        employeeAgg.set(employeeId, current);
      }
    }

    const topEmployees = [...employeeAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)
      .slice(0, 5)
      .map(([employeeId, aggregate]) => ({
        name: userNameById.get(employeeId) ?? "Empleado sin nombre registrado",
        salesCount: aggregate.salesCount,
        revenue: fixed2(aggregate.revenue)
      }));

    const refundAgg = new Map<
      string,
      { cancelCount: number; refundCount: number }
    >();
    for (const log of saleReversalLogs) {
      if (!log.actorId || log.actorId === "system") continue;
      const current = refundAgg.get(log.actorId) ?? {
        cancelCount: 0,
        refundCount: 0
      };
      if (log.action === "SALE_CANCELLED") {
        current.cancelCount += 1;
      } else {
        current.refundCount += 1;
      }
      refundAgg.set(log.actorId, current);
    }

    const topRefundingEmployees = [...refundAgg.entries()]
      .map(([employeeId, aggregate]) => ({
        name: userNameById.get(employeeId) ?? "Empleado sin nombre registrado",
        cancelCount: aggregate.cancelCount,
        refundCount: aggregate.refundCount,
        total: aggregate.cancelCount + aggregate.refundCount
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 5);

    const purchaseSuggestions = lowStock
      .map((product) => {
        const sold30d = productAgg30d.get(product.id) ?? 0;
        const avgDailySales = sold30d / RECENT_WINDOW_DAYS;
        const daysUntilStockout = avgDailySales > 0
          ? Math.floor(product.stock / avgDailySales)
          : null;
        const suggestedQuantity = Math.max(
          Math.ceil(avgDailySales * REORDER_COVERAGE_DAYS) - product.stock,
          product.minStock - product.stock,
          1
        );
        return {
          productId: product.id,
          name: product.name,
          currentStock: fixed2(product.stock),
          avgDailySales: Math.round(avgDailySales * 10) / 10,
          daysUntilStockout,
          suggestedQuantity,
          hasSalesHistory: avgDailySales > 0,
          supplierId: product.supplierId
        };
      })
      .sort((a, b) => (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999))
      .slice(0, 8);

    const slowMovers = catalogSnapshot
      .filter(
        (product) =>
          product.trackStock !== false &&
          (product.stock ?? 0) > 0 &&
          (product.active ?? true)
      )
      .map((product) => ({
        name: product.name,
        stock: fixed2(product.stock),
        unitsSoldLast30Days: fixed2(productAgg30d.get(product.id) ?? 0)
      }))
      .filter((row) => row.unitsSoldLast30Days <= 1)
      .sort((a, b) => b.stock - a.stock)
      .slice(0, 8);

    const tableDurations = new Map<
      string,
      { totalMinutes: number; count: number }
    >();
    for (const order of orders) {
      if (
        order.source !== "TABLE" ||
        !order.tableId ||
        (order.status !== "DELIVERED" && order.status !== "COMPLETED")
      ) continue;

      const minutes =
        (new Date(order.updatedAt).getTime() -
          new Date(order.createdAt).getTime()) / 60000;
      if (minutes <= 0 || minutes > 24 * 60) continue;

      const current = tableDurations.get(order.tableId) ?? {
        totalMinutes: 0,
        count: 0
      };
      current.totalMinutes += minutes;
      current.count += 1;
      tableDurations.set(order.tableId, current);
    }

    const tableTurnover = [...tableDurations.entries()]
      .map(([tableId, aggregate]) => ({
        tableName: tableNameById.get(tableId) ?? tableId,
        avgMinutes: Math.round(aggregate.totalMinutes / aggregate.count),
        ordersCount: aggregate.count
      }))
      .sort((a, b) => b.avgMinutes - a.avgMinutes)
      .slice(0, 8);

    const tableStatusCounts = {
      free: tables.filter((table) => table.status === "FREE").length,
      busy: tables.filter((table) => table.status === "BUSY").length,
      waitingFood: tables.filter((table) => table.status === "WAITING_FOOD").length,
      waitingBill: tables.filter((table) => table.status === "WAITING_BILL").length,
      paying: tables.filter((table) => table.status === "PAYING").length,
      reserved: tables.filter((table) => table.status === "RESERVED").length,
      total: tables.length
    };

    const delayedOrders = summary.kitchen
      .filter(
        (order) =>
          order.status === "PENDIENTE" ||
          order.status === "EN_PREPARACION"
      )
      .map((order) => ({
        origin: order.origin ?? "Pedido",
        status: order.status,
        minutesWaiting: Math.round(
          minutesAgo(new Date(order.createdAt), now)
        )
      }))
      .filter(
        (row) => row.minutesWaiting >= KITCHEN_DELAY_THRESHOLD_MINUTES
      )
      .sort((a, b) => b.minutesWaiting - a.minutesWaiting)
      .slice(0, 10);

    const customerLtv = new Map<
      string,
      { customer: Customer; total: number; count: number }
    >();
    for (const sale of summary.sales) {
      if (!VALID_SALE_STATUSES.has(sale.status!) || !sale.customerId) continue;
      const customer = customers.find((item) => item.id === sale.customerId);
      if (!customer) continue;
      const current = customerLtv.get(sale.customerId) ?? {
        customer,
        total: 0,
        count: 0
      };
      current.total += getSaleNetTotal(sale);
      current.count += 1;
      customerLtv.set(sale.customerId, current);
    }

    const topCustomers = [...customerLtv.values()]
      .sort((a, b) => b.total - a.total)
      .slice(0, 5)
      .map((row) => ({
        name: row.customer.name,
        totalSpent: fixed2(row.total),
        purchaseCount: row.count
      }));

    const newCustomersToday = customers.filter(
      (customer) =>
        customer.createdAt &&
        isSameDay(new Date(customer.createdAt), now, timezone)
    ).length;

    let weeklyForecast: BusinessSnapshot["weeklyForecast"] = null;
    if (summary.sales.length >= 7) {
      const oldestSaleMs = Math.min(
        ...summary.sales.map((sale) => new Date(sale.createdAt).getTime())
      );
      const weeksOfData = Math.max(
        1,
        Math.round(daysAgo(new Date(oldestSaleMs), now) / 7)
      );
      const startOfWeekday = getBusinessWeekdayIndex(now, timezone);
      const byDay = Array.from({ length: 7 }, (_, i) => {
        const dayIndex = (startOfWeekday + 1 + i) % 7;
        const total = totalsByWeekday.get(dayIndex) ?? 0;
        const count = countByWeekday.get(dayIndex) ?? 0;
        const avgPerOccurrence = count > 0
          ? total / Math.max(1, Math.round(count / weeksOfData))
          : 0;
        return {
          day: DAY_LABELS[dayIndex],
          projected: Math.round(avgPerOccurrence)
        };
      });
      weeklyForecast = {
        projectedTotal: byDay.reduce((sum, row) => sum + row.projected, 0),
        byDay,
        basedOnWeeks: weeksOfData
      };
    }

    const trackedProducts = catalogSnapshot.filter(
      (product) => product.trackStock !== false
    );
    const outOfStockProductsList = trackedProducts.filter(
      (product) => (product.active ?? true) && product.stock <= 0
    );
    const outOfStockCount = outOfStockProductsList.length;
    const outOfStockProducts = outOfStockProductsList
      .slice(0, 10)
      .map((product) => product.name);

    const todayProductAgg = new Map<
      string,
      { quantity: number; revenue: number }
    >();
    const todayEmployeeAgg = new Map<
      string,
      { salesCount: number; revenue: number }
    >();
    let todayProfit = 0;

    for (const sale of todaySalesList) {
      for (const item of getSaleNetItems(sale)) {
        const current = todayProductAgg.get(item.productId) ?? {
          quantity: 0,
          revenue: 0
        };
        current.quantity += item.quantity;
        current.revenue += item.quantity * item.price;
        todayProductAgg.set(item.productId, current);

        const line = getHistoricalLineProfit(item, {
          product: productById.get(item.productId),
          weightedAverageCosts,
          fallbackIvaRate: companyConfigStore.get().tax
        });
        if (!line.costUnreliable) {
          todayProfit += line.profit;
        }
      }

      const employeeIds = new Set(
        [sale.cashierId, sale.waiterId].filter(Boolean) as string[]
      );
      for (const employeeId of employeeIds) {
        const current = todayEmployeeAgg.get(employeeId) ?? {
          salesCount: 0,
          revenue: 0
        };
        current.salesCount += 1;
        current.revenue += getSaleNetTotal(sale);
        todayEmployeeAgg.set(employeeId, current);
      }
    }

    const todayTopProductEntry = [...todayProductAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)[0];
    const todayTopProduct = todayTopProductEntry
      ? {
          name:
            productById.get(todayTopProductEntry[0])?.name ??
            todayTopProductEntry[0],
          quantity: fixed2(todayTopProductEntry[1].quantity),
          revenue: fixed2(todayTopProductEntry[1].revenue)
        }
      : null;

    let starProductCapacity: BusinessSnapshot["starProductCapacity"] = null;
    if (todayTopProductEntry) {
      const starProduct = productById.get(todayTopProductEntry[0]);
      if (starProduct) {
        const capacity = this.recipeEngine.getProductionCapacity(
          starProduct,
          productById
        );
        starProductCapacity = capacity
          ? {
              productName: starProduct.name,
              maxUnits: capacity.maxUnits,
              basedOn: "RECETA"
            }
          : {
              productName: starProduct.name,
              maxUnits: starProduct.stock,
              basedOn: "STOCK"
            };
      }
    }

    const todayTopEmployeeEntry = [...todayEmployeeAgg.entries()]
      .sort((a, b) => b[1].revenue - a[1].revenue)[0];
    const todayTopEmployee = todayTopEmployeeEntry
      ? {
          name:
            userNameById.get(todayTopEmployeeEntry[0]) ??
            "Empleado sin nombre registrado",
          salesCount: todayTopEmployeeEntry[1].salesCount,
          revenue: fixed2(todayTopEmployeeEntry[1].revenue)
        }
      : null;

    const kitchenPendingCount = summary.kitchen.filter(
      (order) => order.status !== "ENTREGADO" && order.status !== "CANCELADO"
    ).length;
    const criticalAlertsCount = summary.alerts.filter(
      (alert) => alert.priority === "CRITICAL"
    ).length;

    const PREDICTION_HISTORY_DAYS = 14;
    const dailySalesHistory = Array.from(
      { length: PREDICTION_HISTORY_DAYS },
      (_, index) => {
        const daysBack = PREDICTION_HISTORY_DAYS - 1 - index;
        const dayKey = getDayKeyForOffset(now, timezone, daysBack);
        return summary.sales
          .filter(
            (sale) =>
              sale.createdAt &&
              getBusinessDateKey(
                new Date(sale.createdAt),
                timezone
              ) === dayKey
          )
          .reduce(
            (sum, sale) => sum + getSaleNetTotal(sale),
            0
          );
      }
    );

    const aiInsights = this.buildAIInsights({
      sales: summary.sales,
      products: catalogSnapshot,
      customers,
      movements: cashMovements,
      dailySalesHistory
    });

    const integrityAnalysis = this.buildKardexIntegrityAnalysis({
      products: catalogSnapshot,
      movements: inventoryMovements,
      sales: summary.sales,
      weightedAverageCosts
    });

    const baseAlerts = this.generateSmartAlerts({
      outOfStockCount,
      lowStockCount: lowStock.length,
      salesGrowthPercent,
      todaySalesCount: todaySalesList.length,
      delayedOrdersCount: delayedOrders.length,
      kitchenPendingCount,
      cashToday,
      todaySales,
      dailySalesGoal: companyConfigStore.get().dailySalesGoal
    });

    const smartAlerts = [
      ...baseAlerts,
      ...integrityAnalysis.alerts
    ].slice(0, 40);

    return {
      businessName,
      currency,
      todaySales,
      yesterdaySales,
      salesGrowthPercent,
      totalSalesAllTime,
      totalOrdersToday: todaySalesList.length,
      averageTicketToday,
      todayProfit: fixed2(todayProfit),
      todayTopProduct,
      todayTopEmployee,
      outOfStockProducts,
      bestDayOfWeek,
      topProducts,
      lowStockProducts: lowStock.slice(0, 10).map((product) => ({
        name: product.name,
        stock: product.stock,
        minStock: product.minStock
      })),
      productionAlerts,
      topProfitProducts,
      lossSummary,
      starProductCapacity,
      topEmployees,
      topRefundingEmployees,
      purchaseSuggestions,
      forecastSummary,
      purchaseRecommendations,
      slowMovers,
      tableTurnover,
      weeklyForecast,
      cash: {
        balance: cashBalance,
        todayBalance: cashToday
      },
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
      learnedPatterns: [],
      generatedAt: now.toISOString()
    };
  }

  /**
   * Calcula la rentabilidad financiera del turno activo usando las mismas
   * fuentes de verdad que el resto del BusinessAnalyzer: ventas cobradas,
   * catálogo de productos y Kardex histórico.
   *
   * La venta primero se restringe al branch actual y al shift solicitado;
   * después cada línea se valora con prioridad absoluta en unitCostAtSale y,
   * cuando ese snapshot no existe, con el WAC vigente en la fecha de la venta.
   */
  public async computeShiftProfitability(
    shift: Shift
  ): Promise<DashboardProfitSnapshot> {
    if (!shift?.id) {
      throw new Error("SHIFT_ID_REQUIRED");
    }

    const currentBranchId =
      shift.branchId ?? getCurrentBranchId() ?? undefined;

    const [summary, products, movements] = await Promise.all([
      this.dashboardEngine.getExecutiveSummary(),
      this.inventoryEngine.listAll(),
      this.kardexEngine.getAllMovements()
    ]);

    const branchProducts = products.filter((product) =>
      !currentBranchId ||
      !product.branchId ||
      product.branchId === currentBranchId
    );

    const productById = new Map(
      branchProducts.map((product) => [product.id, product])
    );

    const branchMovements = movements.filter((movement) =>
      !currentBranchId ||
      movement.branchId === currentBranchId
    );

    const timeline = buildWeightedAverageCostTimeline(
      branchMovements,
      branchProducts
    );

    const branchSales = summary.sales.filter((sale) => {
      if (sale.shiftId !== shift.id) return false;
      if (!VALID_SALE_STATUSES.has(sale.status!)) return false;

      if (currentBranchId && sale.branchId !== currentBranchId) {
        return false;
      }

      return true;
    });

    let grossRevenue = 0;
    let netRevenue = 0;
    let totalCost = 0;
    let totalProfit = 0;
    let ivaCollected = 0;
    let impoconsumoCollected = 0;
    let unreliableCostCount = 0;

    for (const sale of branchSales) {
      const saleDate = sale.createdAt instanceof Date
        ? sale.createdAt
        : new Date(sale.createdAt);

      if (Number.isNaN(saleDate.getTime())) {
        continue;
      }

      for (const item of getSaleNetItems(sale)) {
        const line = getHistoricalLineProfit(item, {
          product: productById.get(item.productId),
          weightedAverageCostTimeline: timeline,
          saleDate,
          fallbackIvaRate: companyConfigStore.get().tax
        });

        grossRevenue += line.revenue;
        netRevenue += line.netRevenue;
        ivaCollected += line.ivaAmount;
        impoconsumoCollected += line.impoconsumoAmount;

        if (line.costUnreliable) {
          unreliableCostCount += 1;
          continue;
        }

        totalCost += line.cost;
        totalProfit += line.profit;
      }
    }

    const safeNetRevenue = fixed2(netRevenue);
    const safeProfit = fixed2(totalProfit);

    return {
      grossRevenue: fixed2(grossRevenue),
      netRevenue: safeNetRevenue,
      totalCost: fixed2(totalCost),
      totalProfit: safeProfit,
      marginPercentage: safeNetRevenue > 0
        ? fixed2((safeProfit / safeNetRevenue) * 100)
        : 0,
      ivaCollected: fixed2(ivaCollected),
      impoconsumoCollected: fixed2(impoconsumoCollected),
      unreliableCostCount
    };
  }

  /**
   * Inteligencia del cierre: usa explícitamente las tres fuentes de verdad
   * persistidas (ventas, catálogo y Kardex). El cierre financiero en sí mismo
   * sigue siendo responsabilidad de ShiftEngine/close_shift_atomic(); este
   * método analiza el resultado ya cerrado y no intenta reabrir ni mutar el
   * turno.
   */
  public async analyzeShiftClosure(
    shift: Shift,
    repositories: BusinessAnalyzerRepositories
  ): Promise<ShiftClosureIntelligence> {
    if (shift.status !== "CLOSED") {
      throw new Error("SHIFT_NOT_CLOSED");
    }

    const closedAt = shift.closedAt instanceof Date
      ? shift.closedAt
      : shift.closedAt
        ? new Date(shift.closedAt)
        : null;
    if (!closedAt || Number.isNaN(closedAt.getTime())) {
      throw new Error("SHIFT_CLOSURE_DATE_MISSING");
    }

    const openedAt = shift.openedAt instanceof Date
      ? shift.openedAt
      : new Date(shift.openedAt);
    if (Number.isNaN(openedAt.getTime())) {
      throw new Error("SHIFT_OPEN_DATE_INVALID");
    }

    const [sales, products, movements] = await Promise.all([
      repositories.saleRepository.findAll(),
      repositories.productRepository.findAll(),
      repositories.movementRepository.findAll()
    ]);

    const shiftSales = sales.filter((sale) => {
      if (sale.shiftId !== shift.id) return false;
      if (!VALID_SALE_STATUSES.has(sale.status!)) return false;
      const createdAt = sale.createdAt instanceof Date
        ? sale.createdAt
        : new Date(sale.createdAt);
      return createdAt.getTime() >= openedAt.getTime() &&
        createdAt.getTime() <= closedAt.getTime();
    });

    const timeline = buildWeightedAverageCostTimeline(movements, products);
    const productById = new Map(products.map((product) => [product.id, product]));

    let revenue = 0;
    let netRevenue = 0;
    let cost = 0;
    let profit = 0;
    let iva = 0;
    let impoconsumo = 0;
    let reliableLines = 0;
    let unreliableLines = 0;

    for (const sale of shiftSales) {
      const saleDate = sale.createdAt instanceof Date
        ? sale.createdAt
        : new Date(sale.createdAt);

      for (const item of getSaleNetItems(sale)) {
        const line = getHistoricalLineProfit(item, {
          product: productById.get(item.productId),
          weightedAverageCostTimeline: timeline,
          saleDate,
          fallbackIvaRate: companyConfigStore.get().tax
        });

        revenue += line.revenue;
        netRevenue += line.netRevenue;
        iva += line.ivaAmount;
        impoconsumo += line.impoconsumoAmount;

        if (line.costUnreliable) {
          unreliableLines += 1;
        } else {
          reliableLines += 1;
          cost += line.cost;
          profit += line.profit;
        }
      }
    }

    const shiftMovements = movements.filter((movement) => {
      const date = movement.date instanceof Date
        ? movement.date
        : new Date(movement.date);
      return date.getTime() >= openedAt.getTime() &&
        date.getTime() <= closedAt.getTime();
    });

    let wasteUnits = 0;
    let wasteValue = 0;
    let unreliableWasteValue = false;

    for (const movement of shiftMovements) {
      if (movement.type !== "DECREASE" || !movement.lossCategory) continue;

      wasteUnits += Math.max(0, movement.quantity);
      const costAtMovement = getWeightedAverageCostAt(
        movement.productId,
        movement.date,
        timeline
      );

      if (!costAtMovement || !costAtMovement.reliable) {
        unreliableWasteValue = true;
        continue;
      }

      wasteValue += costAtMovement.unitCost * Math.max(0, movement.quantity);
    }

    const stockDiscrepancies: ShiftClosureIntelligence["stockDiscrepancies"][number][] = [];
    const affectedProducts = new Set(shiftMovements.map((movement) => movement.productId));

    for (const productId of affectedProducts) {
      const product = productById.get(productId);
      if (!product) continue;

      const productMovements = movements
        .filter((movement) => {
          if (movement.productId !== productId) return false;
          const date = movement.date instanceof Date
            ? movement.date
            : new Date(movement.date);
          return date.getTime() <= closedAt.getTime();
        })
        .sort((a, b) => a.date.getTime() - b.date.getTime());

      if (productMovements.length === 0) continue;

      let theoreticalStock: number | null = null;
      let reconstructable = true;

      for (const movement of productMovements) {
        if (theoreticalStock === null) {
          theoreticalStock = movement.stockBefore ?? null;
        }

        if (theoreticalStock === null) {
          reconstructable = false;
          if (movement.stockAfter !== undefined) {
            theoreticalStock = movement.stockAfter;
          }
          continue;
        }

        if (movement.stockBefore !== undefined &&
            Math.abs(theoreticalStock - movement.stockBefore) > STOCK_EPSILON) {
          reconstructable = false;
        }

        if (movement.type === "INCREASE") {
          theoreticalStock += movement.quantity;
        } else if (movement.type === "DECREASE") {
          theoreticalStock -= movement.quantity;
        } else if (movement.stockAfter !== undefined) {
          theoreticalStock = movement.stockAfter;
        } else {
          theoreticalStock += movement.quantity;
          reconstructable = false;
        }

        if (movement.stockAfter !== undefined &&
            Math.abs(theoreticalStock - movement.stockAfter) > STOCK_EPSILON) {
          reconstructable = false;
        }
      }

      if (theoreticalStock === null || !reconstructable) continue;

      const realStock = Math.max(0, product.stock);
      const difference = realStock - theoreticalStock;
      if (Math.abs(difference) > STOCK_EPSILON) {
        stockDiscrepancies.push({
          productId,
          productName: product.name,
          theoreticalStock: fixed2(theoreticalStock),
          realStock: fixed2(realStock),
          difference: fixed2(difference)
        });
      }
    }

    const safeNetRevenue = fixed2(netRevenue);
    const safeProfit = fixed2(profit);

    return {
      shiftId: shift.id,
      saleCount: shiftSales.length,
      revenue: fixed2(revenue),
      netRevenue: safeNetRevenue,
      cost: fixed2(cost),
      profit: safeProfit,
      marginPercent: safeNetRevenue > 0
        ? fixed2((safeProfit / safeNetRevenue) * 100)
        : 0,
      iva: fixed2(iva),
      impoconsumo: fixed2(impoconsumo),
      totalIndirectTax: fixed2(iva + impoconsumo),
      reliableLines,
      unreliableLines,
      wasteUnits: fixed2(wasteUnits),
      wasteValue: fixed2(wasteValue),
      unreliableWasteValue,
      stockDiscrepancies
    };
  }

  public async analyzeHistoricalMargins(): Promise<HistoricalMarginAnalysis> {
    const [products, summary, movements] = await Promise.all([
      this.inventoryEngine.listAll(),
      this.dashboardEngine.getExecutiveSummary(),
      this.kardexEngine.getAllMovements()
    ]);

    const productById = new Map(products.map((product) => [product.id, product]));
    const weightedAverageCosts = buildWeightedAverageCostMap(
      movements,
      products
    );

    let revenue = 0;
    let netRevenue = 0;
    let cost = 0;
    let profit = 0;
    let iva = 0;
    let impoconsumo = 0;
    let reliableLines = 0;
    let unreliableLines = 0;

    for (const sale of summary.sales) {
      if (!VALID_SALE_STATUSES.has(sale.status!)) continue;

      for (const item of getSaleNetItems(sale)) {
        const line = getHistoricalLineProfit(item, {
          product: productById.get(item.productId),
          weightedAverageCosts,
          fallbackIvaRate: companyConfigStore.get().tax
        });

        revenue += line.revenue;
        netRevenue += line.netRevenue;
        iva += line.ivaAmount;
        impoconsumo += line.impoconsumoAmount;

        if (line.costUnreliable) {
          unreliableLines += 1;
          continue;
        }

        reliableLines += 1;
        cost += line.cost;
        profit += line.profit;
      }
    }

    return {
      revenue: fixed2(revenue),
      netRevenue: fixed2(netRevenue),
      cost: fixed2(cost),
      profit: fixed2(profit),
      marginPercent:
        netRevenue > 0 ? fixed2((profit / netRevenue) * 100) : 0,
      iva: fixed2(iva),
      impoconsumo: fixed2(impoconsumo),
      totalIndirectTax: fixed2(iva + impoconsumo),
      reliableLines,
      unreliableLines,
      weightedAverageCostCount: [...weightedAverageCosts.values()].filter(
        (row) => row.reliable
      ).length
    };
  }

  public async analyzeKardexIntegrity(): Promise<KardexIntegrityAnalysis> {
    const [products, movements] = await Promise.all([
      this.inventoryEngine.listAll(),
      this.kardexEngine.getAllMovements()
    ]);

    return this.buildKardexIntegrityAnalysis({
      products,
      movements,
      sales: [],
      weightedAverageCosts: buildWeightedAverageCostMap(
        movements,
        products
      )
    });
  }

  /**
   * Consume cierres de ShiftEngine ya obtenidos por la raíz DI.
   * BusinessAnalyzer no instancia ShiftEngine por fuera del CompositionRoot.
   */
  public async analyzeClosedShifts(
    closedShifts: readonly Shift[]
  ): Promise<ClosedShiftAnalysis> {
    const movements = await this.cashEngine.getAllMovements();
    const byShift = new Map<string, CashMovement[]>();

    for (const movement of movements) {
      if (!movement.shiftId) continue;
      const list = byShift.get(movement.shiftId) ?? [];
      list.push(movement);
      byShift.set(movement.shiftId, list);
    }

    const rows: Array<ClosedShiftAnalysis["rows"][number]> = [];
    const alerts: SmartAlert[] = [];

    for (const shift of closedShifts.filter((item) => item.status === "CLOSED")) {
      const shiftMovements = byShift.get(shift.id) ?? [];
      const cashIncome = shiftMovements
        .filter((movement) => movement.type === "IN")
        .reduce(
          (sum, movement) =>
            sum +
            (movement.cashAmount ??
              (movement.paymentMethod === "CASH" || !movement.paymentMethod
                ? movement.amount
                : 0)),
          0
        );
      const expenses = shiftMovements
        .filter((movement) => movement.type === "OUT")
        .reduce((sum, movement) => sum + movement.amount, 0);
      const expectedAmount = fixed2(
        shift.openingAmount + cashIncome - expenses
      );
      const countedAmount = fixed2(
        shift.countedAmount ?? expectedAmount
      );
      const difference = fixed2(
        countedAmount - expectedAmount
      );
      const suspicious = Math.abs(difference) > STOCK_EPSILON;

      rows.push({
        shiftId: shift.id,
        cashierId: shift.cashierId,
        openingAmount: fixed2(shift.openingAmount),
        expectedAmount,
        countedAmount,
        difference,
        movementCount: shiftMovements.length,
        suspicious
      });

      if (suspicious) {
        const critical = Math.abs(difference) >= Math.max(10000, expectedAmount * 0.05);
        alerts.push({
          level: critical ? "RED" : "ORANGE",
          icon: critical ? "🔴" : "🟠",
          message:
            `El turno ${shift.id.slice(0, 8)} presenta una diferencia de ${difference >= 0 ? "+" : "-"}${Math.abs(difference).toFixed(2)} ${companyConfigStore.get().currency}. Revisa el arqueo y los movimientos del turno.`
        });
      }
    }

    return {
      analyzed: rows.length,
      suspiciousCount: rows.filter((row) => row.suspicious).length,
      rows,
      alerts
    };
  }

  private buildKardexIntegrityAnalysis(input: {
    products: readonly Product[];
    movements: readonly InventoryMovement[];
    sales: readonly Sale[];
    weightedAverageCosts: WeightedAverageCostMap;
  }): KardexIntegrityAnalysis {
    const productById = new Map(
      input.products.map((product) => [product.id, product])
    );
    const grouped = new Map<string, InventoryMovement[]>();

    for (const movement of input.movements) {
      const list = grouped.get(movement.productId) ?? [];
      list.push(movement);
      grouped.set(movement.productId, list);
    }

    const issues: KardexIntegrityIssue[] = [];
    const lossValueByProduct = new Map<string, number>();
    const lossCountByProduct = new Map<string, number>();

    for (const [productId, movements] of grouped.entries()) {
      const product = productById.get(productId);

      if (!product) {
        issues.push({
          productId,
          productName: productId,
          kind: "ORPHAN_MOVEMENT",
          severity: "HIGH",
          message:
            "Existe un movimiento de Kardex cuyo producto ya no existe en el catálogo."
        });
        continue;
      }

      const ordered = [...movements].sort(
        (a, b) => a.date.getTime() - b.date.getTime()
      );
      let reconstructed: number | null = null;
      let hasSnapshots = true;

      for (const movement of ordered) {
        if (
          movement.stockBefore === undefined ||
          movement.stockAfter === undefined
        ) {
          hasSnapshots = false;
        }

        if (reconstructed === null) {
          reconstructed = movement.stockBefore ?? null;
        }

        if (
          reconstructed !== null &&
          movement.stockBefore !== undefined &&
          Math.abs(reconstructed - movement.stockBefore) > STOCK_EPSILON
        ) {
          issues.push({
            productId,
            productName: product.name,
            kind: "STOCK_CHAIN_BREAK",
            severity: "HIGH",
            message:
              `La cadena del Kardex se rompe antes del movimiento ${movement.id.slice(0, 8)}: esperado ${reconstructed.toFixed(2)}, recibido ${movement.stockBefore.toFixed(2)}.`
          });
        }

        if (movement.type === "INCREASE") {
          if (reconstructed !== null) reconstructed += movement.quantity;
        } else if (movement.type === "DECREASE") {
          if (reconstructed !== null) reconstructed -= movement.quantity;
        } else if (movement.type === "ADJUST") {
          if (movement.stockAfter !== undefined) {
            reconstructed = movement.stockAfter;
          } else if (reconstructed !== null) {
            reconstructed += movement.quantity;
          }
        }

        if (
          reconstructed !== null &&
          movement.stockAfter !== undefined &&
          Math.abs(reconstructed - movement.stockAfter) > STOCK_EPSILON
        ) {
          issues.push({
            productId,
            productName: product.name,
            kind: "MOVEMENT_DELTA_MISMATCH",
            severity: "HIGH",
            message:
              `El movimiento ${movement.id.slice(0, 8)} declara stockAfter ${movement.stockAfter.toFixed(2)}, pero el delta produce ${reconstructed.toFixed(2)}.`
          });
        }

        if (movement.type === "DECREASE" && movement.lossCategory) {
          const weighted = input.weightedAverageCosts.get(productId);
          if (weighted?.reliable) {
            const value = fixed2(weighted.unitCost * movement.quantity);
            lossValueByProduct.set(
              productId,
              (lossValueByProduct.get(productId) ?? 0) + value
            );
            lossCountByProduct.set(
              productId,
              (lossCountByProduct.get(productId) ?? 0) + 1
            );
          }
        }
      }

      if (
        ordered.length > 0 &&
        reconstructed !== null &&
        Math.abs(reconstructed - product.stock) > STOCK_EPSILON
      ) {
        issues.push({
          productId,
          productName: product.name,
          kind: "CURRENT_STOCK_MISMATCH",
          severity: "HIGH",
          message:
            `El stock persistido es ${product.stock.toFixed(2)} y el Kardex reconstruye ${reconstructed.toFixed(2)}.`
        });
      }

      if (!hasSnapshots && ordered.length > 0) {
        issues.push({
          productId,
          productName: product.name,
          kind: "LOW_CONFIDENCE",
          severity: "INFO",
          message:
            "Parte del historial no tiene stockBefore/stockAfter; la reconstrucción matemática tiene confianza reducida."
        });
      }
    }

    if (input.sales.length > 0) {
      const soldByProduct = new Map<string, number>();
      for (const sale of input.sales) {
        if (!VALID_SALE_STATUSES.has(sale.status!)) continue;
        for (const item of getSaleNetItems(sale)) {
          soldByProduct.set(
            item.productId,
            (soldByProduct.get(item.productId) ?? 0) + item.quantity
          );
        }
      }

      for (const [productId, sold] of soldByProduct.entries()) {
        const product = productById.get(productId);
        if (!product || sold <= 0) continue;

        const salesMovements = (grouped.get(productId) ?? []).filter(
          (movement) =>
            movement.type === "DECREASE" &&
            !movement.lossCategory &&
            /venta|sale|pos/i.test(movement.reason)
        );
        const movementQuantity = salesMovements.reduce(
          (sum, movement) => sum + movement.quantity,
          0
        );

        if (
          movementQuantity > 0 &&
          Math.abs(movementQuantity - sold) >
            Math.max(STOCK_EPSILON, sold * SALE_CONSUMPTION_TOLERANCE)
        ) {
          issues.push({
            productId,
            productName: product.name,
            kind: "SALE_CONSUMPTION_MISMATCH",
            severity: "HIGH",
            message:
              `Las ventas registran ${sold.toFixed(2)} unidades consumidas de ${product.name}, pero el Kardex registra ${movementQuantity.toFixed(2)} en salidas asociadas a venta.`
          });
        }
      }
    }

    const suspiciousLosses: SuspiciousLoss[] = [
      ...lossValueByProduct.entries()
    ]
      .map(([productId, value]) => ({
        productId,
        productName: productById.get(productId)?.name ?? productId,
        value: fixed2(value),
        occurrences: lossCountByProduct.get(productId) ?? 0,
        suspicious:
          (lossCountByProduct.get(productId) ?? 0) >= SUSPICIOUS_LOSS_OCCURRENCES ||
          value >= SUSPICIOUS_LOSS_VALUE
      }))
      .sort((a, b) => b.value - a.value)
      .slice(0, 10);

    const alerts: SmartAlert[] = [];

    for (const issue of issues) {
      if (issue.severity === "INFO") continue;
      alerts.push({
        level: issue.severity === "HIGH" ? "RED" : "ORANGE",
        icon: issue.severity === "HIGH" ? "🔴" : "🟠",
        message: issue.message
      });
    }

    for (const loss of suspiciousLosses.filter((item) => item.suspicious)) {
      alerts.push({
        level: "ORANGE",
        icon: "🟠",
        message:
          `${loss.productName} acumula ${loss.occurrences} pérdidas por ${loss.value.toFixed(2)} ${companyConfigStore.get().currency}. Es un patrón anómalo que conviene revisar; no implica fraude por sí solo.`
      });
    }

    return {
      productsAnalyzed: input.products.length,
      movementsAnalyzed: input.movements.length,
      issueCount: issues.length,
      highSeverityCount: issues.filter((issue) => issue.severity === "HIGH").length,
      lowConfidenceCount: issues.filter((issue) => issue.severity === "INFO").length,
      issues,
      suspiciousLosses,
      alerts: alerts.slice(0, 20)
    };
  }

  private buildAIInsights(input: {
    sales: Sale[];
    products: Product[];
    customers: Customer[];
    movements: CashMovement[];
    dailySalesHistory: number[];
  }): AIInsightsSnapshot {
    const normalizedSales = input.sales.map((sale) => ({
      ...sale,
      createdAt: new Date(sale.createdAt)
    }));

    const previousSales =
      input.dailySalesHistory.length >= 2
        ? input.dailySalesHistory[input.dailySalesHistory.length - 2]
        : 0;
    const currentSales =
      input.dailySalesHistory.length >= 1
        ? input.dailySalesHistory[input.dailySalesHistory.length - 1]
        : 0;

    const timezone = companyConfigStore.get().timezone || "America/Bogota";
    const salesAnalysis = this.salesAI.generateAnalysis(
      normalizedSales,
      previousSales,
      timezone
    );
    const inventoryStatus = this.inventoryAI.generateInventoryStatus(
      input.products
    );
    const financeAnalysis = this.financeAI.generateFinanceAnalysis(
      normalizedSales,
      input.movements
    );
    const customerAnalysis = this.customerAI.generateCustomerAnalysis(
      input.customers,
      normalizedSales
    );
    const prediction = this.predictionAI.predictDailySales(
      input.dailySalesHistory
    );
    const growth = this.predictionAI.detectGrowth(
      input.dailySalesHistory
    );
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
        recommendations: this.inventoryAI.generatePurchaseRecommendations(
          input.products
        )
      },
      finance: {
        analysis: financeAnalysis,
        cashFlow: this.financeAI.calculateCashFlow(input.movements),
        status: this.financeAI.getFinancialStatus(
          normalizedSales,
          input.movements
        ),
        projectedIncome: this.financeAI.projectNextMonthIncome(normalizedSales),
        recommendation: this.financeAI.generateRecommendation(
          normalizedSales,
          input.movements
        )
      },
      customers: {
        analysis: customerAnalysis,
        bestCustomer: this.customerAI.getBestCustomer(
          input.customers,
          normalizedSales
        )
      },
      prediction: {
        ...prediction,
        recommendation: this.predictionAI.generateRecommendation(
          currentSales,
          growth
        )
      },
      recommendations
    };
  }

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
        message:
          `Tienes ${input.outOfStockCount} producto(s) agotado(s). Repón cuanto antes para no perder ventas.`
      });
    }

    if (input.lowStockCount > 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message:
          `Tienes ${input.lowStockCount} producto(s) con stock bajo. Revísalos antes de que se agoten.`
      });
    }

    if (input.delayedOrdersCount > 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message:
          `Tienes ${input.delayedOrdersCount} pedido(s) retrasado(s) en cocina: llevan más de ${KITCHEN_DELAY_THRESHOLD_MINUTES} min esperando.`
      });
    }

    if (input.kitchenPendingCount >= KITCHEN_BACKLOG_ALERT_THRESHOLD) {
      alerts.push({
        level: "ORANGE",
        icon: "🟠",
        message:
          `Se están acumulando comandas en cocina: ${input.kitchenPendingCount} pendientes. Vale la pena revisarla.`
      });
    }

    if (input.salesGrowthPercent <= -15 && input.todaySalesCount > 0) {
      alerts.push({
        level: "ORANGE",
        icon: "🟠",
        message:
          `Las ventas de hoy van ${Math.abs(input.salesGrowthPercent)}% por debajo de ayer. Vale la pena revisar qué está pasando.`
      });
    }

    if (input.cashToday < 0) {
      alerts.push({
        level: "RED",
        icon: "🔴",
        message:
          "La caja de hoy está en saldo negativo. Revisa los movimientos registrados."
      });
    }

    if (input.salesGrowthPercent >= 15 && input.todaySalesCount > 0) {
      alerts.push({
        level: "GREEN",
        icon: "🟢",
        message:
          `Hoy vas ${input.salesGrowthPercent}% mejor que ayer. Sigue así.`
      });
    }

    if (
      input.dailySalesGoal > 0 &&
      input.todaySales >= input.dailySalesGoal
    ) {
      alerts.push({
        level: "GREEN",
        icon: "🟢",
        message:
          `¡Meta del día alcanzada! Llevas ${Math.round(
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

    const priority: Record<SmartAlert["level"], number> = {
      RED: 0,
      ORANGE: 1,
      GREEN: 2
    };

    return alerts.sort(
      (a, b) => priority[a.level] - priority[b.level]
    );
  }
}
