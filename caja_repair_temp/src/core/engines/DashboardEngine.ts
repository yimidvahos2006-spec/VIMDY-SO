import {
  Product,
  Sale,
  Customer,
  KitchenOrder,
  Alert
} from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { HealthEngine } from "./HealthEngine";
import { AIEngine } from "./AIEngine";
import { InventoryEngine } from "./InventoryEngine";
import { RecipeEngine } from "./RecipeEngine";
import { CashEngine } from "./CashEngine";
import { ForecastEngine } from "./ForecastEngine";
import { DashboardSummary } from "../types/DashboardTypes";

/**
 * DashboardEngine
 * ---------------------------------------------------------------------------
 * Compone el resumen ejecutivo del negocio (ventas, clientes, cocina,
 * alertas, salud y recomendaciones de IA) a partir de los repositorios y
 * motores especializados. Es consumido por DashboardService.
 */
export class DashboardEngine {
  constructor(
    private readonly productRepository: IRepository<Product>,
    private readonly saleRepository: IRepository<Sale>,
    private readonly customerRepository: IRepository<Customer>,
    private readonly kitchenRepository: IRepository<KitchenOrder>,
    private readonly alertRepository: IRepository<Alert>,
    private readonly health: HealthEngine,
    private readonly ai: AIEngine,
    private readonly inventory: InventoryEngine,
    // Ganancia real del resumen ejecutivo: mismo criterio que BusinessAnalyzer
    // (item.price - RecipeEngine.getProfitability(product).cost), en vez del
    // 30% fijo que había antes. Nunca inventa costo: los items cuyo producto
    // tenga costUnreliable (falta purchasePrice de algún ingrediente) no
    // suman a la ganancia, ni a favor ni en contra.
    private readonly recipe: RecipeEngine,
    private readonly cashEngine: CashEngine,
    private readonly forecastEngine: ForecastEngine
  ) {}

  public async getExecutiveSummary(): Promise<DashboardSummary> {
    const [products, sales, customers, kitchen, alerts, lowStockProducts] = await Promise.all([
      this.productRepository.findAll(),
      this.saleRepository.findAll(),
      this.customerRepository.findAll(),
      this.kitchenRepository.findAll(),
      this.alertRepository.findAll(),
      this.inventory.getLowStockProducts()
    ]);

    const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
    const criticalAlerts = alerts.filter(
      alert => alert.priority === "CRITICAL"
    ).length;

    const trackedProducts = products.filter(product => product.trackStock !== false);
    const inventoryLevel =
      trackedProducts.length === 0
        ? 1
        : trackedProducts.filter(product => product.stock > product.minStock)
            .length / trackedProducts.length;

    // Retención real: % de clientes que volvieron a comprar (más de una venta).
    // Si no hay clients o sales, se asume 100 (no penaliza por falta de datos).
    const paidSales = sales.filter(
      sale => sale.status === "PAID" || sale.status === "CLOSED"
    );
    const customerPurchaseCount = new Map<string, number>();
    for (const sale of paidSales) {
      if (sale.customerId) {
        customerPurchaseCount.set(
          sale.customerId,
          (customerPurchaseCount.get(sale.customerId) ?? 0) + 1
        );
      }
    }
    const repeatCustomers = Array.from(customerPurchaseCount.values()).filter(
      count => count > 1
    ).length;
    const retentionRate =
      customers.length === 0 || paidSales.length === 0
        ? 100
        : (repeatCustomers / customers.length) * 100;

    const aiTrend = this.ai.analyzeSalesTrend(totalSales);

    const productById = new Map(products.map(product => [product.id, product]));
    const profitabilityCache = new Map<string, { cost: number; costUnreliable: boolean }>();
    const getCachedProfitability = (productId: string) => {
      const cached = profitabilityCache.get(productId);
      if (cached) return cached;
      const product = productById.get(productId);
      if (!product) return { cost: 0, costUnreliable: true };
      const result = this.recipe.getProfitability(product, productById);
      const entry = { cost: result.cost, costUnreliable: result.costUnreliable };
      profitabilityCache.set(productId, entry);
      return entry;
    };

    const currentProfit = sales.reduce((sum, sale) => {
      const saleProfit = sale.items.reduce((itemSum, item) => {
        const { cost, costUnreliable } = getCachedProfitability(item.productId);
        if (costUnreliable) return itemSum;
        return itemSum + (item.price - cost) * item.quantity;
      }, 0);
      return sum + saleProfit;
    }, 0);

    const cashBalance = await this.cashEngine.getBalance();
    const forecastSummary = await this.forecastEngine.getSummary();

    const targetSales = forecastSummary.tomorrow?.expectedTotal ?? totalSales;
    const targetProfit = targetSales > 0
      ? (targetSales * (currentProfit / totalSales))
      : currentProfit;

    const health = this.health.calculate({
      currentSales: totalSales,
      targetSales,
      currentProfit,
      targetProfit,
      inventoryLevel,
      cashBalance,
      diff: totalSales - targetSales,
       retentionRate,
       criticalAlerts,
      aiTrend
    });

    const aiRecommendations =
      this.ai.generatePurchaseRecommendation(lowStockProducts);

    return {
      health,
      sales,
      customers,
      kitchen,
      alerts,
      aiRecommendations
    };
  }
}