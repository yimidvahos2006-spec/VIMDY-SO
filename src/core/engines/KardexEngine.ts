import { InventoryMovement, LossCategory } from '../entities/Entities';
import { IRepository } from '../../infrastructure/di/repositories/IRepository';

export class KardexEngine {
  constructor(
    private readonly movementRepository: IRepository<InventoryMovement>
  ) {}

  /**
   * @param movementId PASO 1.7 (Cola offline para escrituras) — normalmente
   * se omite y se genera un id nuevo (crypto.randomUUID()), como siempre.
   * `syncPendingInventoryAdjustments.ts` SÍ lo pasa explícitamente, con el
   * mismo id que ya tenía el ajuste en la cola local: así, si la sincronización
   * se interrumpe a mitad de camino y se reintenta, `record()` reconoce que
   * ese movimiento puntual ya existe (ver `exists()` abajo) y no vuelve a
   * aplicar el mismo ajuste de stock una segunda vez.
   */
  public async record(
    productId: string,
    quantity: number,
    type: InventoryMovement['type'],
    reason: string,
    performedBy?: string,
    supplierId?: string,
    supplierName?: string,
    lossCategory?: LossCategory,
    movementId?: string,
    productName?: string
  ): Promise<void> {
    const movement: InventoryMovement = {
      id: movementId ?? crypto.randomUUID(),
      productId,
      productName,
      quantity,
      date: new Date(),
      type,
      reason,
      performedBy,
      supplierId,
      supplierName,
      lossCategory,
    };

    await this.movementRepository.save(movement);
  }

  /** PASO 1.7 — ver nota de idempotencia en record(): permite chequear si un movimiento con ese id ya se aplicó. */
  public async exists(movementId: string): Promise<boolean> {
    return this.movementRepository.exists(movementId);
  }

  public async getHistory(productId: string): Promise<InventoryMovement[]> {
    const history = await this.movementRepository.findAll();

    return history.filter(
      movement => movement.productId === productId
    );
  }

  /** Últimos movimientos de TODOS los productos, más reciente primero. */
  public async getRecentHistory(limit: number = 20): Promise<InventoryMovement[]> {
    const history = await this.movementRepository.findAll();

    return [...history]
      .sort((a, b) => b.date.getTime() - a.date.getTime())
      .slice(0, limit);
  }

  /**
   * TODOS los movimientos de TODOS los productos, sin límite — PASO 2.5
   * (Centro de Pérdidas). A diferencia de getRecentHistory (pensado para
   * un widget de "actividad reciente"), el Centro de Pérdidas necesita el
   * histórico completo para poder sumar pérdidas por día/semana/mes/año
   * sin perder movimientos viejos. Más reciente primero.
   */
  public async getAllMovements(): Promise<InventoryMovement[]> {
    const history = await this.movementRepository.findAll();
    return [...history].sort((a, b) => b.date.getTime() - a.date.getTime());
  }
}