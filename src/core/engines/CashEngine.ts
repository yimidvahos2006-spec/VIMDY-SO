import { CashMovement } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { ICashMovementRepository } from "../../infrastructure/di/repositories/CashMovementRepository";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { companyConfigStore } from "../store/companyConfigStore";
import { isBusinessToday } from "../utils/businessTime";
import { logError } from "../../infrastructure/logging/opsLogger";
import { cashRegisterStore } from "../store/cashRegisterStore";
import { roundMoney } from "../config/globalization";

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
export interface SalePaymentParams {
  readonly sale: {
    id: string;
    total: number;
    businessId?: string;
    branchId?: string;
    code?: string;
  };
  readonly paymentMethod: "CASH" | "CARD" | "TRANSFER" | "QR" | "MIXED";
  readonly total: number;
  readonly cashAmount: number;
  readonly received?: number;
  readonly change: number;
  readonly reference?: string;
  readonly shiftId?: string;
  readonly cashRegisterId?: string;
  readonly verificationSource?: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER";
}

export interface SalePaymentResult {
  readonly sale: {
    id: string;
    total: number;
    businessId?: string;
    branchId?: string;
    status: "PAID";
  };
  readonly incomeMovement: CashMovement;
  readonly changeMovement: CashMovement | null;
  readonly isAtomic: boolean;
}

export class CashEngine {
  constructor(
    private readonly repository: IRepository<CashMovement>
  ) {}

  private isAtomicRepository(repo: unknown): repo is ICashMovementRepository {
    return typeof (repo as ICashMovementRepository | null)?.saveAtomic === "function";
  }

  public isPaymentAtomicRepository(
    repo: unknown = this.repository
  ): repo is ICashMovementRepository {
    return (
      typeof (repo as ICashMovementRepository | null)?.saveAtomicPayment ===
      "function"
    );
  }

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
    id?: string,
    cashRegisterId?: string,
    verificationSource?: "CASH" | "EXTERNAL_TERMINAL" | "PROVIDER"
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

    const resolvedVerificationSource =
      verificationSource ?? (method === "CASH" ? "CASH" : method === "CARD" ? "EXTERNAL_TERMINAL" : undefined);

    if (method === "CASH" && resolvedVerificationSource !== "CASH") {
      throw new Error("INVALID_PAYMENT_VERIFICATION_SOURCE");
    }
    if (method === "CARD" && !["EXTERNAL_TERMINAL", "PROVIDER"].includes(resolvedVerificationSource ?? "")) {
      throw new Error("PAYMENT_VERIFICATION_REQUIRED");
    }
    if (["TRANSFER", "QR"].includes(method) && resolvedVerificationSource !== "PROVIDER") {
      throw new Error("PAYMENT_PROVIDER_VERIFICATION_REQUIRED");
    }
    if (method === "MIXED" && !["EXTERNAL_TERMINAL", "PROVIDER"].includes(resolvedVerificationSource ?? "")) {
      throw new Error("PAYMENT_VERIFICATION_REQUIRED");
    }

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
      branchId,
      cashRegisterId: cashRegisterId ?? cashRegisterStore.getSelectedId() ?? undefined,
      paymentVerificationSource: resolvedVerificationSource
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
    id?: string,
    cashRegisterId?: string
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
      branchId,
      cashRegisterId: cashRegisterId ?? cashRegisterStore.getSelectedId() ?? undefined
    };

    const savedMovement = await this.persistMovement(movement, movementId);

    vimdyCore.emit("payment", { action: "EXPENSE", movement: savedMovement });

    return savedMovement;
  }

  /**
   * Registra el cobro de una venta de forma atómica: persiste el ingreso
   * del total cobrado y, si hay efectivo físico involucrado, el egreso de
   * cambio en una sola transacción de servidor (RPC
   * `register_sale_payment_atomic`). Para fakes de test en memoria, delega
   * a `registerIncome` + `registerExpense` de forma no transaccional.
   *
   * Devuelve `{ sale: { ...status: "PAID" }, incomeMovement, changeMovement }`
   * para que SalesEngine persiga el estado PAID en el repositorio de ventas
   * de forma separada (ver checklist: "la verdad financiera vive en Caja").
   */
  public async registerSalePaymentAtomic(
    params: SalePaymentParams
  ): Promise<SalePaymentResult> {
    const { sale, paymentMethod, total, cashAmount, received, change, reference, shiftId, cashRegisterId, verificationSource } =
      params;

    if (received !== undefined && received < total) {
      throw new Error(
        `INVALID_RECEIVED: recibido (${received}) no puede ser menor al total (${total}).`
      );
    }

    if (change < 0) {
      throw new Error("INVALID_CHANGE: el cambio no puede ser negativo.");
    }

    if (cashAmount < 0) {
      throw new Error("INVALID_CASH_AMOUNT: cashAmount no puede ser negativo.");
    }

    if (
      paymentMethod === "MIXED" &&
      (cashAmount > total || cashAmount < 0)
    ) {
      throw new Error(
        "INVALID_CASH_AMOUNT: en MIXED, cashAmount debe estar entre 0 y total."
      );
    }

    if (["CARD", "TRANSFER", "QR"].includes(paymentMethod) && cashAmount !== 0) {
      throw new Error(
        "INVALID_CASH_AMOUNT: CARD/TRANSFER/QR deben tener cashAmount = 0."
      );
    }

    const businessId = sale.businessId ?? getCurrentBusinessId();
    const branchId = sale.branchId ?? getCurrentBranchId();

    if (!businessId) {
      throw new Error(
        "NO_BUSINESS_CONTEXT: no hay negocio activo para cobrar la venta."
      );
    }
    if (!branchId) {
      throw new Error(
        "NO_BRANCH_CONTEXT: no hay sucursal activa para cobrar la venta."
      );
    }

    const paymentId = `sale-payment-${sale.id}`;
    const isAtomic = this.isPaymentAtomicRepository(this.repository);
    const changeId = change > 0 ? `sale-change-${sale.id}` : null;

    let income: CashMovement;
    let changeMovement: CashMovement | null = null;

    if (isAtomic) {
      const result = await this.repository.saveAtomicPayment({
        saleId: sale.id,
        businessId,
        branchId,
        cashRegisterId: cashRegisterId ?? cashRegisterStore.getSelectedId() ?? undefined,
        shiftId,
        paymentId,
        changeId,
        paymentMethod,
        total,
        cashAmount,
        received: received ?? total,
        change,
        reference,
        verificationSource,
      });

      income = result.income;
      changeMovement = result.change;
    } else {
    const saleIdentifier = sale.code ?? sale.id;
    const incomeDescription = reference
      ? `Venta ${saleIdentifier} - ${reference}`
      : `Venta ${saleIdentifier}`;

      income = await this.registerIncome(
        total,
        incomeDescription,
        paymentMethod as CashMovement["paymentMethod"],
        cashAmount,
        paymentId,
        cashRegisterId,
        verificationSource
      );

      if (change > 0) {
        changeMovement = await this.registerExpense(
          change,
          `Cambio venta ${sale.id}`,
          changeId ?? undefined
        );
      }
    }

    vimdyCore.emit("payment", {
      action: "SALE_PAYMENT",
      movement: income,
      changeMovement,
      saleId: sale.id,
    });

    return {
      sale: {
        id: sale.id,
        total: sale.total,
        businessId,
        branchId,
        status: "PAID",
      },
      incomeMovement: income,
      changeMovement,
      isAtomic,
    };
  }
  public async getMovementsForShift(shiftId: string, openedAt?: Date, closedAt: Date = new Date()): Promise<CashMovement[]> {
    if (!shiftId) throw new Error("SHIFT_ID_REQUIRED");
    const movements = await this.getAllMovements();
    if (this.isAtomicRepository(this.repository)) {
      return movements.filter((movement) => movement.shiftId === shiftId);
    }

    // SOLO para repositorios InMemory/test: las implementaciones antiguas no
    // reciben el shiftId porque no pasan por la RPC server-side. Producción
    // nunca usa este camino; allí el turno es obligatorio en DB.
    return movements.filter((movement) => {
      if (movement.shiftId === shiftId) return true;
      if (movement.shiftId || !openedAt) return false;
      const date = new Date(movement.date);
      return date >= openedAt && date <= closedAt;
    });
  }

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
    const currency = companyConfigStore.get().currency;

    return roundMoney(
      movements.reduce((balance, movement) => {
        return movement.type === "IN"
          ? balance + movement.amount
          : balance - movement.amount;
      }, 0),
      currency
    );
  }

  /**
    * Saldo generado durante el día actual.
    */
  public async getTodayBalance(): Promise<number> {
    const movements = await this.getTodayMovements();
    const currency = companyConfigStore.get().currency;

    return roundMoney(
      movements.reduce((balance, movement) => {
        return movement.type === "IN"
          ? balance + movement.amount
          : balance - movement.amount;
      }, 0),
      currency
    );
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
}