import { Sale, SaleItem } from "../entities/Entities";

export interface SalesAnalysis {
  totalSales: number;
  totalOrders: number;
  averageTicket: number;
  bestHour: number;
  worstHour: number;
  trend: "UP" | "DOWN" | "STABLE";
}

export interface ProductRanking {
  productId: string;
  quantity: number;
  revenue: number;
}

export class SalesAI {

  /**
   * Total vendido.
   */
  getTotalSales(sales: Sale[]): number {
    return sales.reduce(
      (total, sale) => total + sale.total,
      0
    );
  }

  /**
   * Total de pedidos.
   */
  getTotalOrders(sales: Sale[]): number {
    return sales.length;
  }

  /**
   * Ticket promedio.
   */
  getAverageTicket(sales: Sale[]): number {
    if (sales.length === 0) return 0;
    return Math.round(
      this.getTotalSales(sales) / sales.length
    );
  }

  /**
   * Productos más vendidos.
   */
  getBestSellingProducts(sales: Sale[]): ProductRanking[] {
    const ranking = new Map<string, ProductRanking>();

    sales.forEach(sale => {
      sale.items.forEach(item => {
        const current = ranking.get(item.productId);
        if (current) {
          current.quantity += item.quantity;
          current.revenue += item.quantity * item.price;
        } else {
          ranking.set(item.productId, {
            productId: item.productId,
            quantity: item.quantity,
            revenue: item.quantity * item.price
          });
        }
      });
    });

    return [...ranking.values()].sort(
      (a, b) => b.quantity - a.quantity
    );
  }

  /**
   * Producto estrella.
   */
  getTopProduct(sales: Sale[]): ProductRanking | null {
    const ranking = this.getBestSellingProducts(sales);
    if (ranking.length === 0) return null;
    return ranking[0];
  }

  /**
   * Cantidad total de productos vendidos.
   */
  getProductsSold(sales: Sale[]): number {
    let total = 0;
    sales.forEach(sale => {
      sale.items.forEach(item => {
        total += item.quantity;
      });
    });
    return total;
  }

  /**
   * Hora con más ventas.
   */
  getBestHour(sales: Sale[]): number {
    const hours = new Map<number, number>();
    sales.forEach(sale => {
      const hour = sale.createdAt.getHours();
      hours.set(
        hour,
        (hours.get(hour) ?? 0) + sale.total
      );
    });

    let bestHour = 0;
    let bestSales = 0;
    hours.forEach((value, hour) => {
      if (value > bestSales) {
        bestSales = value;
        bestHour = hour;
      }
    });

    return bestHour;
  }

  /**
   * Hora con menos ventas.
   */
  getWorstHour(sales: Sale[]): number {
    const hours = new Map<number, number>();
    sales.forEach(sale => {
      const hour = sale.createdAt.getHours();
      hours.set(
        hour,
        (hours.get(hour) ?? 0) + sale.total
      );
    });

    let worstHour = 0;
    let lowest = Number.MAX_VALUE;
    hours.forEach((value, hour) => {
      if (value < lowest) {
        lowest = value;
        worstHour = hour;
      }
    });

    return worstHour;
  }

  /**
   * Detecta tendencia de ventas.
   */
  detectTrend(
    currentSales: number,
    previousSales: number
  ): "UP" | "DOWN" | "STABLE" {
    if (currentSales > previousSales) return "UP";
    if (currentSales < previousSales) return "DOWN";
    return "STABLE";
  }

  /**
   * Calcula crecimiento porcentual.
   */
  calculateGrowth(
    currentSales: number,
    previousSales: number
  ): number {
    if (previousSales === 0) return 0;
    return Number(
      (
        ((currentSales - previousSales) / previousSales) * 100
      ).toFixed(2)
    );
  }

  /**
   * Genera un análisis general.
   */
  generateAnalysis(
    sales: Sale[],
    previousSales: number
  ): SalesAnalysis {
    const totalSales = this.getTotalSales(sales);

    return {
      totalSales,
      totalOrders: this.getTotalOrders(sales),
      averageTicket: this.getAverageTicket(sales),
      bestHour: this.getBestHour(sales),
      worstHour: this.getWorstHour(sales),
      trend: this.detectTrend(totalSales, previousSales)
    };
  }

  /**
   * Recomendación automática.
   */
  generateRecommendation(analysis: SalesAnalysis): string {
    if (analysis.trend === "UP") {
      return "Las ventas están creciendo. Aumenta inventario y personal.";
    }
    if (analysis.trend === "DOWN") {
      return "Las ventas disminuyeron. Considera promociones o campañas.";
    }
    return "Las ventas permanecen estables. Continúa monitoreando el negocio.";
  }

  /**
   * Detecta ventas sospechosamente altas.
   */
  detectLargeSales(
    sales: Sale[],
    limit: number = 1000000
  ): Sale[] {
    return sales.filter(sale => sale.total >= limit);
  }

  /**
   * Obtiene las últimas ventas.
   */
  getRecentSales(
    sales: Sale[],
    limit: number = 10
  ): Sale[] {
    return [...sales]
      .sort(
        (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
      )
      .slice(0, limit);
  }

  /**
   * Calcula ventas por cliente.
   */
  getSalesByCustomer(sales: Sale[]): Map<string, number> {
    const result = new Map<string, number>();

    sales.forEach(sale => {
      result.set(
        sale.customerId,
        (result.get(sale.customerId) ?? 0) + sale.total
      );
    });

    return result;
  }

  /**
   * Obtiene el cliente con mayor compra.
   */
  getBestCustomer(sales: Sale[]): string | null {
    const customers = this.getSalesByCustomer(sales);

    let bestCustomer: string | null = null;
    let highest = 0;

    customers.forEach((total, customer) => {
      if (total > highest) {
        highest = total;
        bestCustomer = customer;
      }
    });

    return bestCustomer;
  }

  /**
   * Resumen ejecutivo.
   */
  generateExecutiveSummary(
    sales: Sale[],
    previousSales: number
  ) {
    const analysis = this.generateAnalysis(sales, previousSales);

    return {
      analysis,
      topProduct: this.getTopProduct(sales),
      bestCustomer: this.getBestCustomer(sales),
      productsSold: this.getProductsSold(sales),
      recommendation: this.generateRecommendation(analysis)
    };
  }

}