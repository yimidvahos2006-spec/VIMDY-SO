import { Product } from "../entities/Entities";
import { isStockMasked } from "../utils/stockMask";

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
  /** true si el ítem es un insumo (materia prima), no un producto vendible: permite nombrarlo con precisión en los avisos. */
  isIngredient?: boolean;
  /** true con stock enmascarado (conteo a ciegas): `currentStock` y `recommendedPurchase` vienen en 0 y no son reales. */
  stockMasked?: boolean;
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
    const stock = Number.isFinite(product.stock) ? product.stock : 0;
    const minStock = Number.isFinite(product.minStock) ? product.minStock : 0;

    // Stock ya cubierto (incluye stock 0 con mínimo 0): no hay nada que
    // reponer, así que no se inventa una cantidad. Un stock negativo (venta
    // sin existencias) sí es una necesidad real y sigue calculándose.
    if (stock >= minStock) {
      return 0;
    }
    return Math.max(
      Math.ceil((minStock * 2) - stock),
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
   *
   * Solo se recomienda comprar cuando hay una necesidad real:
   *   · Con cifras reales: la cantidad a comprar debe ser mayor que 0. Un
   *     producto con stock 0 y stock mínimo 0 (o sin mínimo definido) cuenta
   *     como "crítico" por getCriticalProducts (0 <= 0), pero no tiene punto
   *     de reorden, así que NO genera sugerencias del tipo "Comprar 0 u.".
   *   · Con stock enmascarado (conteo a ciegas): no hay cifras, así que se
   *     conserva la recomendación solo si el estado indica que hace falta
   *     reponer (agotado o bajo), nunca con cantidades inventadas.
   */
  generatePurchaseRecommendations(
    products: Product[]
  ): PurchaseRecommendation[] {
    return this.getCriticalProducts(products)
      .map((product): PurchaseRecommendation => {
        const masked = isStockMasked(product);
        return {
          productId: product.id,
          productName: product.name,
          // Con stock enmascarado no se puede calcular cuánto comprar: solo la prioridad (sale del estado).
          currentStock: masked ? 0 : product.stock,
          recommendedPurchase: masked ? 0 : this.calculatePurchaseQuantity(product),
          priority: this.calculatePriority(product),
          ...(product.isIngredient === true ? { isIngredient: true } : {}),
          ...(masked ? { stockMasked: true } : {})
        };
      })
      .filter(
        (rec) => rec.stockMasked === true || rec.recommendedPurchase > 0
      )
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