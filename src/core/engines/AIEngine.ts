import { Product } from "../entities/Entities";
import { isStockMasked, maskedStatusText, maskedStockStatus } from "../utils/stockMask";

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

    const recommendations = lowStockProducts.flatMap((product): string[] => {

      // Conteo a ciegas: `stock` es un valor de banda, no la cantidad real. Solo el estado.
      if (isStockMasked(product)) {
        return [`Reponer "${product.name}" (${maskedStatusText(maskedStockStatus(product))}).`];
      }

      // Sin stock mínimo definido y sin stock negativo no hay nada que
      // comprar: se omite en vez de mostrar "Comprar 0 unidades".
      if (!(product.minStock > 0) && !(product.stock < 0)) {
        return [];
      }

      const faltantes = Math.max(
        Math.ceil(product.minStock - product.stock),
        1
      );

      const unidades = faltantes === 1 ? "unidad" : "unidades";
      return [`Comprar ${faltantes} ${unidades} de "${product.name}". Stock actual: ${product.stock}.`];

    });

    if (recommendations.length === 0) {
      return [
        "El inventario está en buen estado. No se requieren compras urgentes."
      ];
    }

    return recommendations;

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