/**
 * AiBusinessContext — Contexto operativo y financiero para VIMDY IA.
 * ---------------------------------------------------------------------------
 * Consolida, en una lectura de solo consulta, las fuentes de verdad que ya
 * existen en VIMDY:
 *   - SalesEngine: ventas confirmadas y sus fechas de pago.
 *   - KardexEngine: movimientos reales de inventario y pérdidas.
 *   - RecipeEngine: costos/rentabilidad calculados desde recetas.
 *   - buildFinancialReport: ventas netas, COGS, utilidad bruta, pérdidas,
 *     mermas y lotes por vencer.
 *   - KitchenEngine: comandas activas y retrasadas.
 *   - ShiftEngine: efectivo esperado de la caja/turno actualmente seleccionado.
 *
 * Este módulo no escribe datos, no abre/cierra turnos y no modifica ventas,
 * inventario ni comandas. La única cifra de efectivo usada es la de
 * ShiftEngine.getShiftSummary(), que a su vez respeta el cálculo del servidor.
 *
 * Seguridad de inventario: cuando el servidor entrega stock enmascarado por
 * un conteo a ciegas, el contexto devuelve solamente el estado LOW/OUT y nunca
 * la cantidad ficticia de `product.stock`.
 */

import type {
  InventoryMovement,
  KitchenOrder,
  Product,
  Sale
} from "../entities/Entities";

import type { Profitability } from "../engines/RecipeEngine";
import type { LossUnitCost } from "../domain/loss/lossCenterAdapter";

import type {
  FinancialReport,
  FinancialWarning
} from "../domain/finance/financialReport";

import type {
  ProfitCatalogItem,
  ProfitSaleLine
} from "../domain/profit/profitEngine";

import { buildFinancialReport } from "../domain/finance/financialReport";

import {
  container,
  productsReady
} from "../../infrastructure/di/CompositionRoot";

import { companyConfigStore } from "../store/companyConfigStore";

import {
  getBusinessDateKey,
  startOfBusinessDay,
  startOfBusinessWeek,
  startOfNextBusinessDay
} from "../utils/businessTime";

import { normalizeReportTimezone } from "../utils/reportRanges";

import {
  getSaleNetItems,
  isRevenueSaleStatus
} from "../utils/saleRefunds";

import {
  isStockMasked,
  maskedStockStatus
} from "../utils/stockMask";

/** El mismo umbral de retraso que utiliza BusinessAnalyzer. */
export const AI_KITCHEN_DELAY_THRESHOLD_MINUTES = 20;

export type AiBusinessContextSourceStatus = "OK" | "UNAVAILABLE";

/* ========================================================================== */
/* TIPOS                                                                      */
/* ========================================================================== */

export interface AiBusinessFinancialPeriod {
  readonly from: string;
  readonly toExclusive: string;

  /** Ventas pagadas netas de descuentos y devoluciones. */
  readonly netSales: number;

  /** Costo de los productos efectivamente vendidos. */
  readonly cogs: number;

  /** netSales - cogs. */
  readonly grossProfit: number;

  readonly grossMarginPercent: number;

  /** Pérdidas de inventario registradas en el Kardex para el periodo. */
  readonly totalLosses: number;

  readonly lossesByCategory: FinancialReport["lossByCategory"];

  readonly mermaPreparation: number;
  readonly waste: number;
  readonly expiryLoss: number;
  readonly courtesy: number;
  readonly shortage: number;

  /** grossProfit - totalLosses; no incluye gastos operativos. */
  readonly profitAfterInventoryLosses: number;

  readonly unitsSold: number;

  readonly saleLinesWithIncompleteCost: readonly string[];
  readonly unknownProductIds: readonly string[];

  readonly dataQualityComplete: boolean;
  readonly warnings: readonly FinancialWarning[];
}

export interface AiLowStockProduct {
  readonly productId: string;
  readonly name: string;
  readonly unit: string | null;
  readonly minStock: number;

  readonly status: "LOW" | "OUT";

  /** null cuando el servidor enmascaró el stock por un conteo a ciegas. */
  readonly stock: number | null;

  readonly quantityHidden: boolean;
}

export interface AiExpiryRiskItem {
  readonly productId: string;
  readonly name: string;
  readonly unit: string | null;

  readonly stockAtRisk: number;

  /** 0 = vence hoy; negativo = lote vencido que aún conserva existencias. */
  readonly daysLeft: number;

  readonly valueAtRisk: number;
}

export interface AiCashContext {
  readonly status:
    | "AVAILABLE"
    | "NO_OPEN_SHIFT"
    | "SELECTION_REQUIRED"
    | "UNAVAILABLE";

  /** Efectivo físico esperado en el cajón; null si no puede determinarse. */
  readonly expectedAmount: number | null;

  readonly source: "server" | "local" | null;

  readonly shiftOpenedAt: string | null;
  readonly cashRegisterId: string | null;

  readonly message?: string;
}

export interface AiDelayedKitchenOrder {
  readonly orderNumber: number | null;
  readonly origin: string;

  readonly status: "PENDIENTE" | "EN_PREPARACION";

  readonly priority: "NORMAL" | "HIGH" | "URGENT";

  readonly minutesWaiting: number;
  readonly createdAt: string | null;
}

export interface AiKitchenContext {
  readonly available: boolean;

  readonly activeOrders: number;
  readonly pendingOrders: number;
  readonly inPreparationOrders: number;
  readonly readyOrders: number;

  readonly delayedOrdersCount: number;
  readonly delayThresholdMinutes: number;

  /** Se devuelven primero las comandas que llevan más tiempo esperando. */
  readonly delayedOrders: readonly AiDelayedKitchenOrder[];

  readonly delayedOrdersTruncated: boolean;
}

export interface AiBusinessContext {
  readonly generatedAt: string;
  readonly timezone: string;
  readonly currency: string;
  readonly businessDate: string;

  readonly financial: {
    readonly today: AiBusinessFinancialPeriod | null;
    readonly week: AiBusinessFinancialPeriod | null;

    readonly expiryRisk: readonly AiExpiryRiskItem[];
    readonly expiryRiskValue: number | null;
  };

  readonly cash: AiCashContext;

  readonly inventory: {
    readonly available: boolean;

    readonly lowStockProducts: readonly AiLowStockProduct[];

    readonly lowStockCount: number | null;
    readonly maskedStockProductsCount: number | null;
  };

  readonly kitchen: AiKitchenContext;

  readonly dataQuality: {
    readonly complete: boolean;

    readonly sources: Readonly<
      Record<string, AiBusinessContextSourceStatus>
    >;

    readonly errors: Readonly<Record<string, string>>;

    readonly financialWarnings: readonly FinancialWarning[];
  };
}

export interface BuildAiBusinessContextOptions {
  /** Reloj inyectable para pruebas; por defecto, fecha/hora actual. */
  readonly now?: Date;

  /** Días de anticipación para los lotes que están por vencer. */
  readonly expiryWarningDays?: number;

  /** Umbral de retraso de cocina en minutos. */
  readonly kitchenDelayMinutes?: number;

  /** Máximo de comandas retrasadas incluidas en el prompt. */
  readonly maxDelayedOrders?: number;
}

interface SourceResult<T> {
  readonly value: T | null;
  readonly error: string | null;
}

/* ========================================================================== */
/* UTILIDADES                                                                 */
/* ========================================================================== */

function readSource<T>(
  loader: () => Promise<T>
): Promise<SourceResult<T>> {
  return loader().then(
    (value) => ({
      value,
      error: null
    }),
    (error: unknown) => ({
      value: null,
      error: getErrorMessage(error)
    })
  );
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message;
  }

  if (typeof error === "string" && error.trim()) {
    return error;
  }

  return "Error de lectura sin detalle.";
}

function toValidDate(value: unknown): Date | null {
  const date = value instanceof Date
    ? value
    : typeof value === "string" || typeof value === "number"
      ? new Date(value)
      : null;

  return date && Number.isFinite(date.getTime())
    ? date
    : null;
}

function toIsoOrNull(value: unknown): string | null {
  return toValidDate(value)?.toISOString() ?? null;
}

/**
 * Revenue se asigna al instante del pago; históricos sin paidAt usan createdAt.
 */
function getRevenueDate(sale: Sale): Date {
  return (
    toValidDate(sale.paidAt) ??
    toValidDate(sale.createdAt) ??
    new Date(0)
  );
}

function isInsidePeriod(
  date: Date,
  from: Date,
  toExclusive: Date
): boolean {
  const timestamp = date.getTime();

  return (
    timestamp >= from.getTime() &&
    timestamp < toExclusive.getTime()
  );
}

/* ========================================================================== */
/* ADAPTADORES FINANCIEROS                                                    */
/* ========================================================================== */

/**
 * Mismo adaptador utilizado por el Centro de Ganancias y por Reportes.
 *
 * Costo del insumo:
 *   1. averageCost, cuando existe y es positivo.
 *   2. purchasePrice, como alternativa.
 *
 * Recetas:
 *   Se convierten al formato esperado por profitEngine.
 */
function buildProfitCatalog(
  products: readonly Product[]
): ProfitCatalogItem[] {
  return products.map((product) => {
    const average = product.averageCost;

    const cost =
      typeof average === "number" && average > 0
        ? average
        : product.purchasePrice;

    return {
      id: product.id,
      name: product.name,

      unitCost:
        typeof cost === "number" &&
        Number.isFinite(cost) &&
        cost > 0
          ? cost
          : null,

      recipe: (product.recipe ?? []).map((line) => ({
        ingredientId: line.productId,
        quantity: line.quantity
      }))
    };
  });
}

/**
 * Convierte las ventas al contrato plano de profitEngine.
 *
 * Las líneas se descuentan por devoluciones parciales y el descuento global
 * se distribuye proporcionalmente entre las líneas restantes, igual que
 * en useReports.
 */
function buildProfitSaleLines(
  sales: readonly Sale[]
): ProfitSaleLine[] {
  return sales
    .filter((sale) => isRevenueSaleStatus(sale.status))
    .flatMap((sale) => {
      const netItems = getSaleNetItems(sale);

      const gross = netItems.reduce(
        (sum, item) => sum + item.price * item.quantity,
        0
      );

      const rawDiscount = Number(sale.discount);

      const saleDiscount =
        Number.isFinite(rawDiscount) && rawDiscount > 0
          ? Math.min(rawDiscount, gross)
          : 0;

      return netItems.map((item): ProfitSaleLine => {
        const lineGross = item.price * item.quantity;

        return {
          productId: item.productId,
          quantity: item.quantity,
          unitPrice: item.price,

          discount:
            gross > 0
              ? (saleDiscount * lineGross) / gross
              : 0
        };
      });
    });
}

/**
 * Convierte los resultados de RecipeEngine al formato de costos que utiliza
 * lossCenterAdapter y buildFinancialReport.
 */
function toLossUnitCosts(
  profitability: ReadonlyMap<string, Profitability>
): ReadonlyMap<string, LossUnitCost> {
  const result = new Map<string, LossUnitCost>();

  for (const [productId, value] of profitability) {
    result.set(productId, {
      cost: value.cost,
      costUnreliable: value.costUnreliable
    });
  }

  return result;
}

/**
 * Traduce el reporte de dominio a una estructura pequeña para el prompt.
 */
function toFinancialPeriod(
  report: FinancialReport,
  from: Date,
  toExclusive: Date
): AiBusinessFinancialPeriod {
  return {
    from: from.toISOString(),
    toExclusive: toExclusive.toISOString(),

    netSales: report.netSales,
    cogs: report.cogs,
    grossProfit: report.grossProfit,
    grossMarginPercent: report.grossMarginPercent,

    totalLosses: report.lossCost,

    lossesByCategory: report.lossByCategory,

    mermaPreparation:
      report.lossByCategory.MERMA_PREPARACION,

    waste:
      report.lossByCategory.DESPERDICIO,

    expiryLoss:
      report.lossByCategory.VENCIMIENTO,

    courtesy:
      report.lossByCategory.CORTESIA,

    shortage:
      report.lossByCategory.FALTANTE,

    profitAfterInventoryLosses:
      report.realProfit,

    unitsSold: report.profit.unitsSold,

    saleLinesWithIncompleteCost:
      report.dataQuality.productsWithIncompleteCost,

    unknownProductIds:
      report.dataQuality.unknownProductIds,

    dataQualityComplete:
      report.dataQuality.isComplete,

    warnings:
      report.dataQuality.warnings
  };
}

/* ========================================================================== */
/* INVENTARIO                                                                 */
/* ========================================================================== */

/**
 * Identifica productos bajo mínimo.
 *
 * IMPORTANTE:
 * Cuando stockMasked === true, nunca se devuelve product.stock porque ese
 * campo puede contener una banda ficticia del conteo a ciegas.
 *
 * En ese caso únicamente se utiliza el estado calculado por el servidor.
 */
function buildLowStockProducts(
  products: readonly Product[]
): AiLowStockProduct[] {
  const result: AiLowStockProduct[] = [];

  for (const product of products) {
    if (product.active === false) continue;
    if (product.trackStock === false) continue;

    const masked = isStockMasked(product);

    const status = masked
      ? maskedStockStatus(product)
      : product.stock <= product.minStock
        ? product.stock <= 0
          ? "OUT"
          : "LOW"
        : "AVAILABLE";

    if (status !== "LOW" && status !== "OUT") {
      continue;
    }

    result.push({
      productId: product.id,
      name: product.name,
      unit: product.unit ?? null,
      minStock: product.minStock,
      status,

      stock: masked
        ? null
        : product.stock,

      quantityHidden: masked
    });
  }

  return result.sort((a, b) => {
    if (a.status !== b.status) {
      return a.status === "OUT" ? -1 : 1;
    }

    if (a.quantityHidden || b.quantityHidden) {
      return a.name.localeCompare(b.name);
    }

    return (a.stock ?? 0) - (b.stock ?? 0);
  });
}

/**
 * Extrae los lotes por vencer calculados por buildFinancialReport.
 *
 * El cálculo de existencias por lote y FIFO permanece en lossCenterAdapter.
 * No se intenta reconstruir aquí ni duplicar esa lógica.
 */
function buildExpiryRisk(
  report: FinancialReport
): AiExpiryRiskItem[] {
  return report.expiryRisk.map((item) => ({
    productId: item.itemId,
    name: item.itemName,
    unit: item.unit,
    stockAtRisk: item.stock,
    daysLeft: item.daysLeft,
    valueAtRisk: item.valueAtRisk
  }));
}

/* ========================================================================== */
/* COCINA                                                                     */
/* ========================================================================== */

function buildKitchenContext(
  orders: readonly KitchenOrder[],
  now: Date,
  delayThresholdMinutes: number,
  maxDelayedOrders: number
): AiKitchenContext {
  const pending = orders.filter(
    (order) => order.status === "PENDIENTE"
  );

  const inPreparation = orders.filter(
    (order) => order.status === "EN_PREPARACION"
  );

  const ready = orders.filter(
    (order) => order.status === "LISTO"
  );

  const delayed = orders
    .filter(
      (order) =>
        order.status === "PENDIENTE" ||
        order.status === "EN_PREPARACION"
    )
    .map((order) => {
      const createdAt = toValidDate(order.createdAt);

      const elapsed = createdAt
        ? Math.max(
            0,
            (now.getTime() - createdAt.getTime()) / 60000
          )
        : 0;

      return {
        order,
        createdAt,
        minutesWaiting: Math.round(elapsed)
      };
    })
    .filter(
      (entry) =>
        entry.minutesWaiting >= delayThresholdMinutes
    )
    .sort(
      (a, b) =>
        b.minutesWaiting - a.minutesWaiting
    );

  const visibleDelayed = delayed.slice(
    0,
    maxDelayedOrders
  );

  return {
    available: true,

    activeOrders: orders.length,
    pendingOrders: pending.length,
    inPreparationOrders: inPreparation.length,
    readyOrders: ready.length,

    delayedOrdersCount: delayed.length,

    delayThresholdMinutes,

    delayedOrders: visibleDelayed.map(
      ({ order, createdAt, minutesWaiting }) => ({
        orderNumber:
          typeof order.orderNumber === "number"
            ? order.orderNumber
            : null,

        origin: order.origin ?? "Pedido",

        status:
          order.status as "PENDIENTE" | "EN_PREPARACION",

        priority: order.priority ?? "NORMAL",

        minutesWaiting,

        createdAt:
          createdAt?.toISOString() ?? null
      })
    ),

    delayedOrdersTruncated:
      delayed.length > visibleDelayed.length
  };
}

function unavailableKitchenContext(
  delayThresholdMinutes: number
): AiKitchenContext {
  return {
    available: false,

    activeOrders: 0,
    pendingOrders: 0,
    inPreparationOrders: 0,
    readyOrders: 0,

    delayedOrdersCount: 0,
    delayThresholdMinutes,

    delayedOrders: [],
    delayedOrdersTruncated: false
  };
}

/* ========================================================================== */
/* CAJA                                                                       */
/* ========================================================================== */

function buildUnavailableCashContext(
  message: string
): AiCashContext {
  return {
    status: message.includes(
      "CASH_REGISTER_SELECTION_REQUIRED"
    )
      ? "SELECTION_REQUIRED"
      : "UNAVAILABLE",

    expectedAmount: null,

    source: null,

    shiftOpenedAt: null,

    cashRegisterId: null,

    message
  };
}

/**
 * Obtiene el turno abierto de la caja seleccionada y su efectivo esperado.
 *
 * NO calcula manualmente los movimientos.
 *
 * ShiftEngine.getShiftSummary() consulta la cifra del servidor cuando está
 * disponible y aplica la regla única de efectivo como respaldo local.
 */
async function loadCashContext(): Promise<AiCashContext> {
  try {
    const shiftEngine = container.shiftEngine.get();

    const shift = await shiftEngine.getCurrentShift();

    if (!shift) {
      return {
        status: "NO_OPEN_SHIFT",

        expectedAmount: null,

        source: null,

        shiftOpenedAt: null,

        cashRegisterId: null,

        message:
          "No hay un turno de caja abierto en la caja seleccionada."
      };
    }

    const summary = await shiftEngine.getShiftSummary(
      shift.id
    );

    return {
      status: "AVAILABLE",

      expectedAmount: summary.expectedAmount,

      source: summary.source,

      shiftOpenedAt:
        toIsoOrNull(summary.shift.openedAt),

      cashRegisterId:
        summary.shift.cashRegisterId ?? null
    };
  } catch (error) {
    return buildUnavailableCashContext(
      getErrorMessage(error)
    );
  }
}

/* ========================================================================== */
/* AGREGADOR PRINCIPAL                                                        */
/* ========================================================================== */

/**
 * Construye el contexto estructurado que se adjunta al prompt de VIMDY IA.
 *
 * Si falla una fuente, las demás se conservan y el fallo queda explícito en
 * `dataQuality.errors`; no se reemplazan errores de lectura por importes 0.
 *
 * Ejemplo:
 *
 * const context = await buildAiBusinessContext();
 * const promptContext = serializeAiBusinessContext(context);
 */
export async function buildAiBusinessContext(
  options: BuildAiBusinessContextOptions = {}
): Promise<AiBusinessContext> {
  const now = options.now
    ? new Date(options.now)
    : new Date();

  if (!Number.isFinite(now.getTime())) {
    throw new RangeError(
      "AiBusinessContext: `options.now` no es una fecha válida."
    );
  }

  const expiryWarningDays = Math.max(
    0,
    options.expiryWarningDays ?? 3
  );

  const kitchenDelayMinutes = Math.max(
    0,
    options.kitchenDelayMinutes ??
      AI_KITCHEN_DELAY_THRESHOLD_MINUTES
  );

  const maxDelayedOrders = Math.max(
    0,
    Math.floor(options.maxDelayedOrders ?? 20)
  );

  const companyConfig = companyConfigStore.get();

  const timezone = normalizeReportTimezone(
    companyConfig.timezone
  );

  const currency = companyConfig.currency;

  const businessDate = getBusinessDateKey(
    now,
    timezone
  );

  const dayStart = startOfBusinessDay(
    now,
    timezone
  );

  const weekStart = startOfBusinessWeek(
    now,
    timezone
  );

  const nextDayStart = startOfNextBusinessDay(
    now,
    timezone
  );

  const errors: Record<string, string> = {};

  const sources: Record<
    string,
    AiBusinessContextSourceStatus
  > = {};

  /* ---------------------------------------------------------------------- */
  /* Preparación del catálogo                                               */
  /* ---------------------------------------------------------------------- */

  try {
    await productsReady;
    sources.productsReady = "OK";
  } catch (error) {
    errors.productsReady = getErrorMessage(error);
    sources.productsReady = "UNAVAILABLE";
  }

  /* ---------------------------------------------------------------------- */
  /* Lecturas paralelas de los motores                                      */
  /* ---------------------------------------------------------------------- */

  const [
    salesResult,
    productsResult,
    movementsResult,
    profitabilityResult,
    kitchenResult
  ] = await Promise.all([
    readSource(
      () =>
        container.salesEngine.get().getAllSales()
    ),

    readSource(
      () =>
        container.inventoryEngine.get().listAllAuthoritative()
    ),

    readSource(
      () =>
        container.kardexEngine.get().getAllMovements()
    ),

    readSource(
      () =>
        container.recipeEngine.get().getAllProfitability()
    ),

    readSource(
      () =>
        container.kitchenEngine.get().getActiveOrders()
    )
  ]);

  /* ---------------------------------------------------------------------- */
  /* Estado de disponibilidad de las fuentes                               */
  /* ---------------------------------------------------------------------- */

  const sourceResults: Record<
    string,
    SourceResult<unknown>
  > = {
    salesEngine: salesResult,
    inventoryCatalog: productsResult,
    kardexEngine: movementsResult,
    recipeEngine: profitabilityResult,
    kitchenEngine: kitchenResult
  };

  for (const [name, result] of Object.entries(sourceResults)) {
    sources[name] = result.error
      ? "UNAVAILABLE"
      : "OK";

    if (result.error) {
      errors[name] = result.error;
    }
  }

  const sales = salesResult.value as Sale[] | null;

  const products = productsResult.value as Product[] | null;

  const movements =
    movementsResult.value as InventoryMovement[] | null;

  const profitability =
    profitabilityResult.value as
      Map<string, Profitability> | null;

  const kitchenOrders =
    kitchenResult.value as KitchenOrder[] | null;

  /* ---------------------------------------------------------------------- */
  /* Inicialización del reporte financiero                                  */
  /* ---------------------------------------------------------------------- */

  let todayFinancial: AiBusinessFinancialPeriod | null = null;

  let weekFinancial: AiBusinessFinancialPeriod | null = null;

  let expiryRisk: AiExpiryRiskItem[] = [];

  let expiryRiskValue: number | null = null;

  let financialWarnings: FinancialWarning[] = [];

  sources.buildFinancialReport = "UNAVAILABLE";

  /* ---------------------------------------------------------------------- */
  /* Construcción de reportes diarios y semanales                           */
  /* ---------------------------------------------------------------------- */

  const financeInputsAvailable =
    sales !== null &&
    products !== null &&
    movements !== null &&
    profitability !== null;

  if (financeInputsAvailable) {
    try {
      /*
       * RecipeEngine entrega los costos calculados y su indicador de
       * confiabilidad. lossCenterAdapter nunca monetiza costos desconocidos.
       */
      const lossUnitCosts = toLossUnitCosts(
        profitability
      );

      const catalog = buildProfitCatalog(
        products
      );

      const reportBase = {
        catalog,
        movements,
        products,
        unitCosts: lossUnitCosts,
        now,
        businessToday: businessDate,
        expiryWarningDays
      };

      /*
       * Las ventas se asignan a su fecha de pago.
       * Los registros históricos sin paidAt utilizan createdAt.
       */

      const todaySales = sales.filter(
        (sale) =>
          isRevenueSaleStatus(sale.status) &&
          isInsidePeriod(
            getRevenueDate(sale),
            dayStart,
            nextDayStart
          )
      );

      const weekSales = sales.filter(
        (sale) =>
          isRevenueSaleStatus(sale.status) &&
          isInsidePeriod(
            getRevenueDate(sale),
            weekStart,
            nextDayStart
          )
      );

      /*
       * Reporte de HOY:
       * - ventas desde el inicio del día comercial;
       * - pérdidas del Kardex del mismo intervalo.
       */
      const todayReport = buildFinancialReport({
        ...reportBase,

        sales: buildProfitSaleLines(
          todaySales
        ),

        period: {
          from: dayStart.getTime(),
          to: nextDayStart.getTime()
        }
      });

      /*
       * Reporte SEMANAL:
       * - desde el inicio de la semana comercial;
       * - hasta el siguiente día comercial.
       */
      const weekReport = buildFinancialReport({
        ...reportBase,

        sales: buildProfitSaleLines(
          weekSales
        ),

        period: {
          from: weekStart.getTime(),
          to: nextDayStart.getTime()
        }
      });

      todayFinancial = toFinancialPeriod(
        todayReport,
        dayStart,
        nextDayStart
      );

      weekFinancial = toFinancialPeriod(
        weekReport,
        weekStart,
        nextDayStart
      );

      /*
       * El riesgo de vencimiento representa las existencias actuales,
       * no una pérdida histórica. Se toma del reporte semanal como
       * información complementaria.
       */
      expiryRisk = buildExpiryRisk(
        weekReport
      );

      expiryRiskValue =
        weekReport.expiryRiskValue;

      /*
       * Consolidar advertencias sin repetir mensajes idénticos.
       */
      financialWarnings = [
        ...todayReport.dataQuality.warnings,
        ...weekReport.dataQuality.warnings
      ].filter(
        (warning, index, all) =>
          all.findIndex(
            (candidate) =>
              candidate.code === warning.code &&
              candidate.message === warning.message
          ) === index
      );

      sources.buildFinancialReport = "OK";

    } catch (error) {
      errors.buildFinancialReport =
        getErrorMessage(error);
    }

  } else {
    errors.buildFinancialReport =
      "No se pudo calcular el reporte: falta al menos una fuente de ventas, catálogo, Kardex o costos de receta.";
  }

  /* ---------------------------------------------------------------------- */
  /* Stock mínimo y productos agotados                                      */
  /* ---------------------------------------------------------------------- */

  const lowStockProducts = products
    ? buildLowStockProducts(products)
    : [];

  const inventoryAvailable = products !== null;

  const maskedStockProductsCount = products
    ? products.filter(
        (product) => isStockMasked(product)
      ).length
    : null;

  /* ---------------------------------------------------------------------- */
  /* Efectivo esperado en caja                                               */
  /* ---------------------------------------------------------------------- */

  const cash = await loadCashContext();

  if (
    cash.status === "UNAVAILABLE" ||
    cash.status === "SELECTION_REQUIRED"
  ) {
    errors.shiftEngine =
      cash.message ?? "No se pudo leer el turno de caja.";

    sources.shiftEngine = "UNAVAILABLE";
  } else {
    sources.shiftEngine = "OK";
  }

  /* ---------------------------------------------------------------------- */
  /* Cocina                                                                  */
  /* ---------------------------------------------------------------------- */

  const kitchen = kitchenOrders
    ? buildKitchenContext(
        kitchenOrders,
        now,
        kitchenDelayMinutes,
        maxDelayedOrders
      )
    : unavailableKitchenContext(
        kitchenDelayMinutes
      );

  /* ---------------------------------------------------------------------- */
  /* Integridad general de los datos                                        */
  /* ---------------------------------------------------------------------- */

  const requiredSourcesAvailable =
    sales !== null &&
    products !== null &&
    movements !== null &&
    profitability !== null &&
    kitchenOrders !== null;

  const complete =
    requiredSourcesAvailable &&
    todayFinancial !== null &&
    weekFinancial !== null &&
    sources.productsReady !== "UNAVAILABLE" &&
    sources.buildFinancialReport === "OK" &&
    cash.status !== "UNAVAILABLE" &&
    cash.status !== "SELECTION_REQUIRED";

  /* ---------------------------------------------------------------------- */
  /* Resultado final                                                         */
  /* ---------------------------------------------------------------------- */

  return {
    generatedAt: now.toISOString(),

    timezone,

    currency,

    businessDate,

    financial: {
      today: todayFinancial,
      week: weekFinancial,

      expiryRisk,

      expiryRiskValue
    },

    cash,

    inventory: {
      available: inventoryAvailable,

      lowStockProducts,

      lowStockCount: inventoryAvailable
        ? lowStockProducts.length
        : null,

      maskedStockProductsCount
    },

    kitchen,

    dataQuality: {
      complete,

      sources,

      errors,

      financialWarnings
    }
  };
}

/* ========================================================================== */
/* SERIALIZACIÓN PARA EL PROMPT                                               */
/* ========================================================================== */

/**
 * Serializa el contexto sin perder su estructura.
 *
 * Uso:
 *
 * const context = await buildAiBusinessContext();
 * const contextForPrompt = serializeAiBusinessContext(context);
 */
export function serializeAiBusinessContext(
  context: AiBusinessContext
): string {
  return JSON.stringify(context);
}