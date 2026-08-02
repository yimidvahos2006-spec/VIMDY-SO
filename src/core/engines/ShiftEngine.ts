import { Shift } from "../entities/Entities";
import { IRepository } from "../../infrastructure/di/repositories/IRepository";

import { CashEngine } from "./CashEngine";
import { vimdyCore } from "../VimdyCore";

/* ===========================================================================
   ShiftEngine
   ---------------------------------------------------------------------------
   Controla los turnos de caja de VIMDY OS: apertura con fondo inicial,
   arqueo en vivo mientras el turno sigue abierto, y cierre con comparación
   entre lo que el sistema espera (fondo + ingresos - egresos) y lo que el
   cajero cuenta físicamente.

   Regla de negocio central: solo puede existir UN turno abierto a la vez.
   Esto evita que dos cajeros operen sobre la misma caja sin control, y es
   lo que permite que CashEngine (ingresos/egresos) tenga siempre un turno
   "dueño" al cual atribuirse.

   Conexiones directas (obligatorias):
     - IRepository<Shift> → persistencia de los turnos.
     - CashEngine          → fuente de verdad de los movimientos de caja;
                              ShiftEngine nunca escribe movimientos, solo
                              los consulta por rango de fechas para calcular
                              el arqueo.
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
    private readonly cash: CashEngine
  ) {}

  /**
   * Abre un nuevo turno de caja para un cajero.
   * Falla si ya existe un turno abierto (en cualquier caja del negocio).
   */
  public async openShift(
    cashierId: string,
    openingAmount: number,
    notes?: string
  ): Promise<Shift> {
    if (openingAmount < 0) {
      throw new Error("INVALID_AMOUNT: el fondo inicial no puede ser negativo.");
    }

    const current = await this.getCurrentShift();

    if (current) {
      throw new Error(
        `SHIFT_ALREADY_OPEN: ya existe un turno abierto (id "${current.id}"). ` +
        "Debe cerrarse antes de abrir uno nuevo."
      );
    }

    const shift: Shift = {
      id: crypto.randomUUID(),
      cashierId,
      status: "OPEN",
      openingAmount,
      openedAt: new Date(),
      openingNotes: notes
    };

    await this.repository.save(shift);

    vimdyCore.emit("shift", { action: "OPENED", shift });

    return shift;
  }

  /**
   * Devuelve el turno actualmente abierto, si existe.
   * Si se pasa `cashierId`, solo devuelve el turno abierto si pertenece
   * a ese cajero.
   */
  public async getCurrentShift(cashierId?: string): Promise<Shift | null> {
    const shifts = await this.repository.findAll();

    const open = shifts.find(shift => shift.status === "OPEN");

    if (!open) return null;
    if (cashierId && open.cashierId !== cashierId) return null;

    return open;
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

    const movements = await this.cash.getMovementsBetween(
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
   */
  public async closeShift(
    shiftId: string,
    countedAmount: number,
    notes?: string
  ): Promise<Shift> {
    if (countedAmount < 0) {
      throw new Error("INVALID_AMOUNT: el monto contado no puede ser negativo.");
    }

    const { shift, totalIncome, totalExpense, totalCashIncome, incomeByMethod, expectedAmount } =
      await this.getShiftSummary(shiftId);

    if (shift.status === "CLOSED") {
      throw new Error("SHIFT_ALREADY_CLOSED: este turno ya fue cerrado.");
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
      closingNotes: notes
    };

    await this.repository.update(closedShift);

    vimdyCore.emit("shift", { action: "CLOSED", shift: closedShift });

    return closedShift;
  }

  /**
   * Historial de turnos cerrados, más reciente primero.
   * Si se pasa `cashierId`, filtra solo los turnos de ese cajero.
   */
  public async getShiftHistory(cashierId?: string): Promise<Shift[]> {
    const shifts = await this.repository.findAll();

    return shifts
      .filter(shift => shift.status === "CLOSED")
      .filter(shift => !cashierId || shift.cashierId === cashierId)
      .sort((a, b) => {
        const aTime = a.closedAt?.getTime() ?? 0;
        const bTime = b.closedAt?.getTime() ?? 0;
        return bTime - aTime;
      });
  }
}