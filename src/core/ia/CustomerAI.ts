import { Customer, Sale } from "../entities/Entities";

export interface CustomerAnalysis {
  totalCustomers: number;
  activeCustomers: number;
  vipCustomers: number;
  averageSpent: number;
}

export interface CustomerRanking {
  customerId: string;
  totalSpent: number;
  totalOrders: number;
}

export class CustomerAI {

  /**
   * Total de clientes.
   */
  getTotalCustomers(customers: Customer[]): number {
    return customers.length;
  }

  /**
   * Total gastado por cliente.
   */
  calculateCustomerSpending(
    customerId: string,
    sales: Sale[]
  ): number {
    return sales
      .filter(sale => sale.customerId === customerId)
      .reduce((sum, sale) => sum + sale.total, 0);
  }

  /**
   * Total de pedidos por cliente.
   */
  calculateCustomerOrders(
    customerId: string,
    sales: Sale[]
  ): number {
    return sales.filter(
      sale => sale.customerId === customerId
    ).length;
  }

  /**
   * Ranking de clientes.
   */
  generateCustomerRanking(
    customers: Customer[],
    sales: Sale[]
  ): CustomerRanking[] {
    return customers
      .map(customer => ({
        customerId: customer.id,
        totalSpent: this.calculateCustomerSpending(
          customer.id,
          sales
        ),
        totalOrders: this.calculateCustomerOrders(
          customer.id,
          sales
        )
      }))
      .sort((a, b) => b.totalSpent - a.totalSpent);
  }

  /**
   * Mejor cliente.
   */
  getBestCustomer(
    customers: Customer[],
    sales: Sale[]
  ): CustomerRanking | null {
    const ranking = this.generateCustomerRanking(
      customers,
      sales
    );
    if (ranking.length === 0) return null;
    return ranking[0];
  }

  /**
   * Detecta clientes VIP.
   */
  getVIPCustomers(
    customers: Customer[],
    sales: Sale[],
    minimumSpent: number = 1000000
  ): Customer[] {
    return customers.filter(
      customer =>
        this.calculateCustomerSpending(customer.id, sales) >=
        minimumSpent
    );
  }

  /**
   * Clientes activos.
   */
  getActiveCustomers(
    customers: Customer[],
    sales: Sale[]
  ): Customer[] {
    return customers.filter(
      customer =>
        this.calculateCustomerOrders(customer.id, sales) > 0
    );
  }

  /**
   * Clientes sin compras.
   */
  getInactiveCustomers(
    customers: Customer[],
    sales: Sale[]
  ): Customer[] {
    return customers.filter(
      customer =>
        this.calculateCustomerOrders(customer.id, sales) === 0
    );
  }

  /**
   * Gasto promedio por cliente.
   */
  getAverageSpent(
    customers: Customer[],
    sales: Sale[]
  ): number {
    if (customers.length === 0) {
      return 0;
    }

    const total = customers.reduce(
      (sum, customer) =>
        sum + this.calculateCustomerSpending(customer.id, sales),
      0
    );

    return Math.round(total / customers.length);
  }

  /**
   * Genera un análisis general de clientes.
   */
  generateCustomerAnalysis(
    customers: Customer[],
    sales: Sale[]
  ): CustomerAnalysis {
    return {
      totalCustomers: this.getTotalCustomers(customers),
      activeCustomers: this.getActiveCustomers(customers, sales)
        .length,
      vipCustomers: this.getVIPCustomers(customers, sales)
        .length,
      averageSpent: this.getAverageSpent(customers, sales)
    };
  }

  /**
   * Calcula el nivel de fidelidad del cliente.
   */
  getCustomerLevel(
    customerId: string,
    sales: Sale[]
  ): "BRONZE" | "SILVER" | "GOLD" | "PLATINUM" {
    const totalSpent = this.calculateCustomerSpending(
      customerId,
      sales
    );

    if (totalSpent >= 5000000) {
      return "PLATINUM";
    }
    if (totalSpent >= 2000000) {
      return "GOLD";
    }
    if (totalSpent >= 500000) {
      return "SILVER";
    }
    return "BRONZE";
  }

  /**
   * Genera una recomendación para el cliente.
   */
  generateRecommendation(
    customerId: string,
    sales: Sale[]
  ): string {
    const level = this.getCustomerLevel(customerId, sales);

    switch (level) {
      case "PLATINUM":
        return "Cliente premium. Ofrécele beneficios exclusivos.";
      case "GOLD":
        return "Cliente muy importante. Envíale promociones especiales.";
      case "SILVER":
        return "Buen cliente. Invítalo a regresar con descuentos.";
      default:
        return "Cliente nuevo. Incentiva su próxima compra.";
    }
  }

  /**
   * Resumen ejecutivo.
   */
  generateExecutiveSummary(
    customers: Customer[],
    sales: Sale[]
  ) {
    const analysis = this.generateCustomerAnalysis(
      customers,
      sales
    );

    const ranking = this.generateCustomerRanking(
      customers,
      sales
    );

    return {
      analysis,
      bestCustomer: ranking.length > 0 ? ranking[0] : null,
      vipCustomers: this.getVIPCustomers(customers, sales),
      inactiveCustomers: this.getInactiveCustomers(
        customers,
        sales
      ),
      ranking
    };
  }

}