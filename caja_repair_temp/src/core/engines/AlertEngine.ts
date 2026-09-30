import { Product, Alert } from '../entities/Entities';

export class AlertEngine {
  public checkStockAlerts(products: Product[]): Alert[] {
    const alerts: Alert[] = [];

    for (const product of products) {
      // Simetría con InventoryEngine.buildConsumptionTargets: un producto
      // con trackStock === false (Servicio, o Cocina sin receta, ej. Caldo
      // de Costilla) nace y se queda con stock 0 a propósito porque no
      // maneja stock propio. Sin este chequeo, quedaba marcado para
      // siempre como "agotado" (CRITICAL) en el dashboard — una alerta
      // falsa que no exige ninguna acción real del negocio.
      if (product.trackStock === false) {
        continue;
      }

      if (product.stock <= 0) {
        alerts.push({
          id: crypto.randomUUID(),
          priority: 'CRITICAL',
          title: `${product.name} agotado`
        });
      } else if (product.stock <= product.minStock) {
        alerts.push({
          id: crypto.randomUUID(),
          priority: 'HIGH',
          title: `${product.name} con stock bajo`
        });
      }
    }

    return alerts;
  }
}