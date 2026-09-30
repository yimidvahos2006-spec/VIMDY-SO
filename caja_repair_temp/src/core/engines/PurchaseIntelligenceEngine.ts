// src/core/engines/PurchaseIntelligenceEngine.ts
import { Product, Sale } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { InventoryEngine } from "./InventoryEngine";

/** Ventana reciente usada para medir el ritmo de consumo actual. */
const RECENT_WINDOW_DAYS = 7;
/** Ventana anterior, para comparar y saber si el consumo sube o baja (motivo real, no inventado). */
const PREVIOUS_WINDOW_DAYS = 7;
/** Días de cobertura que se recomienda comprar de una sola vez. */
const REORDER_COVERAGE_DAYS = 14;
/** Días restantes a partir de los cuales la urgencia es alta / media. */
const URGENT_DAYS_THRESHOLD = 2;
const WARNING_DAYS_THRESHOLD = 5;
/** Crecimiento mínimo (%) frente a la semana anterior para mencionarlo como motivo. */
const GROWTH_MENTION_THRESHOLD = 15;

export type PurchaseUrgency = "ALTA" | "MEDIA" | "BAJA";

/**
 * Una recomendación de compra para UN insumo/producto simple, con todo lo
 * que el dueño necesita para decidir sin sacar calculadora: cuánto comprar,
 * qué tan urgente es, cuántos días quedan y por qué.
 */
export interface PurchaseRecommendation {
  readonly productId: string;
  readonly productName: string;
  readonly unit: string | null;
  readonly currentStock: number;
  readonly recommendedQuantity: number;
  readonly urgency: PurchaseUrgency;
  /** null si no hay ritmo de consumo medible todavía (sin ventas recientes). */
  readonly daysUntilStockout: number | null;
  readonly reason: string;
  readonly alert: string;
  /** true si este insumo se consume (también, o solo) porque es ingrediente de una receta que se vendió — no porque se venda suelto. */
  readonly consumedViaRecipes: boolean;
  /** false si todavía no hay consumo real medible (negocio nuevo o producto sin ventas): la cantidad sugerida es solo "completar hasta el mínimo", no una proyección de demanda. */
  readonly basedOnSalesHistory: boolean;
}

/**
 * PurchaseIntelligenceEngine — PASO 2.6 (Compras Inteligentes).
 * ---------------------------------------------------------------------------
 * Analiza inventario + velocidad de venta/consumo real (directa y, vía
 * RecipeEngine/recetas, indirecta) para recomendar qué comprar, cuánto y con
 * qué urgencia. SOLO analiza: no crea órdenes de compra ni modifica stock.
 * Toda cifra sale de datos reales (ventas y recetas ya guardadas); si no hay
 * suficiente historial para un producto, simplemente no aparece en la lista
 * — nunca se inventa una cantidad o una urgencia.
 */
export class PurchaseIntelligenceEngine {
  constructor(
    private readonly inventoryEngine: InventoryEngine,
    private readonly saleRepository: IRepository<Sale>
  ) {}

  public async getRecommendations(): Promise<PurchaseRecommendation[]> {
    const [products, sales] = await Promise.all([this.inventoryEngine.listAll(), this.saleRepository.findAll()]);

    const now = new Date();
    const recent = this.buildConsumptionMap(products, sales, now, 0, RECENT_WINDOW_DAYS);
    const previous = this.buildConsumptionMap(
      products,
      sales,
      now,
      RECENT_WINDOW_DAYS,
      RECENT_WINDOW_DAYS + PREVIOUS_WINDOW_DAYS
    );

    const recommendations: PurchaseRecommendation[] = [];

    for (const product of products) {
      // Solo se compran insumos/productos simples: un producto CON receta se
      // prepara, no se compra. Lo que hay que comprar son sus ingredientes,
      // y cada uno se evalúa por su cuenta en esta misma vuelta del bucle.
      if (product.recipe && product.recipe.length > 0) continue;

      // BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
      // trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
      // Costilla) tampoco se compra — se prepara al momento — y se queda
      // en stock 0 a propósito. Sin este chequeo, cada venta real subía su
      // "ritmo de consumo" mientras el stock nunca se movía, así que
      // siempre daba daysUntilStockout=0 y recomendaba comprarlo con
      // urgencia ALTA para siempre.
      if (product.trackStock === false) continue;

      const dailyNow =
        (recent.direct.get(product.id) ?? 0) / RECENT_WINDOW_DAYS +
        (recent.recipe.get(product.id) ?? 0) / RECENT_WINDOW_DAYS;
      const dailyBefore =
        (previous.direct.get(product.id) ?? 0) / PREVIOUS_WINDOW_DAYS +
        (previous.recipe.get(product.id) ?? 0) / PREVIOUS_WINDOW_DAYS;

      const belowMinimum = product.minStock > 0 && product.stock <= product.minStock;

      // Sin ritmo de consumo real y sin estar ya por debajo del mínimo: no
      // hay con qué recomendar nada — se omite. Nunca se recomienda "por si
      // acaso".
      if (dailyNow <= 0 && !belowMinimum) continue;

      const daysUntilStockout = dailyNow > 0 ? Math.floor(product.stock / dailyNow) : null;

      const needsAttention =
        belowMinimum || (daysUntilStockout !== null && daysUntilStockout <= REORDER_COVERAGE_DAYS);
      if (!needsAttention) continue;

      const recommendedQuantity = Math.ceil(
        Math.max(
          Math.ceil(dailyNow * REORDER_COVERAGE_DAYS) - product.stock,
          product.minStock - product.stock,
          belowMinimum ? 1 : 0
        )
      );
      if (recommendedQuantity <= 0) continue;

      let urgency: PurchaseUrgency;
      if (product.stock <= 0 || (daysUntilStockout !== null && daysUntilStockout <= URGENT_DAYS_THRESHOLD)) {
        urgency = "ALTA";
      } else if (belowMinimum || (daysUntilStockout !== null && daysUntilStockout <= WARNING_DAYS_THRESHOLD)) {
        urgency = "MEDIA";
      } else {
        urgency = "BAJA";
      }

      const growthPercent =
        dailyBefore > 0 ? Math.round(((dailyNow - dailyBefore) / dailyBefore) * 100) : dailyNow > 0 ? 100 : 0;

      recommendations.push({
        productId: product.id,
        productName: product.name,
        unit: product.unit ?? null,
        currentStock: product.stock,
        recommendedQuantity,
        urgency,
        daysUntilStockout,
        reason: this.buildReason({
          daysUntilStockout,
          belowMinimum,
          growthPercent,
          hadPreviousData: dailyBefore > 0,
          basedOnSalesHistory: dailyNow > 0
        }),
        alert: this.buildAlert(product.name, urgency, daysUntilStockout, dailyNow > 0),
        consumedViaRecipes: (recent.recipe.get(product.id) ?? 0) > 0,
        basedOnSalesHistory: dailyNow > 0
      });
    }

    const urgencyRank: Record<PurchaseUrgency, number> = { ALTA: 0, MEDIA: 1, BAJA: 2 };
    return recommendations.sort((a, b) => {
      if (urgencyRank[a.urgency] !== urgencyRank[b.urgency]) return urgencyRank[a.urgency] - urgencyRank[b.urgency];
      return (a.daysUntilStockout ?? 999) - (b.daysUntilStockout ?? 999);
    });
  }

  /**
   * Consumo total de cada producto en la ventana [fromDaysAgo, toDaysAgo):
   * "direct" es lo que se vendió tal cual (item.productId === product.id);
   * "recipe" es lo que se consumió porque es ingrediente de OTRO producto
   * que sí se vendió (ej. Carne se consume porque se vendieron Hamburguesas,
   * no porque "Carne" tenga una línea propia en la venta).
   */
  private buildConsumptionMap(
    products: Product[],
    sales: Sale[],
    now: Date,
    fromDaysAgo: number,
    toDaysAgo: number
  ): { direct: Map<string, number>; recipe: Map<string, number> } {
    const productById = new Map(products.map((p) => [p.id, p]));
    const direct = new Map<string, number>();
    const recipe = new Map<string, number>();

    for (const sale of sales) {
      const ageDays = (now.getTime() - new Date(sale.createdAt).getTime()) / (1000 * 60 * 60 * 24);
      if (ageDays < fromDaysAgo || ageDays >= toDaysAgo) continue;

      for (const item of sale.items) {
        direct.set(item.productId, (direct.get(item.productId) ?? 0) + item.quantity);

        const soldProduct = productById.get(item.productId);
        if (soldProduct?.recipe) {
          for (const ingredient of soldProduct.recipe) {
            recipe.set(
              ingredient.productId,
              (recipe.get(ingredient.productId) ?? 0) + ingredient.quantity * item.quantity
            );
          }
        }
      }
    }

    return { direct, recipe };
  }

  private buildReason(args: {
    daysUntilStockout: number | null;
    belowMinimum: boolean;
    growthPercent: number;
    hadPreviousData: boolean;
    basedOnSalesHistory: boolean;
  }): string {
    if (!args.basedOnSalesHistory) {
      return args.belowMinimum
        ? "Aún no hay ventas registradas de este producto — se sugiere completar hasta el stock mínimo que definiste."
        : "Aún no hay suficientes ventas para calcular una cantidad recomendada.";
    }
    if (args.hadPreviousData && args.growthPercent >= GROWTH_MENTION_THRESHOLD) {
      return `Porque su consumo subió ${args.growthPercent}% frente a la semana anterior.`;
    }
    if (args.belowMinimum) {
      return "Porque ya está en o por debajo del mínimo definido para este producto.";
    }
    if (args.daysUntilStockout !== null) {
      return `Porque al ritmo de consumo actual se agota en ${args.daysUntilStockout} día(s).`;
    }
    return "Porque el stock está bajo y no hay margen de reacción.";
  }

  private buildAlert(
    productName: string,
    urgency: PurchaseUrgency,
    daysUntilStockout: number | null,
    basedOnSalesHistory: boolean
  ): string {
    if (!basedOnSalesHistory) {
      return `${productName} no tiene ventas registradas todavía — aún no se puede calcular cuánto se vende por día. Repón hasta tu mínimo definido.`;
    }
    if (urgency === "ALTA") {
      return `Compra ${productName} hoy.`;
    }
    if (urgency === "MEDIA") {
      return daysUntilStockout !== null
        ? `${productName} alcanzará solamente para ${daysUntilStockout} día(s) más.`
        : `${productName} está por debajo del mínimo — revísalo pronto.`;
    }
    return `No necesitas comprar ${productName} todavía${
      daysUntilStockout !== null ? ` (quedan ~${daysUntilStockout} día(s))` : ""
    }.`;
  }
}