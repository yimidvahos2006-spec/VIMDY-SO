import { Product } from "../entities/Entities";

export class AIEngine {

  /**
   * Recomienda compras según el inventario.
   */
  public generatePurchaseRecommendation(
    lowStockProducts: Product[]
  ): string[] {

    if (lowStockProducts.length === 0) {

      return [
        "El inventario está en buen estado. No se requieren compras urgentes."
      ];

    }

    return lowStockProducts.map(product => {

      const faltantes = Math.max(
        product.minStock - product.stock,
        1
      );

      return `Comprar ${faltantes} unidades de "${product.name}". Stock actual: ${product.stock}.`;

    });

  }

  /**
   * Analiza la tendencia de ventas.
   */
  public analyzeSalesTrend(
    totalSales: number
  ): "UP" | "DOWN" | "STABLE" {

    if (totalSales >= 1000000) {

      return "UP";

    }

    if (totalSales <= 300000) {

      return "DOWN";

    }

    return "STABLE";

  }

  /**
   * Genera consejos para el negocio.
   */
  public generateBusinessAdvice(
    totalSales: number,
    criticalAlerts: number
  ): string {

    if (criticalAlerts > 0) {

      return "Hay alertas críticas. Revisa inventario y operaciones antes de continuar.";

    }

    if (totalSales >= 1000000) {

      return "Excelente rendimiento. Considera aumentar inventario de los productos más vendidos.";

    }

    if (totalSales <= 300000) {

      return "Las ventas son bajas. Considera crear promociones o campañas para atraer más clientes.";

    }

    return "El negocio mantiene un comportamiento estable. Continúa monitoreando ventas e inventario.";

  }

  /**
   * Detecta productos críticos.
   */
  public detectCriticalProducts(
    products: Product[]
  ): Product[] {

    return products.filter(

      product => product.stock <= product.minStock

    );

  }

  /**
   * Genera una alerta rápida.
   */
  public generateAlert(
    products: Product[]
  ): string {

    const critical = this.detectCriticalProducts(products);

    if (critical.length === 0) {

      return "No existen productos críticos.";

    }

    return `Existen ${critical.length} productos que necesitan reposición inmediata.`;

  }

}