export interface PredictionResult {

  expectedSales: number;

  expectedCustomers: number;

  expectedOrders: number;

  confidence: number;

  recommendation: string;

}

export class PredictionAI {

  /**
   * Predice ventas del día.
   */
  predictDailySales(history: number[]): PredictionResult {

    if (history.length === 0) {

      return {

        expectedSales: 0,

        expectedCustomers: 0,

        expectedOrders: 0,

        confidence: 0,

        recommendation:
          "No existen suficientes datos para generar una predicción."

      };

    }

    const average =
      history.reduce((a, b) => a + b, 0) /
      history.length;

    const customers = Math.round(
      average / 35000
    );

    const orders = Math.round(
      average / 42000
    );

    return {

      expectedSales: Math.round(average),

      expectedCustomers: customers,

      expectedOrders: orders,

      confidence: 85,

      recommendation:
        "Mantén suficiente inventario para cubrir la demanda esperada."

    };

  }

  /**
   * Predice ventas semanales.
   */
  predictWeeklySales(history: number[]): number {

    if (history.length === 0) return 0;

    const average =
      history.reduce((a, b) => a + b, 0) /
      history.length;

    return Math.round(
      average * 7
    );

  }

  /**
   * Detecta crecimiento.
   */
  detectGrowth(history: number[]): number {

    if (history.length < 2) return 0;

    const first = history[0];

    const last =
      history[history.length - 1];

    if (first === 0) return 0;

    return Number(

      (((last - first) / first) * 100)

        .toFixed(2)

    );

  }

  /**
   * Detecta si las ventas van bajando.
   */
  isSalesDropping(history: number[]): boolean {

    if (history.length < 3) return false;

    return (

      history[history.length - 1] <
      history[history.length - 2]

    );

  }

  /**
   * Recomienda una acción.
   */
  generateRecommendation(

    sales: number,

    growth: number

  ): string {

    if (sales <= 300000) {

      return "Lanza promociones para aumentar las ventas.";

    }

    if (growth >= 20) {

      return "Incrementa inventario y personal para soportar el crecimiento.";

    }

    return "El negocio mantiene un comportamiento estable.";

  }

}