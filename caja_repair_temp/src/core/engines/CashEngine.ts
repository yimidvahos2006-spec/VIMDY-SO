import { CashMovement, Sale } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { ICashMovementRepository, AtomicSalePaymentResult } from "../../infrastructure/di/repositories/CashMovementRepository";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { companyConfigStore } from "../store/companyConfigStore";
import { isBusinessToday } from "../utils/businessTime";
import { logError } from "../../infrastructure/logging/opsLogger";

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

  private isAtomicRepository(repo: unknown): repo is ICashMovementRepository {
    return typeof (repo as ICashMovementRepository | null)?.saveAtomic === "function";
  }

  /**
    * Persiste un movimiento de caja de forma atómica cuando el repositorio lo
    * soporta (CashMovementRepository real → RPC register_movement_atomic), o
    * delegando al save() genérico para fakes de test en memoria. Captura y
    * loguea cualquier fallo de persistencia para detección proactiva de caja.
    */
  private async persistMovement(
    movement: CashMovement,
    atomicId?: string
  ): Promise<CashMovement> {
    try {
      if (this.isAtomicRepository(this.repository)) {
        return await this.repository.saveAtomic(movement, atomicId);
      }
      await this.repository.save(movement);
      return movement;
    } catch (err: unknown) {
      logError(err, {
        category: "payment",
        context: {
          movementId: movement.id,
          movementType: movement.type,
          amount: movement.amount,
          atomicId: atomicId ?? null,
        },
      });
      throw err;
    }
  }


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
    * provee, debe ser determinístico (ej. `sale-payment-<saleId>`).
    * La inserción usa `register_movement_atomic()` (RPC de servidor) con
    * ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING,
    * así que si el mismo cobro se reintenta (datáfono que se cae, doble click
    * que escapó al lock de la UI, reintento de red) con el mismo id, el RPC
    * IGNORA el conflicto y devuelve exactamente el movimiento original — el
    * dinero en caja no se duplica. Quien no pase `id` (ingresos manuales, etc.)
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

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();

    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay negocio activo para registrar ingreso de caja.");
    }
    if (!branchId) {
      throw new Error("NO_BRANCH_CONTEXT: no hay sucursal activa para registrar ingreso de caja.");
    }

    const method = paymentMethod ?? "CASH";

    if (!["CASH", "CARD", "TRANSFER", "QR", "MIXED"].includes(method)) {
      throw new Error(`INVALID_PAYMENT_METHOD: "${method}" no es un método de pago permitido.`);
    }

    if (method === "CASH" && cashAmount !== undefined && cashAmount !== amount) {
      throw new Error("INVALID_CASH_AMOUNT: un ingreso CASH debe tener cashAmount igual a amount.");
    }

    const resolvedCashAmount =
      cashAmount ?? (method === "CASH" ? amount : method === "MIXED" ? 0 : 0);

    if (method === "MIXED" && (resolvedCashAmount < 0 || resolvedCashAmount > amount)) {
      throw new Error("INVALID_CASH_AMOUNT: cashAmount no puede ser negativo ni superar amount en MIXED.");
    }

    if (["CARD", "TRANSFER", "QR"].includes(method) && resolvedCashAmount !== 0) {
      throw new Error("INVALID_CASH_AMOUNT: CARD/TRANSFER/QR deben tener cashAmount = 0.");
    }

    const movementId = id ?? crypto.randomUUID();

    const movement: CashMovement = {
      id: movementId,
      amount,
      type: "IN",
      description,
      date: new Date(),
      paymentMethod: method,
      cashAmount: resolvedCashAmount,
      businessId,
      branchId
    };

    const savedMovement = await this.persistMovement(movement, movementId);

    vimdyCore.emit("payment", { action: "INCOME", movement: savedMovement });

    return savedMovement;
  }

  /**
    * Registra un egreso de dinero (reembolso, gasto, retiro).
    * Los egresos siempre salen del efectivo físico del cajón.
    *
    * IDEMPOTENCIA (checklist crítico #4): `id` es opcional y, cuando se
    * provee, debe ser determinístico (ej. `sale-change-<saleId>`).
    * La inserción usa `register_movement_atomic()` (RPC de servidor) con
    * ON CONFLICT (business_id, branch_id, idempotency_key) DO NOTHING,
    * así que si el mismo egreso se reintenta con el mismo id, el RPC IGNORA
    * el conflicto y devuelve exactamente el movimiento original — el dinero
    * en caja no se duplica.
    */
  public async registerExpense(
    amount: number,
    description: string,
    id?: string
  ): Promise<CashMovement> {
    if (amount <= 0) {
      throw new Error("INVALID_AMOUNT");
    }

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();

    if (!businessId) {
      throw new Error("NO_BUSINESS_CONTEXT: no hay negocio activo para registrar egreso de caja.");
    }
    if (!branchId) {
      throw new Error("NO_BRANCH_CONTEXT: no hay sucursal activa para registrar egreso de caja.");
    }

    const movementId = id ?? crypto.randomUUID();

    const movement: CashMovement = {
      id: movementId,
      amount,
      type: "OUT",
      description,
      date: new Date(),
      paymentMethod: "CASH",
      cashAmount: amount,
      businessId,
      branchId
    };

    const savedMovement = await this.persistMovement(movement, movementId);

    vimdyCore.emit("payment", { action: "EXPENSE", movement: savedMovement });

    return savedMovement;
  }

  /**
   * Lista todos los movimientos registrados.
   */
  public async getAllMovements(): Promise<CashMovement[]> {
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    const movements = await this.repository.findAll();

    return movements.filter(movement => {
      if (movement.businessId && movement.businessId !== businessId) return false;
      if (movement.branchId && movement.branchId !== branchId) return false;
      return true;
    });
  }

  /**
   * Movimientos del día actual.
   */
  public async getTodayMovements(): Promise<CashMovement[]> {
    const tz = companyConfigStore.get().timezone || "America/Bogota";
    const now = new Date();
    const movements = await this.getAllMovements();

    return movements.filter(
      movement => isBusinessToday(new Date(movement.date), now, tz)
    );
  }

  /**
   * Saldo total de caja (ingresos - egresos).
   */
  public async getBalance(): Promise<number> {
    const movements = await this.getAllMovements();

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
   * Usa timezone del negocio, no del dispositivo.
   */
  public async getMovementsBetween(
    start: Date,
    end: Date = new Date()
  ): Promise<CashMovement[]> {
    const movements = await this.getAllMovements();

    return movements.filter(movement => {
      const movementDate = new Date(movement.date);
      return movementDate >= start && movementDate <= end;
    });
  }

  /**
   * Confirma un cobro de venta como una sola operación financiera server-side.
   * La RPC bloquea venta + turno, registra ingreso/cambio y marca PAID dentro
   * de la misma transacción PostgreSQL. Nunca se usa como fallback genérico.
   */
  public async registerSalePaymentAtomic(input: {
    sale: Sale;
    paymentMethod: CashMovement["paymentMethod"];
    total: number;
    cashAmount: number;
    received: number;
    change: number;
    reference?: string;
    paymentId?: string;
    changeId?: string;
  }): Promise<AtomicSalePaymentResult> {
    if (!this.isAtomicRepository(this.repository)) {
      throw new Error("CAJA_ATOMIC_PAYMENT_REPOSITORY_REQUIRED");
    }
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      throw new Error("NO_CASH_CONTEXT: business/branch requerido para cobrar.");
    }
    if (input.sale.businessId && input.sale.businessId !== businessId) {
      throw new Error("CAJA_SALE_BUSINESS_MISMATCH");
    }
    if (input.sale.branchId && input.sale.branchId !== branchId) {
      throw new Error("CAJA_SALE_BRANCH_MISMATCH");
    }
    if (!Number.isFinite(input.total) || input.total <= 0) throw new Error("INVALID_AMOUNT");
    if (!Number.isFinite(input.cashAmount) || input.cashAmount < 0) throw new Error("INVALID_CASH_AMOUNT");
    if (!Number.isFinite(input.received) || input.received < input.total) throw new Error("INSUFFICIENT_PAYMENT");
    if (!Number.isFinite(input.change) || input.change < 0) throw new Error("INVALID_CHANGE");

    return await this.repository.registerSalePaymentAtomic({
      saleId: input.sale.id,
      businessId,
      branchId,
      paymentId: input.paymentId ?? `sale-payment-${input.sale.id}`,
      changeId: input.change > 0 ? (input.changeId ?? `sale-change-${input.sale.id}`) : null,
      paymentMethod: input.paymentMethod,
      total: input.total,
      cashAmount: input.cashAmount,
      received: input.received,
      change: input.change,
      reference: input.reference,
    });
  }

}