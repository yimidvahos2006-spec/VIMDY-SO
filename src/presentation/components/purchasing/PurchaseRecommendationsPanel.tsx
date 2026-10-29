// src/core/engines/PurchaseIntelligenceEngine.ts
import type { Product, Sale } from "../entities/Entities";
import type { IRepository } from "../../infrastructure/di/repositories/IRepository";
import type { InventoryEngine, SaleStockItem } from "./InventoryEngine";
import { getSaleNetItems } from "../utils/saleRefunds";
import {
  DEFAULT_PURCHASE_PLANNING_CONFIG,
  EMPTY_CONSUMPTION_WINDOW,
  buildPurchaseAnalysis,
  statusConsumesStock,
  type ConsumptionWindow,
  type PurchaseAnalysis,
  type PurchasePlanningConfig,
  type PurchaseRecommendation
} from "../domain/purchasing";

// Los tipos viven en el dominio; se reexportan para no romper a quienes ya
// importan desde este archivo (Dashboard de Compras, Copiloto, Pronóstico).
export type {
  ConsumptionDriver,
  PurchaseAnalysis,
  PurchaseAnalysisSummary,
  PurchaseRecommendation,
  PurchaseUrgency
} from "../domain/purchasing";

const MS_PER_DAY = 1000 * 60 * 60 * 24;

/** Profundidad máxima al seguir tandas que usan otras tandas (evita ciclos). */
const MAX_PRODUCTION_DEPTH = 5;

interface MutableWindow {
  totals: Map<string, number>;
  drivers: Map<string, Map<string, number>>;
}

function emptyWindow(): MutableWindow {
  return { totals: new Map(), drivers: new Map() };
}

function addConsumption(window: MutableWindow, ingredientId: string, drivenBy: string, quantity: number): void {
  if (!Number.isFinite(quantity) || quantity <= 0) return;
  window.totals.set(ingredientId, (window.totals.get(ingredientId) ?? 0) + quantity);
  const byProduct = window.drivers.get(ingredientId) ?? new Map<string, number>();
  byProduct.set(drivenBy, (byProduct.get(drivenBy) ?? 0) + quantity);
  window.drivers.set(ingredientId, byProduct);
}

/**
 * PurchaseIntelligenceEngine — Compras Inteligentes.
 * ---------------------------------------------------------------------------
 * Mide el consumo REAL de cada insumo a partir de las ventas del POS y lo
 * entrega al dominio (core/domain/purchasing) para decidir qué comprar, cuánto
 * y por qué. SOLO analiza: no crea órdenes de compra ni modifica stock.
 *
 * El consumo se expande con InventoryEngine.previewSaleConsumption, la MISMA
 * función que usa Caja para descontar el inventario: tamaños, extras,
 * sub-recetas y productos sin control de stock se tratan igual en ambos
 * lados. Además:
 *   - Las ventas canceladas o reembolsadas por completo no cuentan, y los
 *     reembolsos parciales descuentan las unidades devueltas.
 *   - Un producto por TANDAS (pan, salsas) descuenta su propio stock al
 *     venderse, pero sus ingredientes se gastan al producir: esa demanda se
 *     deriva de la receta para que el insumo no parezca "sin consumo".
 *   - En un negocio con menos de 7 días de ventas el promedio diario se
 *     calcula con los días realmente observados, no con 7.
 */
export class PurchaseIntelligenceEngine {
  constructor(
    private readonly inventoryEngine: InventoryEngine,
    private readonly saleRepository: IRepository<Sale>,
    private readonly config: Partial<PurchasePlanningConfig> = {}
  ) {}

  /** Lista de recomendaciones ordenada por urgencia (compatibilidad con Copiloto/Pronóstico). */
  public async getRecommendations(): Promise<PurchaseRecommendation[]> {
    return (await this.analyze()).recommendations;
  }

  /** Recomendaciones + resumen (conteos por urgencia, costo estimado, cobertura de datos). */
  public async analyze(now: Date = new Date()): Promise<PurchaseAnalysis> {
    const [products, sales] = await Promise.all([this.inventoryEngine.listAll(), this.saleRepository.findAll()]);
    const windowDays = this.config.windowDays ?? DEFAULT_PURCHASE_PLANNING_CONFIG.windowDays;

    const consumingSales = sales.filter((sale) => statusConsumesStock(sale.status));

    // Días observados: un negocio con 3 días de ventas promedia sobre 3, no sobre 7.
    const oldestAgeDays = consumingSales.reduce((oldest, sale) => {
      const age = Math.max((now.getTime() - new Date(sale.createdAt).getTime()) / MS_PER_DAY, 0);
      return Number.isFinite(age) ? Math.max(oldest, age) : oldest;
    }, 0);
    const observedDays = consumingSales.length === 0 ? windowDays : Math.min(Math.max(Math.ceil(oldestAgeDays), 1), windowDays);
    const previousObservedDays = Math.min(Math.max(Math.ceil(oldestAgeDays) - windowDays, 1), windowDays);

    const recent = this.measureConsumption(products, consumingSales, now, 0, windowDays);
    const previous =
      oldestAgeDays > windowDays
        ? this.measureConsumption(products, consumingSales, now, windowDays, windowDays * 2)
        : EMPTY_CONSUMPTION_WINDOW;

    return buildPurchaseAnalysis({
      products,
      recent,
      previous,
      recentDays: observedDays,
      previousDays: previousObservedDays,
      config: this.config
    });
  }

  /**
   * Consumo de cada insumo en las ventas con antigüedad en [fromDaysAgo, toDaysAgo).
   *
   * Las líneas idénticas (mismo producto, tamaño y extras) se suman ANTES de
   * expandir la receta: el consumo es lineal en la cantidad, así que el
   * resultado es exacto y se hace una expansión por variante, no una por línea
   * vendida. Cada variante conserva su tamaño y extras, que deciden la receta.
   */
  private measureConsumption(
    products: readonly Product[],
    sales: readonly Sale[],
    now: Date,
    fromDaysAgo: number,
    toDaysAgo: number
  ): ConsumptionWindow {
    const window = emptyWindow();
    const productById = new Map(products.map((product) => [product.id, product]));
    const variants = new Map<string, SaleStockItem>();

    for (const sale of sales) {
      const ageDays = Math.max((now.getTime() - new Date(sale.createdAt).getTime()) / MS_PER_DAY, 0);
      if (!Number.isFinite(ageDays) || ageDays < fromDaysAgo || ageDays >= toDaysAgo) continue;

      for (const item of getSaleNetItems(sale)) {
        const extrasKey = (item.selectedExtras ?? [])
          .map((extra) => extra.id)
          .sort()
          .join(",");
        const key = `${item.productId}|${item.selectedSize?.id ?? ""}|${extrasKey}`;
        const existing = variants.get(key);
        variants.set(key, {
          productId: item.productId,
          quantity: (existing?.quantity ?? 0) + item.quantity,
          selectedSize: item.selectedSize,
          selectedExtras: item.selectedExtras
        });
      }
    }

    for (const variant of variants.values()) {
      let consumption: Map<string, number>;
      try {
        consumption = this.inventoryEngine.previewSaleConsumption([variant], products);
      } catch {
        // Producto eliminado, receta con ciclo o cantidad inválida: esa
        // variante no se puede medir. Se omite en vez de tumbar todo el análisis.
        continue;
      }

      for (const [ingredientId, quantity] of consumption) {
        addConsumption(window, ingredientId, variant.productId, quantity);

        const stocked = productById.get(ingredientId);
        if (stocked?.productionMode === "BATCH" && stocked.recipe?.length) {
          this.addProductionDemand(window, products, productById, stocked, quantity, variant.productId, 0);
        }
      }
    }

    return window;
  }

  /**
   * Un producto por tandas se vende desde su propio stock; sus ingredientes se
   * gastaron (o se gastarán) al producirlo. Cada unidad vendida implica
   * reponer esa unidad, así que se le carga a los ingredientes su receta.
   */
  private addProductionDemand(
    window: MutableWindow,
    products: readonly Product[],
    productById: ReadonlyMap<string, Product>,
    batchProduct: Product,
    units: number,
    drivenBy: string,
    depth: number
  ): void {
    if (depth >= MAX_PRODUCTION_DEPTH) return;

    for (const ingredient of batchProduct.recipe ?? []) {
      let consumption: Map<string, number>;
      try {
        consumption = this.inventoryEngine.previewSaleConsumption(
          [{ productId: ingredient.productId, quantity: ingredient.quantity * units }],
          products
        );
      } catch {
        continue;
      }

      for (const [ingredientId, quantity] of consumption) {
        addConsumption(window, ingredientId, drivenBy, quantity);

        const nested = productById.get(ingredientId);
        if (nested?.productionMode === "BATCH" && nested.recipe?.length && nested.id !== batchProduct.id) {
          this.addProductionDemand(window, products, productById, nested, quantity, drivenBy, depth + 1);
        }
      }
    }
  }
}