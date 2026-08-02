import {
  HealthInput,
  HealthResult,
  HealthStatus,
  HealthColor,
} from '../types/HealthTypes';

export class HealthEngine {
  public calculate(input: HealthInput): HealthResult {
    let score = 100;

    // Ventas
    if (input.targetSales > 0) {
      const salesPercent = input.currentSales / input.targetSales;

      if (salesPercent < 1) {
        score -= Math.round((1 - salesPercent) * 20);
      }
    }

    // Utilidad
    if (input.targetProfit > 0) {
      const profitPercent = input.currentProfit / input.targetProfit;

      if (profitPercent < 1) {
        score -= Math.round((1 - profitPercent) * 20);
      }
    }

    // Inventario
    if (input.inventoryLevel < 0.30) {
      score -= 20;
    }

    // Retención
    if (input.retentionRate < 70) {
      score -= 15;
    }

    // Alertas críticas
    score -= input.criticalAlerts * 5;

    if (score < 0) score = 0;
    if (score > 100) score = 100;

    let status: HealthStatus;
    let color: HealthColor;
    let message: string;

    if (score >= 90) {
      status = 'EXCELLENT';
      color = 'SUCCESS';
      message = 'El negocio se encuentra en un estado excelente.';
    } else if (score >= 75) {
      status = 'GOOD';
      color = 'INFO';
      message = 'El negocio funciona correctamente.';
    } else if (score >= 50) {
      status = 'WARNING';
      color = 'WARNING';
      message = 'Se recomienda revisar algunos indicadores.';
    } else {
      status = 'CRITICAL';
      color = 'DANGER';
      message = 'El negocio requiere atención inmediata.';
    }

    return {
      score,
      status,
      color,
      message,
    };
  }
}