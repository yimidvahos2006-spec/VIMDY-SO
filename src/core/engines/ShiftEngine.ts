import { Shift } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { CashEngine } from "./CashEngine";
import type { IShiftRepository } from "../../infrastructure/di/repositories/ShiftRepository";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { CashRegisterEngine } from "./CashRegisterEngine";
import { cashRegisterStore } from "../store/cashRegisterStore";
import { activeShiftStore } from "../store/activeShiftStore";

/* ===========================================================================
   ShiftEngine
   ---------------------------------------------------------------------------
   Controla los turnos de caja de VIMDY OS: apertura con fondo inicial,
   arqueo en vivo mientras el turno sigue abierto, y cierre con comparación
   entre lo que el sistema espera (fondo + ingresos - egresos) y lo que el
   cajero cuenta físicamente.

   Regla de negocio central: una caja física solo puede tener UN turno abierto
   a la vez. Distintas cajas físicas de la misma sucursal pueden operar en paralelo;
   cada movimiento financiero queda ligado a su caja y a su turno propietario.

   Conexiones directas (obligatorias):
     - IRepository<Shift> → persistencia de los turnos.
     - CashEngine          → fuente de verdad de los movimientos de caja;
                              ShiftEngine nunca escribe movimientos, solo
                              los consulta por `shiftId` para calcular
                              el arqueo sin mezclar turnos.
     - vimdyCore            → emisión de eventos ("shift") para el resto de
                              VIMDY (Dashboard, Alertas, Auditoría, etc).

   Conexiones PROHIBIDAS (por diseño):
     - SalesEngine, PaymentEngine, TableEngine
       ShiftEngine no participa del cobro de ventas. Solo mide lo que ya
       pasó por CashEngine, no genera movimientos por sí mismo.
=========================================================================== */
export class ShiftEngine {
  constructor(
    private readonly repository: IRepository<Shift>,
    private readonly cash: CashEngine,
    private readonly cashRegisters?: CashRegisterEngine
  ) {}

  /**
   * Detecta si el repositorio de turnos expone el método `closeAtomic()`,
   * que delega en la RPC `close_shift_atomic()` de servidor (producción).
   * Los repositorios de test/in-memory no la implementan y usan el fallback.
   */
  private isAtomicShiftRepository(
    repo: unknown
  ): repo is IShiftRepository {
    return typeof (repo as IShiftRepository | null)?.closeAtomic === "function";
  }

  /**
   * Abre un nuevo turno de caja para un cajero.
   * Falla si ya existe un turno abierto en la misma caja física.
   * Distintas cajas físicas de la misma sucursal pueden tener turnos abiertos en paralelo.
   *
   * La exclusión real la garantiza la restricción única de servidor por
   * (business, branch, cash_register). Si dos dispositivos intentan abrir
   * la misma caja simultáneamente, una operación gana y la otra falla de forma
   * segura con el conflicto de turno ya abierto.
   */
  public async openShift(
    cashierId: string,
    openingAmount: number,
    notes?: string,
    cashRegisterId?: string
  ): Promise<Shift> {
    if (openingAmount < 0) throw new Error("INVALID_AMOUNT: el fondo inicial no puede ser negativo.");
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId) throw new Error("NO_BUSINESS_CONTEXT");
    if (!branchId) throw new Error("NO_BRANCH_CONTEXT");

    let resolvedRegisterId = cashRegisterId ?? cashRegisterStore.getSelectedId() ?? undefined;
    if (this.cashRegisters) {
      const registers = await this.cashRegisters.listActive(businessId, branchId);
      if (registers.length === 0) {
        const created = await this.cashRegisters.ensureDefault(businessId, branchId);
        registers.push(created);
      }
      resolvedRegisterId = resolvedRegisterId && registers.some((r) => r.id === resolvedRegisterId)
        ? resolvedRegisterId
        : this.cashRegisters.resolveSelectedId(businessId, branchId, registers);
    }

    const shiftId = crypto.randomUUID();

    if (this.isAtomicShiftRepository(this.repository) && resolvedRegisterId) {
      const opened = await this.repository.openAtomic(
        shiftId, businessId, branchId, resolvedRegisterId, cashierId, openingAmount, notes
      );
      cashRegisterStore.setSelected(businessId, branchId, resolvedRegisterId);
      activeShiftStore.set({ businessId, branchId, cashierId, shiftId: opened.id, cashRegisterId: resolvedRegisterId });
      vimdyCore.emit("shift", { action: "OPENED", shift: opened });
      return opened;
    }

    const current = await this.getCurrentShift(cashierId, resolvedRegisterId);
    if (current) throw new Error(`SHIFT_ALREADY_OPEN: ya existe un turno abierto (id "${current.id}").`);

    const shift: Shift = {
      id: shiftId, cashierId, status: "OPEN", openingAmount, openedAt: new Date(),
      openingNotes: notes, businessId, branchId, cashRegisterId: resolvedRegisterId
    };
    await this.repository.save(shift);
    if (resolvedRegisterId) {
      activeShiftStore.set({ businessId, branchId, cashierId, shiftId: shift.id, cashRegisterId: resolvedRegisterId });
    }
    vimdyCore.emit("shift", { action: "OPENED", shift });
    return shift;
  }

  /**
   * Devuelve el turno actualmente abierto, si existe.
   * Si se pasa `cashierId`, solo devuelve el turno abierto si pertenece
   * a ese cajero.
   */
  public async getCurrentShift(cashierId?: string, cashRegisterId?: string): Promise<Shift | null> {
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) return null;

    const selected = cashRegisterId ?? cashRegisterStore.getSelectedId() ?? undefined;
    const shifts = await this.repository.findAll();
    const opens = shifts.filter((shift) => {
      if (shift.status !== "OPEN") return false;
      // En producción, el turno debe pertenecer exactamente al contexto
      // actual. Los datos legacy sin business/branch ya no se adoptan.
      if (shift.businessId !== businessId) return false;
      if (shift.branchId !== branchId) return false;
      // Un turno enterprise sin caja física es inválido para operación.
      if (!shift.cashRegisterId) return false;
      if (cashierId && shift.cashierId !== cashierId) return false;
      if (selected && shift.cashRegisterId !== selected) return false;
      return true;
    });

    if (selected) {
      const result = opens.find((shift) => shift.cashRegisterId === selected) ?? null;
      if (result?.cashRegisterId && cashierId) {
        activeShiftStore.set({
          businessId,
          branchId,
          cashierId,
          shiftId: result.id,
          cashRegisterId: result.cashRegisterId,
        });
      }
      return result;
    }

    if (opens.length === 1) {
      const result = opens[0];
      if (cashierId && result.cashRegisterId) {
        cashRegisterStore.setSelected(businessId, branchId, result.cashRegisterId);
        activeShiftStore.set({
          businessId,
          branchId,
          cashierId,
          shiftId: result.id,
          cashRegisterId: result.cashRegisterId,
        });
      }
      return result;
    }

    if (opens.length === 0) return null;
    throw new Error("CASH_REGISTER_SELECTION_REQUIRED: hay varios turnos/cajas abiertos; seleccione la caja física.");
  }

  /**
   * Arqueo en vivo de un turno (sin cerrarlo). Útil para un "corte X":
   * el cajero puede ver cuánto debería haber en caja en cualquier momento
   * mientras sigue trabajando.
   */
  public async getShiftSummary(shiftId: string): Promise<{
    shift: Shift;
    totalIncome: number;
    totalExpense: number;
    totalCashIncome: number;
    incomeByMethod: Record<string, number>;
    expectedAmount: number;
  }> {
    const shift = await this.repository.findById(shiftId);

    if (!shift) {
      throw new Error("SHIFT_NOT_FOUND");
    }

    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) {
      throw new Error("NO_BUSINESS_CONTEXT");
    }
    if (shift.businessId !== businessId || shift.branchId !== branchId) {
      throw new Error("SHIFT_BUSINESS_BRANCH_CONTEXT_MISMATCH");
    }
    const selectedRegisterId = cashRegisterStore.getSelectedId();
    if (!shift.cashRegisterId) {
      throw new Error("CAJA_CASH_REGISTER_REQUIRED_FOR_CLOSE");
    }
    if (selectedRegisterId && shift.cashRegisterId !== selectedRegisterId) {
      throw new Error("SHIFT_REGISTER_CONTEXT_MISMATCH");
    }

    const movements = await this.cash.getMovementsForShift(
      shiftId,
      shift.openedAt,
      shift.closedAt ?? new Date()
    );

    const incomeMovements = movements.filter(movement => movement.type === "IN");

    // Total de ventas sin importar el medio de pago (informativo, no es lo
    // que debe estar físicamente en el cajón).
    const totalIncome = incomeMovements.reduce((sum, movement) => sum + movement.amount, 0);

    // Solo la porción de cada ingreso que es efectivo físico real. Esta es
    // la cifra que sí entra en el arqueo — tarjeta/transferencia/QR no
    // pasan por el cajón, así que no se cuentan aquí.
    const totalCashIncome = incomeMovements.reduce(
      (sum, movement) => sum + (movement.cashAmount ?? (movement.paymentMethod === "CASH" || !movement.paymentMethod ? movement.amount : 0)),
      0
    );

    // Desglose por medio de pago, para mostrarle al cajero cuánto entró
    // por cada canal aunque no cuente para el efectivo del cajón.
    const incomeByMethod: Record<string, number> = {};
    for (const movement of incomeMovements) {
      const method = movement.paymentMethod ?? "CASH";
      incomeByMethod[method] = (incomeByMethod[method] ?? 0) + movement.amount;
    }

    // Los egresos (retiros, gastos) siempre salen del efectivo físico.
    const totalExpense = movements
      .filter(movement => movement.type === "OUT")
      .reduce((sum, movement) => sum + movement.amount, 0);

    const expectedAmount = shift.openingAmount + totalCashIncome - totalExpense;

    return { shift, totalIncome, totalExpense, totalCashIncome, incomeByMethod, expectedAmount };
  }

  /**
    * Cierra un turno: calcula lo esperado según CashEngine, lo compara
    * contra lo contado físicamente por el cajero, y deja el turno en
    * estado CLOSED con el detalle del arqueo (faltante/sobrante incluido).
    *
    * En producción, el cierre se delega a la RPC `close_shift_atomic()`
    * (ShiftRepository.closeAtomic), que calcula el arqueo y aplica el cambio
    * de estado en una sola transacción atómica del servidor.
    *
    * El fallback (cálculo + update en cliente) SOLO se usa con repositorios
    * de test/in-memory que no implementan `closeAtomic`. Nunca debe usarse
    * con ShiftRepository de Supabase en producción.
    */
  public async closeShift(
    shiftId: string,
    countedAmount: number,
    notes?: string
  ): Promise<Shift> {
    if (countedAmount < 0) {
      throw new Error(
        "INVALID_AMOUNT: el monto contado no puede ser negativo."
      );
    }

    // Producción real: cierre atómico en servidor.
    if (this.isAtomicShiftRepository(this.repository)) {
      const closedShift = await this.repository.closeAtomic(
        shiftId,
        countedAmount,
        notes
      );

      vimdyCore.emit("shift", {
        action: "CLOSED",
        shift: closedShift,
      });

      return closedShift;
    }

    // Fallback SOLO para repositorios de test/in-memory.
    // Nunca debe utilizarse con ShiftRepository de Supabase.
    const {
      shift,
      totalIncome,
      totalExpense,
      totalCashIncome,
      incomeByMethod,
      expectedAmount,
    } = await this.getShiftSummary(shiftId);

    if (shift.status === "CLOSED") {
      throw new Error(
        "SHIFT_ALREADY_CLOSED: este turno ya fue cerrado."
      );
    }

    const difference = countedAmount - expectedAmount;

    const closedShift: Shift = {
      ...shift,
      status: "CLOSED",
      totalIncome,
      totalExpense,
      totalCashIncome,
      incomeByMethod,
      expectedAmount,
      countedAmount,
      difference,
      closedAt: new Date(),
      closingNotes: notes,
    };

    await this.repository.update(closedShift);

    vimdyCore.emit("shift", {
      action: "CLOSED",
      shift: closedShift,
    });

    return closedShift;
  }

  /**
   * Historial de turnos cerrados, más reciente primero.
   * Si se pasa `cashierId`, filtra solo los turnos de ese cajero.
   */
  public async getShiftHistory(cashierId?: string): Promise<Shift[]> {
    const businessId = getCurrentBusinessId();
    const branchId = getCurrentBranchId();
    if (!businessId || !branchId) return [];

    const shifts = await this.repository.findAll();

    return shifts
      .filter((shift) => shift.status === "CLOSED")
      .filter((shift) => shift.businessId === businessId && shift.branchId === branchId)
      .filter((shift) => !cashierId || shift.cashierId === cashierId)
      .sort((a, b) => {
        const aTime = a.closedAt?.getTime() ?? 0;
        const bTime = b.closedAt?.getTime() ?? 0;
        return bTime - aTime;
      });
  }

}