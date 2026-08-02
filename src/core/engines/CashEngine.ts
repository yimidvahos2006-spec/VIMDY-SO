import { CashMovement } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { vimdyCore } from "../VimdyCore";

/**
 * CashEngine
 * ---------------------------------------------------------------------------
 * Controla los movimientos de caja (ingresos y egresos) del negocio.
 * SalesEngine se apoya en este motor para reflejar en caja el dinero
 * generado por cada venta, así como las devoluciones y cancelaciones.
 *
 * FASE 5, PASO 1 (cierre) — Gerente Inteligente: un ingreso/egreso manual
 * de caja (no ligado a una venta) antes no avisaba a nadie. Ahora emite
 * "payment" en vimdyCore — el mismo evento que ya traduce realtimeSync.ts
 * para cash_movements — para que useDashboardSync reconcilie y el Gerente
 * Inteligente se actualice solo, sin recargar la app.
 */
export class CashEngine {
  constructor(
    private readonly repository: IRepository<CashMovement>
  ) {}

  /**
   * Registra un ingreso de dinero (venta, abono, ingreso manual, etc).
   *
   * `paymentMethod` determina cuánto de este ingreso es efectivo físico:
   * - CASH (o sin especificar, ej. un ingreso manual de caja) → todo es efectivo.
   * - CARD / TRANSFER / QR → nada es efectivo físico (queda registrado como
   *   venta, pero no debe contarse en el arqueo del cajón).
   * - MIXED → solo la porción indicada en `cashAmount` es efectivo.
   *
   * IDEMPOTENCIA (checklist crítico #4): `id` es opcional y, cuando se
   * provee, debe ser determinístico (ej. `sale-payment-<saleId>`) en vez de
   * aleatorio. save() en SupabaseRepository hace `upsert` por id, así que
   * si el mismo cobro se reintenta (datáfono que se cae, doble click que
   * escapó al lock de la UI, reintento de red) con el mismo id, esta
   * llamada PISA el mismo movimiento en vez de crear uno nuevo — el dinero
   * en caja no se duplica. Quien no pase `id` (ingresos manuales, etc.)
   * conserva el comportamiento anterior de un id aleatorio por movimiento.
   */
  public async registerIncome(
    amount: number,
    description: string,
    paymentMethod?: CashMovement["paymentMethod"],
    cashAmount?: number,
    id?: string
  ): Promise<CashMovement> {
    if (amount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const method = paymentMethod ?? "CASH";
    const resolvedCashAmount =
      cashAmount ?? (method === "CASH" ? amount : method === "MIXED" ? 0 : 0);

    const movement: CashMovement = {
      id: id ?? crypto.randomUUID(),
      amount,
      type: "IN",
      description,
      date: new Date(),
      paymentMethod: method,
      cashAmount: resolvedCashAmount
    };

    await this.repository.save(movement);
    vimdyCore.emit("payment", { action: "INCOME", movement });

    return movement;
  }

  /**
   * Registra un egreso de dinero (reembolso, gasto, retiro).
   * Los egresos siempre salen del efectivo físico del cajón.
   */
  public async registerExpense(
    amount: number,
    description: string
  ): Promise<CashMovement> {
    if (amount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const movement: CashMovement = {
      id: crypto.randomUUID(),
      amount,
      type: "OUT",
      description,
      date: new Date(),
      paymentMethod: "CASH",
      cashAmount: amount
    };

    await this.repository.save(movement);
    vimdyCore.emit("payment", { action: "EXPENSE", movement });

    return movement;
  }

  /**
   * Lista todos los movimientos registrados.
   */
  public async getAllMovements(): Promise<CashMovement[]> {
    return await this.repository.findAll();
  }

  /**
   * Movimientos del día actual.
   */
  public async getTodayMovements(): Promise<CashMovement[]> {
    const today = new Date().toDateString();
    const movements = await this.repository.findAll();

    return movements.filter(
      movement => movement.date.toDateString() === today
    );
  }

  /**
   * Saldo total de caja (ingresos - egresos).
   */
  public async getBalance(): Promise<number> {
    const movements = await this.repository.findAll();

    return movements.reduce((balance, movement) => {
      return movement.type === "IN"
        ? balance + movement.amount
        : balance - movement.amount;
    }, 0);
  }

  /**
   * Saldo generado durante el día actual.
   */
  public async getTodayBalance(): Promise<number> {
    const movements = await this.getTodayMovements();

    return movements.reduce((balance, movement) => {
      return movement.type === "IN"
        ? balance + movement.amount
        : balance - movement.amount;
    }, 0);
  }

  /**
   * Movimientos registrados entre dos fechas (inclusive).
   * Si no se indica `end`, se asume "hasta ahora". Usado por ShiftEngine
   * para calcular lo esperado en caja durante un turno específico.
   */
  public async getMovementsBetween(
    start: Date,
    end: Date = new Date()
  ): Promise<CashMovement[]> {
    const movements = await this.repository.findAll();

    return movements.filter(
      movement => movement.date >= start && movement.date <= end
    );
  }
}