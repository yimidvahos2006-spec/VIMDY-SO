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
    private readonly recipe: RecipeEngine
  ) {}

  public async getExecutiveSummary(): Promise<DashboardSummary> {
    const [products, sales, customers, kitchen, alerts] = await Promise.all([
      this.productRepository.findAll(),
      this.saleRepository.findAll(),
      this.customerRepository.findAll(),
      this.kitchenRepository.findAll(),
      this.alertRepository.findAll()
    ]);

    const totalSales = sales.reduce((sum, sale) => sum + sale.total, 0);
    const criticalAlerts = alerts.filter(
      alert => alert.priority === "CRITICAL"
    ).length;

    // BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
    // trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
    // Costilla) nace en stock 0 a propósito porque no maneja stock propio
    // — no debe contar como "mal" en el % de salud de inventario del
    // resumen ejecutivo, ni tampoco en el total contra el que se divide
    // (si no, el % baja artificialmente aunque el inventario real esté
    // perfecto). Mismo criterio que InventoryAI.calculateInventoryHealth.
    const trackedProducts = products.filter(product => product.trackStock !== false);
    const inventoryLevel =
      trackedProducts.length === 0
        ? 1
        : trackedProducts.filter(product => product.stock > product.minStock)
            .length / trackedProducts.length;

    const aiTrend = this.ai.analyzeSalesTrend(totalSales);

    // BLOQUEANTE (auditoría 2026-07-31): el resumen ejecutivo usaba
    // `totalSales * 0.3` como ganancia — un 30% fijo inventado, igual para
    // targetProfit, así que ese componente del health score nunca podía
    // fallar. Ahora se calcula la ganancia real, mismo criterio que
    // BusinessAnalyzer.getSmartManagerSummary: por cada línea vendida,
    // price - RecipeEngine.getProfitability(product).cost, saltando los
    // productos con costUnreliable (falta purchasePrice de algún
    // ingrediente) en vez de fingir un costo que no se conoce.
    const productById = new Map(products.map(product => [product.id, product]));
    const currentProfit = sales.reduce((sum, sale) => {
      const saleProfit = sale.items.reduce((itemSum, item) => {
        const product = productById.get(item.productId);
        if (!product) return itemSum;
        const profitability = this.recipe.getProfitability(product, productById);
        if (profitability.costUnreliable) return itemSum;
        return itemSum + (item.price - profitability.cost) * item.quantity;
      }, 0);
      return sum + saleProfit;
    }, 0);

    const health = this.health.calculate({
      currentSales: totalSales,
      targetSales: totalSales,
      currentProfit,
      targetProfit: currentProfit,
      inventoryLevel,
      cashBalance: 0,
      diff: 0,
      retentionRate: 80,
      criticalAlerts,
      aiTrend
    });

    const lowStockProducts = await this.inventory.getLowStockProducts();
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