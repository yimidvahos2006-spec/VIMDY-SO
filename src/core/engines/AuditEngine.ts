import { AuditLog } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";

/* ===========================================================================
   AuditEngine
   ---------------------------------------------------------------------------
   Registro de auditoría de VIMDY: quién hizo qué, cuándo, y sobre qué
   entidad. Es de solo-anexado (append-only) — nada se edita ni se borra
   una vez registrado, porque el propósito de una auditoría es justamente
   que nada se pierda ni se pueda alterar después de los hechos.

   Cualquier motor del sistema puede (y debe) llamar a `log()` cuando
   ejecuta una acción sensible: abrir/cerrar caja, eliminar una venta,
   cambiar un precio, crear un usuario, modificar inventario, etc.
=========================================================================== */
export class AuditEngine {
  constructor(private readonly repository: IRepository<AuditLog>) {}

  public async log(
    actorId: string,
    action: string,
    module: string,
    description: string,
    entityId?: string
  ): Promise<AuditLog> {
    const entry: AuditLog = {
      id: crypto.randomUUID(),
      actorId,
      action,
      module,
      entityId,
      description,
      date: new Date()
    };

    await this.repository.save(entry);
    return entry;
  }

  public async getAll(): Promise<AuditLog[]> {
    const logs = await this.repository.findAll();
    return logs.sort((a, b) => b.date.getTime() - a.date.getTime());
  }

  public async getByUser(actorId: string): Promise<AuditLog[]> {
    const logs = await this.getAll();
    return logs.filter(log => log.actorId === actorId);
  }

  public async getByModule(module: string): Promise<AuditLog[]> {
    const logs = await this.getAll();
    return logs.filter(log => log.module === module);
  }

  /**
   * BLOQUEANTE #5 (auditoría Fase 2) — el Copiloto necesita saber qué
   * empleado cancela/reembolsa más ventas. En vez de agregar un campo
   * nuevo a Sale (que solo cubriría reembolsos parciales, ver
   * SaleRefundRecord.actorId), se usa el registro de auditoría, que ya
   * captura actorId de forma confiable para SALE_CANCELLED, SALE_REFUNDED
   * y SALE_PARTIALLY_REFUNDED — es la única fuente que cubre los tres
   * casos con el mismo dato.
   */
  public async getByActions(actions: string[]): Promise<AuditLog[]> {
    const logs = await this.getAll();
    return logs.filter(log => actions.includes(log.action));
  }

  public async getByEntity(entityId: string): Promise<AuditLog[]> {
    const logs = await this.getAll();
    return logs.filter(log => log.entityId === entityId);
  }

  public async getRecent(limit: number = 50): Promise<AuditLog[]> {
    const logs = await this.getAll();
    return logs.slice(0, limit);
  }
}