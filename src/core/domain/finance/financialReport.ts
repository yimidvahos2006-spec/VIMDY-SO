/**
 * financialReport — Reporte financiero consolidado (módulo de dominio PURO).
 * ---------------------------------------------------------------------------
 * Une en UN solo resultado lo que hoy viven por separado:
 *   - Centro de Ganancias (`profitEngine`): ventas netas, COGS, utilidad bruta.
 *   - Centro de Pérdidas (`lossEngine` + `lossCenterAdapter`): dinero perdido
 *     por vencimiento, desperdicio, merma de preparación, cortesía y faltante,
 *     tomado del Kardex.
 *
 *   ventas netas   = Σ (unidades − devueltas) × precio − descuentos
 *   COGS           = Σ unidades netas × costo de receta
 *   utilidad bruta = ventas netas − COGS
 *   pérdidas       = costo de las salidas de stock SIN venta (Kardex)
 *   utilidad real  = utilidad bruta − pérdidas
 *
 * Por qué restar las pérdidas NO duplica costos: el COGS cubre solo lo que se
 * vendió (consumo por venta); las pérdidas son salidas con `lossCategory`, que
 * las ventas nunca traen. Son inventario que salió sin generar ingreso.
 *
 * Reglas (las mismas de los motores que reutiliza):
 *   - Sin React, stores, reloj ni azar: todo entra por parámetros y nunca se
 *     mutan los argumentos. Mismo input => mismo output.
 *   - Porcentajes en escala 0–100. Nunca NaN/Infinity: margen sobre ventas 0 = 0.
 *   - Un costo desconocido NO se inventa. Se informa en `dataQuality` para que
 *     la pantalla avise que la utilidad real es un estimado (sobreestimado).
 *   - Los montos no se redondean aquí; redondea al presentar (`roundMoney`).
 *
 * Alcance: las líneas de venta (`sales`) deben venir YA filtradas al periodo
 * (el motor de ganancias no tiene fechas); `period` filtra solo las pérdidas.
 * No incluye gastos operativos (nómina, arriendo…): la utilidad real aquí es
 * utilidad bruta menos pérdidas de inventario, no utilidad neta contable.
 */
import type { InventoryMovement, Product } from "../../entities/Entities";
import {
  buildExpiringLots,
  isoDayToUtcMs,
  movementsToLossRecords,
  productsToLossInventory,
  type LossUnitCost
} from "../loss/lossCenterAdapter";
import {
  LOSS_CATEGORIES,
  findExpiryRisk,
  summarizeLosses,
  type ExpiryRiskItem,
  type LossCategory,
  type LossCategoryTotal,
  type LossPeriod,
  type LossSummary,
  type LossTimestamp
} from "../loss/lossEngine";
import {
  computeProfitSummary,
  type ProfitCatalogItem,
  type ProfitSaleLine,
  type ProfitSummary
} from "../profit/profitEngine";

/* ========================================================================== */
/* Entrada                                                                    */
/* ========================================================================== */

export interface FinancialReportInput {
  /** Catálogo con recetas y costos de insumos (base del COGS). */
  readonly catalog: readonly ProfitCatalogItem[];
  /** Líneas de venta del periodo, ya filtradas (pagadas/cerradas). */
  readonly sales: readonly ProfitSaleLine[];

  /** TODOS los movimientos del Kardex; el adaptador separa las pérdidas. */
  readonly movements: readonly InventoryMovement[];
  readonly products: readonly Product[];
  /** Costo unitario por producto según RecipeEngine (`costUnreliable` => no suma dinero). */
  readonly unitCosts: ReadonlyMap<string, LossUnitCost>;

  /** Periodo [from, to) de las pérdidas. Sin periodo = todo el histórico. */
  readonly period?: LossPeriod | undefined;
  /** "Ahora" (obligatorio: el motor de pérdidas no lee el reloj). */
  readonly now: LossTimestamp;

  /**
   * "Hoy" del NEGOCIO como día de calendario "YYYY-MM-DD" (zona horaria del
   * negocio, p. ej. America/Bogota). Solo se usa para los lotes por vencer;
   * sin él, `expiryRisk` queda vacío.
   */
  readonly businessToday?: string | undefined;
  /** Días de anticipación para "por vencer". Por defecto, el del motor (3). */
  readonly expiryWarningDays?: number | undefined;
}

/* ========================================================================== */
/* Salida                                                                     */
/* ========================================================================== */

export type FinancialWarningCode =
  | "COSTO_VENTAS_INCOMPLETO"
  | "PRODUCTO_VENDIDO_NO_CATALOGADO"
  | "COSTO_PERDIDA_DESCONOCIDO"
  | "PERDIDAS_INVALIDAS"
  | "MOTIVO_PERDIDA_NO_RECONOCIDO"
  | "FECHA_HOY_INVALIDA";

export interface FinancialWarning {
  readonly code: FinancialWarningCode;
  readonly message: string;
  /** Cuántos productos/registros disparan el aviso. */
  readonly count: number;
  /** true si el aviso hace que algún total (COGS, pérdidas, utilidad) pueda estar mal. */
  readonly affectsTotals: boolean;
}

export interface FinancialDataQuality {
  /** false si algún total puede estar subestimado/sobreestimado: tratar la utilidad real como estimado. */
  readonly isComplete: boolean;
  /** Productos vendidos con costo de receta incompleto (COGS subestimado). */
  readonly productsWithIncompleteCost: readonly string[];
  /** Productos vendidos que no existen en el catálogo (ingreso sin costo). */
  readonly unknownProductIds: readonly string[];
  /** Pérdidas con cantidad válida pero sin costo conocido (cuentan unidades, $0). */
  readonly unknownCostLossRecords: number;
  /** Pérdidas descartadas por cantidad o fecha inválida. */
  readonly invalidLossRecords: number;
  /** Salidas con motivo no reconocido, contadas como Faltante. */
  readonly unmappedLossCount: number;
  readonly warnings: readonly FinancialWarning[];
}

export interface FinancialReport {
  /** Ventas netas: después de devoluciones y descuentos. */
  readonly netSales: number;
  readonly cogs: number;
  readonly grossProfit: number;
  /** Utilidad bruta / ventas netas (0–100). */
  readonly grossMarginPercent: number;

  /** Costo total de pérdidas del periodo (todas las categorías). */
  readonly lossCost: number;
  /** Costo por categoría; siempre las 5, aunque estén en 0. */
  readonly lossByCategory: Readonly<Record<LossCategory, number>>;
  /** Pérdidas / ventas netas × 100; null si no hay ventas con qué comparar. */
  readonly lossPercentOfSales: number | null;

  /** Utilidad bruta − pérdidas. Puede ser negativa. */
  readonly realProfit: number;
  /** Utilidad real / ventas netas (0–100). */
  readonly realMarginPercent: number;

  /**
   * Pérdida POTENCIAL: stock que vence pronto. Es informativo y NO se resta de
   * la utilidad real (todavía no se perdió).
   */
  readonly expiryRisk: readonly ExpiryRiskItem[];
  readonly expiryRiskValue: number;

  readonly dataQuality: FinancialDataQuality;

  /** Detalle completo de cada motor, para pantallas que necesiten más. */
  readonly profit: ProfitSummary;
  readonly losses: LossSummary;
}

/* ========================================================================== */
/* Utilidades internas                                                        */
/* ========================================================================== */

function percentOf(part: number, whole: number): number {
  return whole > 0 && Number.isFinite(part) ? (part / whole) * 100 : 0;
}

function lossCostByCategory(byCategory: readonly LossCategoryTotal[]): Record<LossCategory, number> {
  const result = {} as Record<LossCategory, number>;
  for (const category of LOSS_CATEGORIES) result[category] = 0;
  for (const entry of byCategory) result[entry.category] = entry.cost;
  return result;
}

function buildWarnings(input: {
  readonly profit: ProfitSummary;
  readonly losses: LossSummary;
  readonly unmappedLossCount: number;
  readonly invalidBusinessToday: boolean;
}): FinancialWarning[] {
  const { profit, losses } = input;
  const warnings: FinancialWarning[] = [];

  if (profit.productsWithIncompleteCost.length > 0) {
    warnings.push({
      code: "COSTO_VENTAS_INCOMPLETO",
      message: "Hay productos vendidos con costo de receta incompleto: el COGS está subestimado y la utilidad sobreestimada.",
      count: profit.productsWithIncompleteCost.length,
      affectsTotals: true
    });
  }
  if (profit.unknownProductIds.length > 0) {
    warnings.push({
      code: "PRODUCTO_VENDIDO_NO_CATALOGADO",
      message: "Hay ventas de productos que no están en el catálogo: cuentan como ingreso sin costo.",
      count: profit.unknownProductIds.length,
      affectsTotals: true
    });
  }
  if (losses.unknownCostRecords > 0) {
    warnings.push({
      code: "COSTO_PERDIDA_DESCONOCIDO",
      message: "Hay pérdidas sin costo confiable: cuentan como unidades pero aportan $0, así que las pérdidas están subestimadas.",
      count: losses.unknownCostRecords,
      affectsTotals: true
    });
  }
  if (losses.invalidRecords > 0) {
    warnings.push({
      code: "PERDIDAS_INVALIDAS",
      message: "Hay pérdidas con cantidad o fecha inválida que se descartaron del total.",
      count: losses.invalidRecords,
      affectsTotals: true
    });
  }
  if (input.unmappedLossCount > 0) {
    warnings.push({
      code: "MOTIVO_PERDIDA_NO_RECONOCIDO",
      message: "Hay salidas con motivo no reconocido; se contaron como Faltante. El total no cambia, la clasificación sí.",
      count: input.unmappedLossCount,
      affectsTotals: false
    });
  }
  if (input.invalidBusinessToday) {
    warnings.push({
      code: "FECHA_HOY_INVALIDA",
      message: "`businessToday` no es un día válido (YYYY-MM-DD): no se evaluaron los productos por vencer.",
      count: 1,
      affectsTotals: false
    });
  }
  return warnings;
}

/* ========================================================================== */
/* Reporte                                                                    */
/* ========================================================================== */

/**
 * Consolida ventas netas, COGS, utilidad bruta, pérdidas del Kardex y utilidad
 * real. No lanza ante datos sucios: los reporta en `dataQuality`.
 */
export function buildFinancialReport(input: FinancialReportInput): FinancialReport {
  const profit = computeProfitSummary({ catalog: input.catalog, sales: input.sales });

  const productById = new Map(input.products.map((product) => [product.id, product]));
  const { records, unmappedCount } = movementsToLossRecords(input.movements, productById, input.unitCosts);

  const losses = summarizeLosses({
    records,
    inventory: productsToLossInventory(input.products, input.unitCosts),
    period: input.period,
    // Con ventas netas el motor calcula pérdidas/ventas; sin ventas devuelve null.
    revenue: profit.revenue,
    options: { now: input.now, expiryWarningDays: input.expiryWarningDays }
  });

  // Vencimiento POTENCIAL: el vencimiento es un día de calendario del negocio,
  // por eso se compara contra `businessToday` y no contra el instante `now`.
  const todayMs = input.businessToday === undefined ? null : isoDayToUtcMs(input.businessToday);
  const expiryRisk =
    todayMs === null
      ? []
      : findExpiryRisk(
          buildExpiringLots(input.movements, input.products, input.unitCosts),
          todayMs,
          input.expiryWarningDays
        );
  const expiryRiskValue = expiryRisk.reduce((sum, risk) => sum + risk.valueAtRisk, 0);

  const warnings = buildWarnings({
    profit,
    losses,
    unmappedLossCount: unmappedCount,
    invalidBusinessToday: input.businessToday !== undefined && todayMs === null
  });

  const realProfit = profit.grossProfit - losses.totalCost;

  return {
    netSales: profit.revenue,
    cogs: profit.cogs,
    grossProfit: profit.grossProfit,
    grossMarginPercent: profit.grossMarginPercent,

    lossCost: losses.totalCost,
    lossByCategory: lossCostByCategory(losses.byCategory),
    lossPercentOfSales: losses.lossPercentOfRevenue,

    realProfit,
    realMarginPercent: percentOf(realProfit, profit.revenue),

    expiryRisk,
    expiryRiskValue,

    dataQuality: {
      isComplete: !warnings.some((warning) => warning.affectsTotals),
      productsWithIncompleteCost: profit.productsWithIncompleteCost,
      unknownProductIds: profit.unknownProductIds,
      unknownCostLossRecords: losses.unknownCostRecords,
      invalidLossRecords: losses.invalidRecords,
      unmappedLossCount: unmappedCount,
      warnings
    },

    profit,
    losses
  };
}