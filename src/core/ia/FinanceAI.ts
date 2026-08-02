import { Sale, CashMovement } from "../entities/Entities";

export interface FinanceAnalysis {
  totalIncome: number;
  totalExpenses: number;
  netProfit: number;
  profitMargin: number;
  totalTransactions: number;
}

export interface DailyFinance {
  date: string;
  income: number;
  expenses: number;
  profit: number;
}

export class FinanceAI {

  /**
   * Total de ingresos.
   */
  getTotalIncome(sales: Sale[]): number {
    return sales.reduce(
      (sum, sale) => sum + sale.total,
      0
    );
  }

  /**
   * Total de egresos.
   */
  getTotalExpenses(movements: CashMovement[]): number {
    return movements
      .filter(movement => movement.type === "OUT")
      .reduce((sum, movement) => sum + movement.amount, 0);
  }

  /**
   * Total de ingresos por caja.
   */
  getCashIncome(movements: CashMovement[]): number {
    return movements
      .filter(movement => movement.type === "IN")
      .reduce((sum, movement) => sum + movement.amount, 0);
  }

  /**
   * Utilidad neta.
   */
  calculateNetProfit(
    sales: Sale[],
    movements: CashMovement[]
  ): number {
    return (
      this.getTotalIncome(sales) - this.getTotalExpenses(movements)
    );
  }

  /**
   * Margen de utilidad.
   */
  calculateProfitMargin(
    sales: Sale[],
    movements: CashMovement[]
  ): number {
    const income = this.getTotalIncome(sales);
    if (income === 0) {
      return 0;
    }

    const profit = this.calculateNetProfit(sales, movements);

    return Number(((profit / income) * 100).toFixed(2));
  }

  /**
   * Flujo de caja.
   */
  calculateCashFlow(movements: CashMovement[]): number {
    const income = this.getCashIncome(movements);
    const expenses = this.getTotalExpenses(movements);
    return income - expenses;
  }

  /**
   * Total de transacciones.
   */
  getTotalTransactions(movements: CashMovement[]): number {
    return movements.length;
  }

  /**
   * Analiza las finanzas del negocio.
   */
  generateFinanceAnalysis(
    sales: Sale[],
    movements: CashMovement[]
  ): FinanceAnalysis {
    const income = this.getTotalIncome(sales);
    const expenses = this.getTotalExpenses(movements);
    const profit = this.calculateNetProfit(sales, movements);

    return {
      totalIncome: income,
      totalExpenses: expenses,
      netProfit: profit,
      profitMargin: this.calculateProfitMargin(sales, movements),
      totalTransactions: this.getTotalTransactions(movements)
    };
  }

  /**
   * Detecta pérdidas.
   */
  hasLosses(
    sales: Sale[],
    movements: CashMovement[]
  ): boolean {
    return this.calculateNetProfit(sales, movements) < 0;
  }

  /**
   * Estado financiero.
   */
  getFinancialStatus(
    sales: Sale[],
    movements: CashMovement[]
  ): "EXCELLENT" | "GOOD" | "WARNING" | "CRITICAL" {
    const margin = this.calculateProfitMargin(sales, movements);

    if (margin >= 40) return "EXCELLENT";
    if (margin >= 20) return "GOOD";
    if (margin >= 5) return "WARNING";
    return "CRITICAL";
  }

  /**
   * Genera recomendaciones financieras.
   */
  generateRecommendation(
    sales: Sale[],
    movements: CashMovement[]
  ): string {
    const status = this.getFinancialStatus(sales, movements);

    switch (status) {
      case "EXCELLENT":
        return "Excelente salud financiera. Considera expandir el negocio o invertir en crecimiento.";

      case "GOOD":
        return "Las finanzas son saludables. Mantén el control de gastos y continúa monitoreando.";

      case "WARNING":
        return "El margen de utilidad es bajo. Revisa costos, proveedores y promociones.";

      default:
        return "Situación financiera crítica. Reduce gastos y aumenta ingresos de inmediato.";
    }
  }

  /**
   * Proyección simple de ingresos.
   */
  projectNextMonthIncome(sales: Sale[]): number {
    return Math.round(this.getTotalIncome(sales) * 1.10);
  }

  /**
   * Resumen ejecutivo financiero.
   */
  generateExecutiveSummary(
    sales: Sale[],
    movements: CashMovement[]
  ) {
    const analysis = this.generateFinanceAnalysis(sales, movements);

    return {
      analysis,
      cashFlow: this.calculateCashFlow(movements),
      status: this.getFinancialStatus(sales, movements),
      projectedIncome: this.projectNextMonthIncome(sales),
      recommendation: this.generateRecommendation(sales, movements)
    };
  }

}