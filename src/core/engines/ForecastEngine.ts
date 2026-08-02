// src/core/engines/ForecastEngine.ts
import { Product, Sale } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { InventoryEngine } from "./InventoryEngine";
import { PurchaseIntelligenceEngine, PurchaseRecommendation } from "./PurchaseIntelligenceEngine";

const WEEKDAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

/** Cuántas ocurrencias recientes del mismo día de la semana se usan para promediar (ej. últimos 8 lunes). */
const MAX_WEEKDAY_SAMPLES = 8;
/** Si no hay suficientes ocurrencias del mismo día de la semana, se usa el promedio de estos últimos días. */
const FALLBACK_WINDOW_DAYS = 14;
/** Mínimo de muestras del mismo día de semana para confiar en el promedio específico (no el general). */
const MIN_WEEKDAY_SAMPLES = 2;

function dateKey(date: Date): string {
  const d = new Date(date);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

interface DaySales {
  readonly date: Date;
  readonly weekday: number;
  readonly total: number;
  /** Cantidad vendida por producto ESE día (venta directa, no vía receta). */
  readonly quantityByProduct: Map<string, number>;
}

export interface SalesForecast {
  readonly forDate: Date;
  readonly weekday: string;
  readonly expectedTotal: number;
  /** 0-100. Más alto = se calculó con más historial comparable (mismo día de semana). */
  readonly confidence: number;
  readonly basis: string;
  readonly sampleSize: number;
}

export interface ProductDemandForecast {
  readonly productId: string;
  readonly productName: string;
  readonly expectedQuantity: number;
  readonly unit: string | null;
  readonly basis: string;
}

export interface WeekdayAverage {
  readonly weekday: string;
  readonly weekdayIndex: number;
  readonly averageSales: number;
  readonly sampleSize: number;
}

export interface BestSellingDayForecast {
  readonly weekday: string;
  readonly weekdayIndex: number;
  readonly averageSales: number;
  /** Días desde hoy hasta la próxima vez que caiga ese día de la semana (mínimo 1). */
  readonly daysUntilNext: number;
  readonly breakdown: readonly WeekdayAverage[];
}

export interface PurchaseToBringForward {
  readonly recommendation: PurchaseRecommendation;
  readonly reason: string;
}

export interface ForecastSummary {
  readonly tomorrow: SalesForecast | null;
  readonly topDemandProduct: ProductDemandForecast | null;
  readonly firstIngredientToRunOut: PurchaseRecommendation | null;
  readonly bestSellingDay: BestSellingDayForecast | null;
  readonly purchasesToBringForward: readonly PurchaseToBringForward[];
  /** false si todavía no hay ni una venta registrada: no hay con qué pronosticar nada. */
  readonly hasEnoughData: boolean;
}

/**
 * ForecastEngine — PASO 2.8 (Pronóstico Inteligente).
 * ---------------------------------------------------------------------------
 * Responde 5 preguntas con datos reales, nunca inventados:
 *  1. Cuánto venderás mañana        -> promedio de tus últimos mismos días de semana.
 *  2. Qué producto tendrá más demanda -> mismo cálculo, pero por producto.
 *  3. Qué ingrediente se agota primero -> reutiliza PurchaseIntelligenceEngine
 *     (PASO 2.6): nunca duplica el cálculo de velocidad de consumo.
 *  4. Qué día es el mejor para vender -> promedio histórico por día de semana.
 *  5. Qué compras adelantar -> cruza (3) con (4): ingredientes que se agotan
 *     antes de que llegue tu próximo mejor día de venta.
 *
 * Si no hay suficiente historial para alguna pregunta, esa pregunta se
 * devuelve en null/vacío — nunca se rellena con un número inventado.
 */
export class ForecastEngine {
  constructor(
    private readonly saleRepository: IRepository<Sale>,
    private readonly inventoryEngine: InventoryEngine,
    private readonly purchaseIntelligenceEngine: PurchaseIntelligenceEngine
  ) {}

  public async getSummary(): Promise<ForecastSummary> {
    const [sales, products] = await Promise.all([this.saleRepository.findAll(), this.inventoryEngine.listAll()]);
    const productById = new Map(products.map((p) => [p.id, p]));

    const days = this.buildDaySeries(sales);
    const hasEnoughData = days.length > 0;

    const now = new Date();
    const tomorrowDate = startOfDay(addDays(now, 1));

    const tomorrow = this.forecastSalesForDate(days, tomorrowDate);
    const topDemandProduct = this.forecastTopProduct(days, tomorrowDate, productById);
    const bestSellingDay = this.forecastBestSellingDay(days, now);

    const recommendations = await this.purchaseIntelligenceEngine.getRecommendations();
    const firstIngredientToRunOut = this.findFirstToRunOut(recommendations);
    const purchasesToBringForward = this.findPurchasesToBringForward(recommendations, bestSellingDay);

    return {
      tomorrow,
      topDemandProduct,
      firstIngredientToRunOut,
      bestSellingDay,
      purchasesToBringForward,
      hasEnoughData
    };
  }

  /** Agrupa cada venta por día calendario real (no por franja de horas). */
  private buildDaySeries(sales: Sale[]): DaySales[] {
    const byDate = new Map<string, { date: Date; total: number; quantityByProduct: Map<string, number> }>();

    for (const sale of sales) {
      const day = startOfDay(new Date(sale.createdAt));
      const key = dateKey(day);
      const entry = byDate.get(key) ?? { date: day, total: 0, quantityByProduct: new Map<string, number>() };

      entry.total += sale.total;
      for (const item of sale.items) {
        entry.quantityByProduct.set(item.productId, (entry.quantityByProduct.get(item.productId) ?? 0) + item.quantity);
      }

      byDate.set(key, entry);
    }

    return Array.from(byDate.values())
      .map((entry) => ({ ...entry, weekday: entry.date.getDay() }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  }

  /** Últimas N ocurrencias (más recientes primero en el corte) del mismo día de semana que `forDate`. */
  private sameWeekdaySamples(days: DaySales[], forDate: Date, limit: number = MAX_WEEKDAY_SAMPLES): DaySales[] {
    const weekday = forDate.getDay();
    return days
      .filter((d) => d.weekday === weekday)
      .slice(-limit);
  }

  private forecastSalesForDate(days: DaySales[], forDate: Date): SalesForecast | null {
    if (days.length === 0) return null;

    const weekdayName = WEEKDAY_NAMES[forDate.getDay()];
    const weekdaySamples = this.sameWeekdaySamples(days, forDate);

    if (weekdaySamples.length >= MIN_WEEKDAY_SAMPLES) {
      const average = weekdaySamples.reduce((sum, d) => sum + d.total, 0) / weekdaySamples.length;
      const confidence = Math.min(90, 40 + weekdaySamples.length * 7);
      return {
        forDate,
        weekday: weekdayName,
        expectedTotal: Math.round(average),
        confidence,
        basis: `Promedio de tus últimos ${weekdaySamples.length} ${weekdayName}(s).`,
        sampleSize: weekdaySamples.length
      };
    }

    // Sin suficientes ocurrencias del mismo día: se usa el promedio general
    // reciente, con menos confianza — nunca se oculta que el dato es menos preciso.
    const recentDays = days.slice(-FALLBACK_WINDOW_DAYS);
    const average = recentDays.reduce((sum, d) => sum + d.total, 0) / recentDays.length;
    return {
      forDate,
      weekday: weekdayName,
      expectedTotal: Math.round(average),
      confidence: Math.min(50, 20 + recentDays.length * 3),
      basis: `Todavía no hay suficientes ${weekdayName}s en tu historial — se usó el promedio de tus últimos ${recentDays.length} día(s).`,
      sampleSize: recentDays.length
    };
  }

  private forecastTopProduct(
    days: DaySales[],
    forDate: Date,
    productById: Map<string, Product>
  ): ProductDemandForecast | null {
    if (days.length === 0) return null;

    let samples = this.sameWeekdaySamples(days, forDate);
    let usedWeekdayOnly = true;
    if (samples.length < MIN_WEEKDAY_SAMPLES) {
      samples = days.slice(-FALLBACK_WINDOW_DAYS);
      usedWeekdayOnly = false;
    }
    if (samples.length === 0) return null;

    const totals = new Map<string, number>();
    for (const day of samples) {
      for (const [productId, quantity] of day.quantityByProduct.entries()) {
        totals.set(productId, (totals.get(productId) ?? 0) + quantity);
      }
    }
    if (totals.size === 0) return null;

    let topProductId: string | null = null;
    let topQuantity = 0;
    for (const [productId, quantity] of totals.entries()) {
      if (quantity > topQuantity) {
        topProductId = productId;
        topQuantity = quantity;
      }
    }
    if (!topProductId) return null;

    const product = productById.get(topProductId);
    const expectedQuantity = Math.round((topQuantity / samples.length) * 10) / 10;
    const weekdayName = WEEKDAY_NAMES[forDate.getDay()];

    return {
      productId: topProductId,
      productName: product?.name ?? "Producto",
      expectedQuantity,
      unit: product?.unit ?? null,
      basis: usedWeekdayOnly
        ? `Es el que más se vendió, en promedio, tus últimos ${samples.length} ${weekdayName}(s).`
        : `Es el que más se vendió, en promedio, en tus últimos ${samples.length} día(s) (sin suficientes ${weekdayName}s todavía).`
    };
  }

  private forecastBestSellingDay(days: DaySales[], now: Date): BestSellingDayForecast | null {
    if (days.length === 0) return null;

    const sums = new Array(7).fill(0);
    const counts = new Array(7).fill(0);
    for (const day of days) {
      sums[day.weekday] += day.total;
      counts[day.weekday] += 1;
    }

    const breakdown: WeekdayAverage[] = WEEKDAY_NAMES.map((name, index) => ({
      weekday: name,
      weekdayIndex: index,
      averageSales: counts[index] > 0 ? Math.round(sums[index] / counts[index]) : 0,
      sampleSize: counts[index]
    }));

    const withData = breakdown.filter((b) => b.sampleSize > 0);
    if (withData.length === 0) return null;

    const best = withData.reduce((max, current) => (current.averageSales > max.averageSales ? current : max));

    const todayWeekday = now.getDay();
    let daysUntilNext = (best.weekdayIndex - todayWeekday + 7) % 7;
    if (daysUntilNext === 0) daysUntilNext = 7;

    return {
      weekday: best.weekday,
      weekdayIndex: best.weekdayIndex,
      averageSales: best.averageSales,
      daysUntilNext,
      breakdown
    };
  }

  /** El insumo con MENOS días para agotarse, sin importar la urgencia que le haya asignado el análisis. */
  private findFirstToRunOut(recommendations: readonly PurchaseRecommendation[]): PurchaseRecommendation | null {
    const withDays = recommendations.filter((r) => r.daysUntilStockout !== null);
    if (withDays.length === 0) return null;

    return withDays.reduce((soonest, current) =>
      (current.daysUntilStockout as number) < (soonest.daysUntilStockout as number) ? current : soonest
    );
  }

  /**
   * Cruza el análisis de compras (PASO 2.6) con el pronóstico: cualquier
   * insumo en urgencia ALTA hay que comprarlo YA, y cualquier insumo que se
   * agote antes de que llegue el próximo mejor día de venta hay que
   * adelantarlo para no perder esa venta.
   */
  private findPurchasesToBringForward(
    recommendations: readonly PurchaseRecommendation[],
    bestSellingDay: BestSellingDayForecast | null
  ): PurchaseToBringForward[] {
    const result: PurchaseToBringForward[] = [];

    for (const rec of recommendations) {
      if (rec.urgency === "ALTA") {
        result.push({ recommendation: rec, reason: "Está en riesgo de agotarse hoy mismo." });
        continue;
      }

      if (bestSellingDay && rec.daysUntilStockout !== null && rec.daysUntilStockout <= bestSellingDay.daysUntilNext) {
        result.push({
          recommendation: rec,
          reason: `Se agotaría antes de tu próximo ${bestSellingDay.weekday} (en ${bestSellingDay.daysUntilNext} día(s)), tu mejor día de venta.`
        });
      }
    }

    return result.sort(
      (a, b) => (a.recommendation.daysUntilStockout ?? 999) - (b.recommendation.daysUntilStockout ?? 999)
    );
  }
}