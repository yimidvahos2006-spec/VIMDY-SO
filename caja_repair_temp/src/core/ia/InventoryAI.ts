import { Product } from "../entities/Entities";

export interface InventoryStatus {
  totalProducts: number;
  totalStock: number;
  criticalProducts: number;
  healthyProducts: number;
  inventoryHealth: number;
}

export interface PurchaseRecommendation {
  productId: string;
  productName: string;
  currentStock: number;
  recommendedPurchase: number;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
}

export class InventoryAI {

  /**
   * Total de productos.
   */
  getTotalProducts(products: Product[]): number {
    return products.length;
  }

  /**
   * Total de unidades.
   */
  getTotalUnits(products: Product[]): number {
    return products.reduce(
      (sum, product) => sum + product.stock,
      0
    );
  }

  /**
   * Productos críticos.
   *
   * BLOQUEANTE (bug reportado en video 2026-07-31): un producto con
   * trackStock === false (Servicio, o Cocina sin receta, ej. Caldo de
   * Costilla) nace y se queda en stock 0 a propósito porque no maneja
   * stock propio. Sin este chequeo, generatePurchaseRecommendations() (que
   * useAutoAlerts.ts corre cada minuto en vivo) lo empujaba para siempre
   * como notificación "IA recomienda comprar" con prioridad CRITICAL —
   * mismo criterio que InventoryEngine.getLowStockProducts.
   */
  getCriticalProducts(products: Product[]): Product[] {
    return products.filter(
      product => product.trackStock !== false && product.stock <= product.minStock
    );
  }

  /**
   * Productos saludables.
   *
   * Simetría con getCriticalProducts: un producto trackStock === false se
   * excluye del conteo (no cuenta como "sano" ni como "crítico"), para no
   * distorsionar calculateInventoryHealth() en ningún sentido.
   */
  getHealthyProducts(products: Product[]): Product[] {
    return products.filter(
      product => product.trackStock !== false && product.stock > product.minStock
    );
  }

  /**
   * Salud del inventario.
   */
  calculateInventoryHealth(products: Product[]): number {
    // Mismo criterio que getCriticalProducts/getHealthyProducts: un
    // producto trackStock === false no participa ni como "sano" ni como
    // "crítico", así que tampoco debe contar en el denominador — si no,
    // el % de salud del inventario bajaría artificialmente por productos
    // que ni siquiera manejan stock propio.
    const tracked = products.filter(product => product.trackStock !== false);
    if (tracked.length === 0) return 100;
    const healthy = this.getHealthyProducts(tracked).length;
    return Math.round((healthy / tracked.length) * 100);
  }

  /**
   * Estado general del inventario.
   */
  generateInventoryStatus(products: Product[]): InventoryStatus {
    return {
      totalProducts: this.getTotalProducts(products),
      totalStock: this.getTotalUnits(products),
      criticalProducts: this.getCriticalProducts(products).length,
      healthyProducts: this.getHealthyProducts(products).length,
      inventoryHealth: this.calculateInventoryHealth(products)
    };
  }

  /**
   * Calcula cuánto comprar.
   */
  calculatePurchaseQuantity(product: Product): number {
    if (product.stock >= product.minStock) {
      return 0;
    }
    return Math.max(
      (product.minStock * 2) - product.stock,
      1
    );
  }

  /**
   * Determina la prioridad de compra.
   */
  calculatePriority(
    product: Product
  ): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
    if (product.stock === 0) {
      return "CRITICAL";
    }
    if (product.stock <= product.minStock * 0.5) {
      return "HIGH";
    }
    if (product.stock <= product.minStock) {
      return "MEDIUM";
    }
    return "LOW";
  }

  /**
   * Genera recomendaciones de compra.
   */
  generatePurchaseRecommendations(
    products: Product[]
  ): PurchaseRecommendation[] {
    return this.getCriticalProducts(products)
      .map(product => ({
        productId: product.id,
        productName: product.name,
        currentStock: product.stock,
        recommendedPurchase: this.calculatePurchaseQuantity(product),
        priority: this.calculatePriority(product)
      }))
      .sort((a, b) => {
        const priority = {
          CRITICAL: 4,
          HIGH: 3,
          MEDIUM: 2,
          LOW: 1
        };
        return priority[b.priority] - priority[a.priority];
      });
  }

  /**
   * Busca productos agotados.
   *
   * Mismo criterio: trackStock === false nace en stock 0 a propósito, no
   * es un "agotado" real.
   */
  getOutOfStockProducts(products: Product[]): Product[] {
    return products.filter(product => product.trackStock !== false && product.stock === 0);
  }

  /**
   * Detecta inventario sobrante.
   */
  getOverstockProducts(
    products: Product[],
    multiplier: number = 5
  ): Product[] {
    return products.filter(
      product => product.stock >= product.minStock * multiplier
    );
  }

  /**
   * Predice los días restantes de inventario.
   */
  predictDaysRemaining(
    product: Product,
    averageDailyConsumption: number
  ): number {
    if (averageDailyConsumption <= 0) {
      return 999;
    }
    return Math.floor(product.stock / averageDailyConsumption);
  }

  /**
   * Calcula el riesgo del inventario.
   */
  calculateRisk(
    product: Product
  ): "LOW" | "MEDIUM" | "HIGH" | "CRITICAL" {
    if (product.stock === 0) {
      return "CRITICAL";
    }
    if (product.stock <= product.minStock / 2) {
      return "HIGH";
    }
    if (product.stock <= product.minStock) {
      return "MEDIUM";
    }
    return "LOW";
  }

  /**
   * Obtiene los productos con mayor riesgo.
   */
  getRiskProducts(products: Product[]): Product[] {
    return [...products].sort((a, b) => {
      return a.stock - b.stock;
    });
  }

  /**
   * Resumen ejecutivo del inventario.
   */
  generateExecutiveSummary(products: Product[]) {
    const status = this.generateInventoryStatus(products);

    return {
      status,
      critical: this.getCriticalProducts(products),
      outOfStock: this.getOutOfStockProducts(products),
      overStock: this.getOverstockProducts(products),
      recommendations: this.generatePurchaseRecommendations(products)
    };
  }

}