import { Product, Customer, Sale, CashMovement } from "../entities/Entities";

import { SalesAI } from "./SalesAI";
import { InventoryAI } from "./InventoryAI";
import { CustomerAI } from "./CustomerAI";
import { FinanceAI } from "./FinanceAI";

export interface BusinessRecommendation {
  id: string;
  title: string;
  description: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  category:
    | "SALES"
    | "INVENTORY"
    | "CUSTOMERS"
    | "FINANCE";
}

export class RecommendationAI {

  private salesAI = new SalesAI();
  private inventoryAI = new InventoryAI();
  private customerAI = new CustomerAI();
  private financeAI = new FinanceAI();

  /**
   * Recomendaciones de ventas.
   */
  generateSalesRecommendations(
    sales: Sale[]
  ): BusinessRecommendation[] {
    const recommendations: BusinessRecommendation[] = [];

    if (this.salesAI.getTotalSales(sales) < 500000) {
      recommendations.push({
        id: "sales-1",
        title: "Incrementar ventas",
        description:
          "Las ventas son bajas. Considere promociones para atraer más clientes.",
        priority: "HIGH",
        category: "SALES"
      });
    }

    return recommendations;
  }

  /**
   * Recomendaciones de inventario.
   */
  generateInventoryRecommendations(
    products: Product[]
  ): BusinessRecommendation[] {
    const recommendations: BusinessRecommendation[] = [];

    const critical = this.inventoryAI.getCriticalProducts(products);

    if (critical.length > 0) {
      recommendations.push({
        id: "inventory-1",
        title: "Inventario crítico",
        description: `${critical.length} productos necesitan reposición inmediata.`,
        priority: "CRITICAL",
        category: "INVENTORY"
      });
    }

    return recommendations;
  }

  /**
   * Recomendaciones de clientes.
   */
  generateCustomerRecommendations(
    customers: Customer[],
    sales: Sale[]
  ): BusinessRecommendation[] {
    const recommendations: BusinessRecommendation[] = [];

    const inactive = this.customerAI.getInactiveCustomers(
      customers,
      sales
    );

    if (inactive.length > 0) {
      recommendations.push({
        id: "customer-1",
        title: "Recuperar clientes",
        description: `${inactive.length} clientes no han realizado compras recientemente.`,
        priority: "MEDIUM",
        category: "CUSTOMERS"
      });
    }

    return recommendations;
  }

  /**
   * Recomendaciones financieras.
   */
  generateFinanceRecommendations(
    sales: Sale[],
    movements: CashMovement[]
  ): BusinessRecommendation[] {
    const recommendations: BusinessRecommendation[] = [];

    if (this.financeAI.hasLosses(sales, movements)) {
      recommendations.push({
        id: "finance-1",
        title: "Reducir gastos",
        description:
          "Se detectaron pérdidas. Revise los egresos y optimice los costos.",
        priority: "CRITICAL",
        category: "FINANCE"
      });
    }

    return recommendations;
  }

  /**
   * Genera todas las recomendaciones del negocio.
   */
  generateAllRecommendations(
    products: Product[],
    customers: Customer[],
    sales: Sale[],
    movements: CashMovement[]
  ): BusinessRecommendation[] {
    const recommendations: BusinessRecommendation[] = [
      ...this.generateSalesRecommendations(sales),
      ...this.generateInventoryRecommendations(products),
      ...this.generateCustomerRecommendations(customers, sales),
      ...this.generateFinanceRecommendations(sales, movements)
    ];

    const priority = {
      CRITICAL: 4,
      HIGH: 3,
      MEDIUM: 2,
      LOW: 1
    };

    return recommendations.sort(
      (a, b) => priority[b.priority] - priority[a.priority]
    );
  }

  /**
   * Obtiene únicamente las recomendaciones críticas.
   */
  getCriticalRecommendations(
    products: Product[],
    customers: Customer[],
    sales: Sale[],
    movements: CashMovement[]
  ): BusinessRecommendation[] {
    return this.generateAllRecommendations(
      products,
      customers,
      sales,
      movements
    ).filter(recommendation => recommendation.priority === "CRITICAL");
  }

  /**
   * Resumen ejecutivo de la IA.
   */
  generateExecutiveSummary(
    products: Product[],
    customers: Customer[],
    sales: Sale[],
    movements: CashMovement[]
  ) {
    const recommendations = this.generateAllRecommendations(
      products,
      customers,
      sales,
      movements
    );

    return {
      totalRecommendations: recommendations.length,
      critical: recommendations.filter(
        recommendation => recommendation.priority === "CRITICAL"
      ).length,
      high: recommendations.filter(
        recommendation => recommendation.priority === "HIGH"
      ).length,
      medium: recommendations.filter(
        recommendation => recommendation.priority === "MEDIUM"
      ).length,
      low: recommendations.filter(
        recommendation => recommendation.priority === "LOW"
      ).length,
      recommendations
    };
  }

}