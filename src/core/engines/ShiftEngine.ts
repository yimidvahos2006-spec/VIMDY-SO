import { Shift } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";
import { CashEngine } from "./CashEngine";
import type { IShiftRepository } from "../../infrastructure/di/repositories/ShiftRepository";
import { vimdyCore } from "../VimdyCore";
import { getCurrentBusinessId, getCurrentBranchId } from "../../infrastructure/supabase/supabaseClient";
import { CashRegisterEngine } from "./CashRegisterEngine";
import { cashRegisterStore } from "../store/cashRegisterStore";
import { activeShiftStore } from "../store/activeShiftStore";
import { companyConfigStore } from "../store/companyConfigStore";
import { roundMoney } from "../config/globalization";
import { computeShiftCashTotals, type ShiftCashTotals } from "../caja/cashExpectedRule";

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
   * Detecta si el repositorio de turnos expone el método `closeAtomic()`
   * (repositorio real de Supabase). En producción ese método NO cierra: lanza
   * SHIFT_CLOSE_REQUIRES_CASH_COUNT porque el cierre exige arqueo y se hace con
   * `enterpriseCashService.closeShiftWithCashCount()`.
   * Los repositorios de test/in-memory no lo implementan y usan el fallback.
   */
  private isAtomicShiftRepository(
    repo: unknown
  ): repo is IShiftRepository {
    const candidate = repo as Partial<IShiftRepository> | null;
    return (
      typeof candidate?.openAtomic === "function" &&
      typeof candidate?.closeAtomic === "function"
    );
  }

  private hasFindByDataField(
    repo: unknown
  ): repo is { findByDataField(field: string, value: string): Promise<Shift[]> } {
    return typeof (repo as { findByDataField?: unknown } | null)?.findByDataField === "function";
  }

  private isAtomicShiftOpenRepository(
    repo: unknown
  ): repo is IShiftRepository {
    return typeof (repo as Partial<IShiftRepository> | null)?.openAtomic === "function";
  }

  private hasServerCashSummary(
    repo: unknown
  ): repo is { getCashSummary(shiftId: string): Promise<ShiftCashTotals> } {
    return typeof (repo as { getCashSummary?: unknown } | null)?.getCashSummary === "function";
  }

  private isAtomicShiftCloseRepository(
    repo: unknown
  ): repo is IShiftRepository {
    return typeof (repo as Partial<IShiftRepository> | null)?.closeAtomic === "function";
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
    if (!Number.isFinite(openingAmount) || openingAmount < 0) {
      throw new Error("INVALID_AMOUNT: el fondo inicial debe ser un número finito y no negativo.");
    }
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

    if (this.isAtomicShiftOpenRepository(this.repository) && resolvedRegisterId) {
      const opened = await this.repository.openAtomic(
        shiftId, businessId, branchId, resolvedRegisterId, cashierId, openingAmount, notes
      );
      cashRegisterStore.setSelected(businessId, branchId, resolvedRegisterId);
      activeShiftStore.set({ businessId, branchId, cashierId, shiftId: opened.id, cashRegisterId: resolvedRegisterId });
      vimdyCore.emit("shift", { action: "OPENED", shift: opened });
      return opened;
    }

    const current = await this.getCurrentShift(undefined, resolvedRegisterId);
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
    // Camino rápido (producción): el servidor devuelve SOLO los turnos OPEN en
    // vez de todo el historial de turnos. El filtro de abajo es el mismo de
    // siempre; si el repositorio no lo soporta (tests InMemory) se usa findAll().
    const shifts = this.hasFindByDataField(this.repository)
      ? await this.repository.findByDataField("status", "OPEN")
      : await this.repository.findAll();
    const opens = shifts.filter((shift) => {
      if (shift.status !== "OPEN") return false;
      // En producción, el turno debe pertenecer exactamente al contexto
      // actual. Los datos legacy sin business/branch ya no se adoptan.
      if (shift.businessId !== businessId) return false;
      if (shift.branchId !== branchId) return false;
      if (this.cashRegisters && !shift.cashRegisterId) return false;
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
    totalCashExpense: number;
    incomeByMethod: Record<string, number>;
    expectedAmount: number;
    /** "server": cifra calculada por el servidor (la misma del cierre). "local": espejo local de la misma regla. */
    source: "server" | "local";
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
    if (this.cashRegisters && !shift.cashRegisterId) {
      throw new Error("CAJA_CASH_REGISTER_REQUIRED_FOR_CLOSE");
    }
    if (selectedRegisterId && shift.cashRegisterId !== selectedRegisterId) {
      throw new Error("SHIFT_REGISTER_CONTEXT_MISMATCH");
    }

    const currency = companyConfigStore.get().currency;
    const round = (value: number): number => roundMoney(value, currency);

    // REGLA ÚNICA: la cifra la calcula el SERVIDOR, con la misma consulta con la
    // que se graba el cierre histórico. Sin conexión (o con repositorios de
    // prueba) se usa el espejo local de esa misma regla (cashExpectedRule.ts).
    let totals: ShiftCashTotals | null = null;
    let source: "server" | "local" = "local";

    if (this.hasServerCashSummary(this.repository)) {
      try {
        totals = await this.repository.getCashSummary(shiftId);
        source = "server";
      } catch (error) {
        console.warn(
          "[ShiftEngine] No se pudo leer el resumen del servidor; se usa el cálculo local de la misma regla.",
          error
        );
      }
    }

    if (!totals) {
      const movements = await this.cash.getMovementsForShift(
        shiftId,
        shift.openedAt,
        shift.closedAt ?? new Date()
      );
      totals = computeShiftCashTotals(shift.openingAmount, movements, round);
    }

    return {
      shift,
      totalIncome: totals.totalIncome,
      totalExpense: totals.totalExpense,
      totalCashIncome: totals.totalCashIncome,
      totalCashExpense: totals.totalCashExpense,
      incomeByMethod: totals.incomeByMethod,
      expectedAmount: totals.expectedAmount,
      source,
    };
  }

  /**
    * Cierra un turno: calcula lo esperado según CashEngine, lo compara
    * contra lo contado físicamente por el cajero, y deja el turno en
    * estado CLOSED con el detalle del arqueo (faltante/sobrante incluido).
    *
    * En producción NO se cierra por aquí: `close_shift_atomic()` fue revocada
    * a los clientes y ShiftRepository.closeAtomic lanza
    * SHIFT_CLOSE_REQUIRES_CASH_COUNT. El cierre real usa
    * `enterpriseCashService.closeShiftWithCashCount()` (RPC
    * `close_shift_with_cash_count_atomic`), con conteo por denominación.
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
    if (!Number.isFinite(countedAmount) || countedAmount < 0) {
      throw new Error(
        "INVALID_AMOUNT: el monto contado debe ser un número finito y no negativo."
      );
    }

    // Producción real: cierre atómico en servidor.
    if (this.isAtomicShiftCloseRepository(this.repository)) {
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
      totalCashExpense,
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
      totalCashExpense,
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